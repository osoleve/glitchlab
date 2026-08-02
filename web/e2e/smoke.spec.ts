import { expect, type Page, type Route, test } from "@playwright/test";

const STARTER_NODE_IDS = [
  "prompt",
  "typogre",
  "corrupt",
  "endpoint",
  "vintage_model",
  "web_model",
  "original_vintage",
  "original_web",
  "corrupted_vintage",
  "corrupted_web",
  "collect",
  "preview",
];

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function useLegacyRunEndpoint(page: Page): Promise<void> {
  // Exercise the client capability fallback without issuing an expected failing
  // request that would mask unrelated 404s in the console assertions below.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "ReadableStream", {
      configurable: true,
      value: undefined,
    });
  });
}

async function successfulRunResponse(route: Route, delayMs = 0, poisonPreview = false) {
  const request = route.request().postDataJSON() as {
    graph: {
      name: string;
      nodes: { id: string; kind: string }[];
    };
    scope: { mode: "full" | "targets"; target_node_ids: string[] };
  };
  if (delayMs > 0) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  const executedNodeIds = request.graph.nodes.map((node) => node.id);
  const completion = {
    kind: "completion_result",
    text: "stubbed completion",
    model: "talkie-test",
    model_revision: "test-revision",
    finish_reason: "stop",
    usage: {
      prompt_tokens: 4,
      completion_tokens: 2,
      total_tokens: 6,
    },
    parameters: { seed: 151 },
  };
  const previewOutput = poisonPreview ? { __glitchloomPoison: true } : { value: [completion] };
  const nodes = request.graph.nodes.map((node) => ({
    node_id: node.id,
    kind: node.kind,
    status: "completed",
    duration_ms: 1,
    outputs: node.id === "preview" ? previewOutput : {},
  }));

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "completed",
      manifest: {
        run_id: "playwright-run",
        graph_name: request.graph.name,
        graph_digest: "playwright-digest",
        engine_version: "playwright",
        started_at: "2026-07-30T00:00:00Z",
        finished_at: "2026-07-30T00:00:01Z",
        glitchlings_version: null,
        scope: {
          mode: request.scope.mode,
          target_node_ids: request.scope.target_node_ids,
          executed_node_ids: executedNodeIds,
        },
      },
      nodes,
      terminal_outputs: {
        preview: previewOutput,
      },
    }),
  });
}

async function connect(
  page: Page,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
) {
  const source = page.locator(
    `.react-flow__node[data-id="${sourceNodeId}"] .react-flow__handle.source[data-handleid="${sourcePort}"]`,
  );
  const target = page.locator(
    `.react-flow__node[data-id="${targetNodeId}"] .react-flow__handle.target[data-handleid="${targetPort}"]`,
  );
  await expect(source, `source handle ${sourceNodeId}.${sourcePort}`).toBeVisible();
  await expect(target, `target handle ${targetNodeId}.${targetPort}`).toBeVisible();
  await source.dragTo(target, { force: true });
}

