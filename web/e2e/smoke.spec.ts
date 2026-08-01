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

test("a poisoned preview output degrades inline while the canvas stays live", async ({ page }) => {
  const errors = watchPageErrors(page);
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
  await expect(page.getByText("Throwing the shuttle")).toBeVisible();
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