test("starter loads, fits, edits, connects, and preserves panel controls", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Run loom" })).toBeEnabled();
  await expect(page.locator(".react-flow__node")).toHaveCount(12);
  await expect(page.locator(".react-flow__edge")).toHaveCount(19);
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  const canvasBox = await page.locator(".react-flow").boundingBox();
  expect(canvasBox).not.toBeNull();
  const nodeBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const nodeId of STARTER_NODE_IDS) {
    const nodeBox = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
    expect(nodeBox, `starter node ${nodeId}`).not.toBeNull();
    if (!canvasBox || !nodeBox) continue;
    nodeBoxes.set(nodeId, nodeBox);
    expect(nodeBox.x).toBeGreaterThanOrEqual(canvasBox.x - 2);
    expect(nodeBox.y).toBeGreaterThanOrEqual(canvasBox.y - 2);
    expect(nodeBox.x + nodeBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 2);
    expect(nodeBox.y + nodeBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 2);
  }
  for (let left = 0; left < STARTER_NODE_IDS.length; left += 1) {
    for (let right = left + 1; right < STARTER_NODE_IDS.length; right += 1) {
      const leftBox = nodeBoxes.get(STARTER_NODE_IDS[left]);
      const rightBox = nodeBoxes.get(STARTER_NODE_IDS[right]);
      if (!leftBox || !rightBox) continue;
      const overlap =
        leftBox.x < rightBox.x + rightBox.width - 1 &&
        leftBox.x + leftBox.width > rightBox.x + 1 &&
        leftBox.y < rightBox.y + rightBox.height - 1 &&
        leftBox.y + leftBox.height > rightBox.y + 1;
      expect(overlap, `${STARTER_NODE_IDS[left]} overlaps ${STARTER_NODE_IDS[right]}`).toBe(false);
    }
  }

  await page.waitForTimeout(350);
  await connect(page, "typogre", "glitchling", "original_vintage", "model");
  await expect(page.locator(".react-flow__edge")).toHaveCount(19);

  await connect(page, "prompt", "text", "collect", "item");
  await expect(page.locator(".react-flow__edge")).toHaveCount(20);

  const promptNode = page.locator('.react-flow__node[data-id="prompt"]');
  await promptNode.locator("header").click();
  await expect(page.getByText("Inspector", { exact: true })).toBeVisible();
  await page.getByLabel("Text for Seed prompt").fill("A browser-tested prompt");
  await expect(page.getByLabel("Unsaved graph changes")).toBeVisible();

  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeHidden();
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("inline textareas preserve caret edits and grow with their node", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const promptNode = page.locator('.react-flow__node[data-id="prompt"]');
  const promptTextarea = promptNode.locator("textarea");
  await expect(promptTextarea).toBeVisible();

  await promptTextarea.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(4, 4);
  });
  await page.keyboard.type(" nimble ");

  await expect(promptTextarea).toHaveValue("The  nimble atomic age will bring");
  expect(
    await promptTextarea.evaluate((element: HTMLTextAreaElement) => element.selectionStart),
  ).toBe(12);

  await promptNode.locator("header").click();
  const resizeHandle = promptNode.locator(".react-flow__resize-control.handle.bottom.right");
  await expect(resizeHandle).toBeVisible();
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  const textareaHeightBefore = await promptTextarea.evaluate(
    (element: HTMLTextAreaElement) => element.getBoundingClientRect().height,
  );
  if (handleBox) {
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 120,
      handleBox.y + handleBox.height / 2 + 140,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  const textareaHeightAfter = await promptTextarea.evaluate(
    (element: HTMLTextAreaElement) => element.getBoundingClientRect().height,
  );
  expect(textareaHeightAfter).toBeGreaterThan(textareaHeightBefore + 70);
  expect(errors).toEqual([]);
});

test("canvas context menu adds a node with the mouse", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(12);

  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("searchbox", { name: "Find a node to add" }).fill("Number");
  await page.getByRole("option", { name: "Number Values", exact: true }).click();

  await expect(nodes).toHaveCount(13);
  await expect(page.locator('.react-flow__node[data-id^="number_input-"]')).toHaveCount(1);
  await expect(page.getByRole("menu")).toBeHidden();
  expect(errors).toEqual([]);
});

test("modifier selection groups two nodes into a collapsible frame", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const prompt = page.locator('.react-flow__node[data-id="prompt"]');
  const typogre = page.locator('.react-flow__node[data-id="typogre"]');
  await prompt.locator("header").click();
  await page.keyboard.down("Control");
  await typogre.locator("header").click();
  await page.keyboard.up("Control");

  await expect(prompt).toHaveClass(/selected/);
  await expect(typogre).toHaveClass(/selected/);

  await prompt.locator("header").click({ button: "right" });
  const group = page.getByRole("menuitem", { name: "Group in collapsible frame" });
  await expect(group).toBeVisible();
  await group.click();

  const frame = page.locator('.react-flow__node[data-id^="frame-"]');
  await expect(frame).toHaveCount(1);
  await expect(prompt).toBeVisible();
  await expect(typogre).toBeVisible();

  await frame.getByRole("button", { name: "Collapse frame" }).click();
  await expect(frame.getByRole("button", { name: "Expand frame" })).toBeVisible();
  await expect(prompt).toBeHidden();
  await expect(typogre).toBeHidden();
  await expect(page.locator('.react-flow__node[data-id="corrupt"]')).toBeVisible();
  await expect
    .poll(() => page.locator('.react-flow__edge[data-id^="proxy:"]').count())
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("document edits undo and redo through shortcuts and toolbar controls", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const undo = page.getByRole("button", { name: "Undo graph change" });
  const redo = page.getByRole("button", { name: "Redo graph change" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  const prompt = page.getByLabel("Text for Seed prompt");
  const originalPrompt = await prompt.inputValue();
  await prompt.fill("Undo and redo browser test");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await expect(undo).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(redo).toBeEnabled();
  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  await expect(page.getByLabel("Text for Seed prompt")).toHaveValue(originalPrompt);
  await page.getByRole("button", { name: "Close inspector" }).click();

  await redo.click();
  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  await expect(page.getByLabel("Text for Seed prompt")).toHaveValue("Undo and redo browser test");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await undo.click();
  await page.keyboard.press("Control+Shift+z");
  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  await expect(page.getByLabel("Text for Seed prompt")).toHaveValue("Undo and redo browser test");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await page.getByRole("button", { name: "Reset to starter graph" }).click();
  await page.getByRole("button", { name: "Reset graph" }).click();
  await undo.click();
  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  await expect(page.getByLabel("Text for Seed prompt")).toHaveValue("Undo and redo browser test");
  expect(errors).toEqual([]);
});

test("a successful run selects and renders deterministic output", async ({ page }) => {
  const errors = watchPageErrors(page);
  await useLegacyRunEndpoint(page);
  await page.route("**/api/runs", (route) => successfulRunResponse(route));
  await page.goto("/");

  await page.getByRole("button", { name: "Run loom" }).click();

  await expect(page.getByText("stubbed completion", { exact: true })).toBeVisible();
  await expect(page.getByText("1 completion", { exact: true })).toBeVisible();
  await expect(page.getByText("Full loom run")).toBeVisible();
  await expect(page.getByText(/12 nodes · completed/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="preview"] article')).toHaveClass(
    /status-completed/,
  );
  expect(errors).toEqual([]);
});

test("a staged run stream exposes incremental node and edge activity", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (new URL(url, window.location.href).pathname !== "/api/runs/stream") {
        return originalFetch(input, init);
      }
      const request = JSON.parse(String(init?.body)) as {
        graph: { name: string; nodes: { id: string; kind: string }[]; edges: unknown[] };
        scope: { mode: "targets"; target_node_ids: string[] };
      };
      const runId = "staged-browser-run";
      const base = {
        protocol_version: 1,
        at: "2026-08-02T00:00:00Z",
        run_id: runId,
      };
      const plan = {
        mode: "targets" as const,
        target_node_ids: ["original_vintage"],
        node_ids: ["prompt", "original_vintage"],
        edge_ids: ["prompt-original-vintage"],
      };
      const nodeResults = ["prompt", "original_vintage"].map((nodeId) => ({
        node_id: nodeId,
        kind: request.graph.nodes.find((node) => node.id === nodeId)?.kind ?? "test",
        status: "completed",
        duration_ms: 10,
        outputs: {},
        error: null,
      }));
      const response = {
        status: "completed",
        manifest: {
          run_id: runId,
          graph_name: request.graph.name,
          graph_digest: "staged-digest",
          engine_version: "playwright",
          started_at: "2026-08-02T00:00:00Z",
          finished_at: "2026-08-02T00:00:01Z",
          python_version: "3.12",
          workspace: "playwright",
          glitchlings_version: null,
          scope: {
            mode: "targets",
            target_node_ids: ["original_vintage"],
            executed_node_ids: ["prompt", "original_vintage"],
          },
          graph: request.graph,
        },
        nodes: nodeResults,
        terminal_outputs: { original_vintage: {} },
      };
      const staged = [
        [0, { ...base, sequence: 1, event: "run_started", requested_scope: request.scope }],
        [10, { ...base, sequence: 2, event: "run_planned", plan }],
        [
          100,
          { ...base, sequence: 3, event: "node_started", node_id: "prompt", kind: "text_input" },
        ],
        [
          1_200,
          {
            ...base,
            sequence: 4,
            event: "node_completed",
            node_id: "prompt",
            kind: "text_input",
            duration_ms: 10,
          },
        ],
        [
          1_400,
          {
            ...base,
            sequence: 5,
            event: "node_started",
            node_id: "original_vintage",
            kind: "completion",
          },
        ],
        [
          1_600,
          {
            ...base,
            sequence: 6,
            event: "edges_transferred",
            node_id: "original_vintage",
            edge_ids: ["prompt-original-vintage"],
          },
        ],
        [
          2_800,
          {
            ...base,
            sequence: 7,
            event: "node_completed",
            node_id: "original_vintage",
            kind: "completion",
            duration_ms: 10,
          },
        ],
        [3_000, { ...base, sequence: 8, event: "run_completed", response }],
      ] as const;
      const encoder = new TextEncoder();
      const timers: number[] = [];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          staged.forEach(([delay, event], index) => {
            timers.push(
              window.setTimeout(() => {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                if (index === staged.length - 1) controller.close();
              }, delay),
            );
          });
        },
        cancel() {
          timers.forEach((timer) => {
            window.clearTimeout(timer);
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    };
  });
  await page.goto("/");

  await page
    .locator('.react-flow__node[data-id="original_vintage"] header')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Run to here" }).click();

  await expect(page.getByText("Running Seed prompt")).toBeVisible();
  await expect(page.getByText("Running Vintage · original")).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id="prompt-original-vintage"]')).toHaveClass(
    /edge-transfer-pulse/,
  );
  await expect(page.locator('.react-flow__node[data-id="original_vintage"] article')).toHaveClass(
    /status-completed/,
  );
  await expect(page.getByText(/2 nodes · completed/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a poisoned preview output degrades inline while the canvas stays live", async ({ page }) => {
  const errors = watchPageErrors(page);
  await useLegacyRunEndpoint(page);
  await page.route("**/api/runs", (route) => successfulRunResponse(route, 0, true));
  await page.goto("/");

  await page.evaluate(() => {
    const originalStringify = JSON.stringify;
    (JSON as { stringify: typeof JSON.stringify }).stringify = (
      ...args: Parameters<typeof JSON.stringify>
    ) => {
      const [value] = args;
      if (value && typeof value === "object" && "__glitchloomPoison" in value) {
        throw new Error("Synthetic preview render failure");
      }
      return originalStringify(...args);
    };
  });

  await page.getByRole("button", { name: "Run loom" }).click();

  await expect(page.getByRole("alert")).toContainText("Output could not be rendered");
  await expect(page.locator(".react-flow__node")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Run loom" })).toBeVisible();
  expect(errors.filter((message) => !message.includes("Synthetic preview render failure"))).toEqual(
    [],
  );
});

test("an edit during a delayed run marks the returned result stale", async ({ page }) => {
  const errors = watchPageErrors(page);
  await useLegacyRunEndpoint(page);
  let releaseRun: (() => void) | undefined;
  const graphEdited = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  await page.route("**/api/runs", async (route) => {
    await graphEdited;
    await successfulRunResponse(route);
  });
  await page.goto("/");

  await page.locator('.react-flow__node[data-id="prompt"] header').click();
  await page.getByRole("button", { name: "Run loom" }).click();
  await expect(page.getByText("Preparing next node")).toBeVisible();
  await page.getByLabel("Text for Seed prompt").evaluate((element) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(element, "Changed while running");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  releaseRun?.();

  await expect(
    page.getByText("Prior output — the graph changed after this run was submitted."),
  ).toBeVisible();
  await expect(page.getByText(/12 nodes · prior result is stale/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a failed run exposes the backend error and failed node", async ({ page }) => {
  const errors = watchPageErrors(page);
  await useLegacyRunEndpoint(page);
  await page.route("**/api/runs", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        detail: {
          message: "Synthetic completion failure",
          node_id: "original_vintage",
          nodes: [],
        },
      }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Run loom" }).click();

  await expect(page.getByText("Run stopped")).toBeVisible();
  await expect(page.getByText("Synthetic completion failure")).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="original_vintage"] article')).toHaveClass(
    /status-failed/,
  );
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeVisible();
  expect(
    errors.filter(
      (message) => !/Failed to load resource:.*422 \(Unprocessable Entity\)/.test(message),
    ),
  ).toEqual([]);
});
