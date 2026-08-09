import { expect, type Page, type Route, test } from "@playwright/test";

const STARTER_NODE_IDS = ["endpoint", "model", "loom", "preview"];

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function clickWireAt(page: Page, edgeId: string, fraction: number, additive = false) {
  const point = await page
    .locator(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-interaction`)
    .evaluate((element: SVGPathElement, pathFraction) => {
      const pathPoint = element.getPointAtLength(element.getTotalLength() * pathFraction);
      const screenPoint = pathPoint.matrixTransform(element.getScreenCTM() ?? new DOMMatrix());
      return { x: screenPoint.x, y: screenPoint.y };
    }, fraction);
  if (additive) await page.keyboard.down("Control");
  await page.mouse.click(point.x, point.y);
  if (additive) await page.keyboard.up("Control");
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
  const previewOutput = poisonPreview ? { __glitchlabPoison: true } : { value: [completion] };
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

async function loomProbeResponse(route: Route, callIndex: number) {
  const request = route.request().postDataJSON() as {
    graph: { name: string; nodes: { id: string; kind: string }[] };
    scope: { mode: "full" | "targets"; target_node_ids: string[] };
  };
  const choices = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [` token-${callIndex}-${index}`, -0.1 - index]),
  );
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "completed",
      manifest: {
        run_id: `loom-probe-${callIndex}`,
        graph_name: request.graph.name,
        graph_digest: `loom-probe-digest-${callIndex}`,
        engine_version: "playwright",
        started_at: "2026-08-03T00:00:00Z",
        finished_at: "2026-08-03T00:00:01Z",
        scope: {
          mode: request.scope.mode,
          target_node_ids: request.scope.target_node_ids,
          executed_node_ids: request.graph.nodes.map((node) => node.id),
        },
      },
      nodes: request.graph.nodes.map((node) => ({
        node_id: node.id,
        kind: node.kind,
        status: "completed",
        duration_ms: 1,
        outputs:
          node.id === "loom"
            ? {
                result: {
                  kind: "completion_result",
                  text: ` sampled-${callIndex}`,
                  logprobs: { top_logprobs: [choices] },
                },
              }
            : {},
      })),
      terminal_outputs: {},
    }),
  });
}

test("starter loads, fits, opens its Loom, and preserves panel controls", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Run graph" })).toBeEnabled();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
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

  const loomNode = page.locator('.react-flow__node[data-id="loom"]');
  await loomNode.locator("header").click();
  await expect(page.getByText("Inspector", { exact: true })).toBeVisible();
  await page
    .locator('aside[aria-label="Inspector"]')
    .getByRole("button", { name: "Open loom" })
    .click();
  await expect(page.getByRole("dialog", { name: "Branching draft" })).toBeVisible();
  await page.getByRole("button", { name: "Close loom" }).click();

  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeHidden();
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Loom editor preserves whitespace and caret edits", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  await page
    .locator('.react-flow__node[data-id="loom"]')
    .getByRole("button", { name: "Open loom" })
    .click();
  const selectedText = page.getByRole("textbox", { name: "Selected loom segment" });
  await expect(selectedText).toBeVisible();

  await selectedText.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(4, 4);
  });
  await page.keyboard.type(" nimble ");

  await expect(selectedText).toHaveValue("The  nimble atomic age will bring");
  expect(
    await selectedText.evaluate((element: HTMLTextAreaElement) => element.selectionStart),
  ).toBe(12);
  await expect(page.getByRole("dialog").locator("pre")).toHaveText(
    "The  nimble atomic age will bring",
  );
  await page.getByRole("button", { name: "Close loom" }).click();
  await expect(page.getByLabel("Unsaved graph changes")).toBeVisible();
  expect(errors).toEqual([]);
});

test("inline endpoint editing preserves the caret and recent values are reusable", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const endpointNode = page.locator('.react-flow__node[data-id="endpoint"]');
  const endpointInput = endpointNode.getByRole("textbox");
  const originalEndpoint = await endpointInput.inputValue();
  const insertionPoint = originalEndpoint.indexOf("://") + 3;
  await endpointInput.evaluate((element: HTMLInputElement, caret) => {
    element.focus();
    element.setSelectionRange(caret, caret);
  }, insertionPoint);
  await page.keyboard.type("edge.");

  await expect(endpointInput).toHaveValue(
    `${originalEndpoint.slice(0, insertionPoint)}edge.${originalEndpoint.slice(insertionPoint)}`,
  );
  expect(await endpointInput.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(
    insertionPoint + 5,
  );
  await endpointInput.blur();
  const recentEndpoints = endpointNode.getByRole("combobox", { name: "Recent endpoint URLs" });
  await expect(recentEndpoints).toContainText("edge.");

  await endpointInput.fill("http://temporary.test/v1");
  await endpointInput.blur();
  await recentEndpoints.selectOption(
    `${originalEndpoint.slice(0, insertionPoint)}edge.${originalEndpoint.slice(insertionPoint)}`,
  );
  await expect(endpointInput).toHaveValue(
    `${originalEndpoint.slice(0, insertionPoint)}edge.${originalEndpoint.slice(insertionPoint)}`,
  );

  const modelNode = page.locator('.react-flow__node[data-id="model"]');
  const modelInput = modelNode.getByRole("textbox");
  await modelInput.fill("publisher/used-model");
  await modelInput.blur();
  await expect(modelNode.getByRole("combobox", { name: "Recent model IDs" })).toContainText(
    "publisher/used-model",
  );

  await endpointNode.locator("header").click();
  const inspector = page.locator('aside[aria-label="Inspector"]');
  const inspectorEndpoint = inspector.getByRole("textbox", { name: "Base URL" });
  const inspectorValue = await inspectorEndpoint.inputValue();
  const inspectorInsertionPoint = inspectorValue.indexOf("://") + 3;
  await inspectorEndpoint.evaluate((element: HTMLInputElement, caret) => {
    element.focus();
    element.setSelectionRange(caret, caret);
  }, inspectorInsertionPoint);
  await page.keyboard.type("inspector.");
  await expect(inspectorEndpoint).toHaveValue(
    `${inspectorValue.slice(0, inspectorInsertionPoint)}inspector.${inspectorValue.slice(inspectorInsertionPoint)}`,
  );
  expect(
    await inspectorEndpoint.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(inspectorInsertionPoint + 10);
  await inspectorEndpoint.blur();
  await expect(
    inspector.getByRole("combobox", { name: "Recent endpoint URLs" }),
  ).toContainText("inspector.");
  expect(errors).toEqual([]);
});

test("the Loom steers exact tokens with digit hotkeys and a nested left-to-right branch", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const submitted: unknown[] = [];
  let callIndex = 0;
  await useLegacyRunEndpoint(page);
  await page.route("**/api/runs", async (route) => {
    submitted.push(route.request().postDataJSON());
    await loomProbeResponse(route, callIndex);
    callIndex += 1;
  });
  await page.goto("/");

  await page
    .locator('.react-flow__node[data-id="loom"]')
    .getByRole("button", { name: "Open loom" })
    .click();
  await page.getByRole("button", { name: "Show next tokens" }).click();
  await expect(
    page.getByRole("group", { name: "Next token choices" }).getByRole("button"),
  ).toHaveCount(10);

  const selectedText = page.getByRole("textbox", { name: "Selected loom segment" });
  const manualText = page.getByRole("textbox", { name: "Manual loom branch text" });
  await manualText.fill("0");
  await expect(selectedText).toHaveValue("The atomic age will bring");
  expect(submitted).toHaveLength(1);

  await page.getByText("Token steering").click();
  await page.keyboard.press("0");
  await expect(selectedText).toHaveValue(" token-0-0");
  await expect.poll(() => submitted.length).toBe(2);
  await expect(page.getByText("2 entries")).toBeVisible();

  const treeItems = page.getByRole("tree", { name: "Loom branches" }).getByRole("treeitem");
  await expect(treeItems).toHaveCount(2);
  const rootBox = await treeItems.nth(0).boundingBox();
  const childBox = await treeItems.nth(1).boundingBox();
  expect(rootBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  if (rootBox && childBox) expect(childBox.x).toBeGreaterThan(rootBox.x + rootBox.width);

  const secondRequest = submitted[1] as {
    graph: { nodes: { kind: string; config: Record<string, unknown> }[] };
  };
  expect(secondRequest.graph.nodes.find((node) => node.kind === "text_input")?.config.text).toBe(
    "The atomic age will bring token-0-0",
  );
  expect(errors).toEqual([]);
});

test("canvas context menu adds a node with the mouse", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(4);

  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("searchbox", { name: "Find a node to add" }).fill("Number");
  await page.getByRole("option", { name: "Number Values", exact: true }).click();

  await expect(nodes).toHaveCount(5);
  await expect(page.locator('.react-flow__node[data-id^="number_input-"]')).toHaveCount(1);
  await expect(page.getByRole("menu")).toBeHidden();
  expect(errors).toEqual([]);
});

test("public starter templates load with canvas guidance", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("button", { name: /Phased math worksheet/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Two-model synthesis/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Prompt corruption A\/B lab/ })).toBeVisible();
  await page.getByRole("button", { name: /Phased math worksheet/ }).click();

  await expect(page.locator('.react-flow__node[data-id="worksheet-preview"]')).toBeVisible();
  await expect(page.locator(".react-flow__node-workflowNote")).toHaveCount(3);
  await expect(page.getByLabel("Canvas note").nth(1)).toHaveValue(
    /Select field node takes the completion's text field/,
  );
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  const canvasBox = await page.locator(".react-flow").boundingBox();
  expect(canvasBox).not.toBeNull();
  for (const note of await page.locator(".react-flow__node-workflowNote").all()) {
    const noteBox = await note.boundingBox();
    expect(noteBox).not.toBeNull();
    if (!canvasBox || !noteBox) continue;
    expect(noteBox.x).toBeGreaterThanOrEqual(canvasBox.x - 2);
    expect(noteBox.y).toBeGreaterThanOrEqual(canvasBox.y - 2);
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 2);
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 2);
  }
  expect(errors).toEqual([]);
});

test("canvas notes preserve whitespace and support duplication", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("menuitem", { name: "Add note" }).click();

  const notes = page.locator(".react-flow__node-workflowNote");
  await expect(notes).toHaveCount(1);
  const textarea = page.getByLabel("Canvas note");
  await textarea.fill("  alpha beta");
  await textarea.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(8, 8));
  await page.keyboard.insertText(" ");
  await textarea.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(element.value.length, element.value.length),
  );
  await page.keyboard.insertText("\nkept  ");
  await expect(textarea).toHaveValue("  alpha  beta\nkept  ");

  await notes.locator("header").click();
  await page.keyboard.press("Control+d");
  await expect(notes).toHaveCount(2);
  await expect(page.getByLabel("Canvas note").nth(0)).toHaveValue("  alpha  beta\nkept  ");
  await expect(page.getByLabel("Canvas note").nth(1)).toHaveValue("  alpha  beta\nkept  ");
  await page.getByRole("button", { name: "Delete note" }).last().click();
  await expect(notes).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("modifier selection groups two nodes into a collapsible frame", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const endpoint = page.locator('.react-flow__node[data-id="endpoint"]');
  const model = page.locator('.react-flow__node[data-id="model"]');
  await endpoint.locator("header").click();
  await page.keyboard.down("Control");
  await model.locator("header").click();
  await page.keyboard.up("Control");

  await expect(endpoint).toHaveClass(/selected/);
  await expect(model).toHaveClass(/selected/);

  await endpoint.locator("header").click({ button: "right" });
  const group = page.getByRole("menuitem", { name: "Group in collapsible frame" });
  await expect(group).toBeVisible();
  await group.click();

  const frame = page.locator('.react-flow__node[data-id^="frame-"]');
  await expect(frame).toHaveCount(1);
  await expect(endpoint).toBeVisible();
  await expect(model).toBeVisible();

  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("menuitem", { name: "Tidy graph" }).click();
  await expect
    .poll(async () => {
      const frameBox = await frame.boundingBox();
      const endpointBox = await endpoint.boundingBox();
      const modelBox = await model.boundingBox();
      const loomBox = await page.locator('.react-flow__node[data-id="loom"]').boundingBox();
      if (!frameBox || !endpointBox || !modelBox || !loomBox) return false;
      const contains = (box: typeof endpointBox) =>
        box.x >= frameBox.x &&
        box.y >= frameBox.y + 32 &&
        box.x + box.width <= frameBox.x + frameBox.width &&
        box.y + box.height <= frameBox.y + frameBox.height;
      return contains(endpointBox) && contains(modelBox) && frameBox.x + frameBox.width < loomBox.x;
    })
    .toBe(true);

  await frame.getByRole("button", { name: "Collapse frame" }).click();
  await expect(frame.getByRole("button", { name: "Expand frame" })).toBeVisible();
  await expect(endpoint).toBeHidden();
  await expect(model).toBeHidden();
  await expect(page.locator('.react-flow__node[data-id="loom"]')).toBeVisible();
  await expect
    .poll(() => page.locator('.react-flow__edge[data-id^="proxy:"]').count())
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("marquee selection latches to nodes or rendered wire paths", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const endpoint = page.locator('.react-flow__node[data-id="endpoint"]');
  const model = page.locator('.react-flow__node[data-id="model"]');
  const loom = page.locator('.react-flow__node[data-id="loom"]');
  const canvas = page
    .locator("section")
    .filter({ has: page.locator(".react-flow") })
    .first();
  const endpointBox = await endpoint.boundingBox();
  const modelBox = await model.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(endpointBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  if (!endpointBox || !modelBox || !canvasBox) return;

  const nodeStart = {
    x: Math.max(canvasBox.x + 6, Math.min(endpointBox.x, modelBox.x) - 18),
    y: Math.max(canvasBox.y + 6, Math.min(endpointBox.y, modelBox.y) - 18),
  };
  const nodeEnd = {
    x: Math.max(endpointBox.x + endpointBox.width, modelBox.x + modelBox.width) + 18,
    y: Math.max(endpointBox.y + endpointBox.height, modelBox.y + modelBox.height) + 18,
  };
  await page.mouse.move(nodeStart.x, nodeStart.y);
  await page.mouse.down();
  await page.mouse.move(nodeEnd.x, nodeEnd.y, { steps: 10 });
  await page.mouse.up();
  await expect(endpoint).toHaveClass(/selected/);
  await expect(model).toHaveClass(/selected/);

  await page.waitForTimeout(150);
  const clearPoint = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".react-flow")!;
    const bounds = root.getBoundingClientRect();
    const blocked =
      ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, button, input, select, textarea";
    for (let y = bounds.top + 20; y < bounds.bottom - 20; y += 24) {
      for (let x = bounds.left + 20; x < bounds.right - 20; x += 24) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest(".react-flow__pane") && !target.closest(blocked)) return { x, y };
      }
    }
    throw new Error("Could not find an empty pane point");
  });
  await page.mouse.click(clearPoint.x, clearPoint.y);
  await expect(endpoint).not.toHaveClass(/selected/);
  await expect(model).not.toHaveClass(/selected/);
  const [endpointSource, modelSource, endpointTarget, modelTarget] = await Promise.all([
    endpoint.locator(".react-flow__handle.source").boundingBox(),
    model.locator(".react-flow__handle.source").boundingBox(),
    loom.locator('.react-flow__handle.target[data-handleid="endpoint"]').boundingBox(),
    loom.locator('.react-flow__handle.target[data-handleid="model"]').boundingBox(),
  ]);
  expect(endpointSource).not.toBeNull();
  expect(modelSource).not.toBeNull();
  expect(endpointTarget).not.toBeNull();
  expect(modelTarget).not.toBeNull();
  if (!endpointSource || !modelSource || !endpointTarget || !modelTarget) return;
  const center = (box: NonNullable<typeof endpointSource>) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const wireBoundsPoints = [
    [center(endpointSource), center(endpointTarget)],
    [center(modelSource), center(modelTarget)],
  ].map(([source, target]) => ({
    x: source.x + (target.x - source.x) * 0.35,
    y: source.y + (target.y - source.y) * 0.35,
  }));
  const wireGesture = await page.evaluate((points) => {
    const pane = document.querySelector<HTMLElement>(".react-flow__pane")!;
    const paneBounds = pane.getBoundingClientRect();
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const marginX = 30;
    const marginY = 50;
    const clampX = (value: number) =>
      Math.max(paneBounds.left + 4, Math.min(paneBounds.right - 4, value));
    const clampY = (value: number) =>
      Math.max(paneBounds.top + 4, Math.min(paneBounds.bottom - 4, value));
    const candidates = [
      {
        start: { x: clampX(minX - marginX), y: clampY(minY - marginY) },
        end: { x: clampX(maxX + marginX), y: clampY(maxY + marginY) },
      },
      {
        start: { x: clampX(minX - marginX), y: clampY(maxY + marginY) },
        end: { x: clampX(maxX + marginX), y: clampY(minY - marginY) },
      },
      {
        start: { x: clampX(maxX + marginX), y: clampY(minY - marginY) },
        end: { x: clampX(minX - marginX), y: clampY(maxY + marginY) },
      },
      {
        start: { x: clampX(maxX + marginX), y: clampY(maxY + marginY) },
        end: { x: clampX(minX - marginX), y: clampY(minY - marginY) },
      },
    ];
    const gesture = candidates.find(({ start }) => {
      const target = document.elementFromPoint(start.x, start.y);
      return (
        target?.closest(".react-flow__pane") === pane &&
        !target.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, button, input, select, textarea",
        )
      );
    });
    if (!gesture) throw new Error("Could not find an empty pane origin for wire marquee");
    return gesture;
  }, wireBoundsPoints);
  const { start: wireStart, end: wireEnd } = wireGesture;
  await page.mouse.move(wireStart.x, wireStart.y);
  await page.mouse.down();
  await page.mouse.move(wireEnd.x, wireEnd.y, { steps: 10 });
  await expect(page.getByText("Selecting wires · 2", { exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id="endpoint-loom"]')).toHaveClass(/selected/);
  await expect(page.locator('.react-flow__edge[data-id="model-loom"]')).toHaveClass(/selected/);
  await page.mouse.up();

  await expect(page.locator('.react-flow__edge[data-id="endpoint-loom"]')).toHaveClass(/selected/);
  await expect(page.locator('.react-flow__edge[data-id="model-loom"]')).toHaveClass(/selected/);
  await expect(endpoint).not.toHaveClass(/selected/);
  await expect(model).not.toHaveClass(/selected/);
  expect(errors).toEqual([]);
});

test("modifier-selected wires can be bundled, moved, recolored, and unbundled", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const endpointWire = page.locator('.react-flow__edge[data-id="endpoint-loom"]');
  const modelWire = page.locator('.react-flow__edge[data-id="model-loom"]');
  await clickWireAt(page, "endpoint-loom", 0.34);
  await clickWireAt(page, "model-loom", 0.34, true);

  await expect(endpointWire).toHaveClass(/selected/);
  await expect(modelWire).toHaveClass(/selected/);
  await expect(page.getByText("2 wires", { exact: true })).toBeVisible();
  await page.getByLabel("Wire color").selectOption("rose");
  await expect(endpointWire.locator(".react-flow__edge-path")).toHaveCSS(
    "stroke",
    "rgb(217, 134, 174)",
  );
  await page.getByRole("button", { name: "Bundle" }).click();

  const startWaypoint = page.getByRole("button", {
    name: "Move bundle waypoint 1 for 2 wires",
  });
  const endWaypoint = page.getByRole("button", {
    name: "Move bundle waypoint 2 for 2 wires",
  });
  await expect(startWaypoint).toBeVisible();
  await expect(endWaypoint).toBeVisible();
  await expect(page.getByRole("button", { name: "Unbundle" })).toBeHidden();

  const trunk = page.locator('path[class*="bundleTrunkHitArea"]').last();
  const trunkBox = await trunk.boundingBox();
  const trunkStartBefore = Number(await startWaypoint.getAttribute("data-flow-x"));
  const trunkEndBefore = Number(await endWaypoint.getAttribute("data-flow-x"));
  expect(trunkBox).not.toBeNull();
  if (trunkBox) {
    const center = {
      x: trunkBox.x + trunkBox.width / 2,
      y: trunkBox.y + trunkBox.height / 2,
    };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("class"),
        center,
      ),
    ).toContain("bundleTrunkHitArea");
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 42, center.y + 24, { steps: 8 });
    await page.mouse.up();
    expect(
      Number(await startWaypoint.getAttribute("data-flow-x")) - trunkStartBefore,
    ).toBeGreaterThan(30);
    expect(Number(await endWaypoint.getAttribute("data-flow-x")) - trunkEndBefore).toBeGreaterThan(
      30,
    );
  }

  const before = await endWaypoint.boundingBox();
  const beforeFlow = {
    x: Number(await endWaypoint.getAttribute("data-flow-x")),
    y: Number(await endWaypoint.getAttribute("data-flow-y")),
  };
  expect(before).not.toBeNull();
  if (before) {
    const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 54, center.y - 36, { steps: 8 });
    await page.mouse.up();
    const after = await endWaypoint.boundingBox();
    const afterFlow = {
      x: Number(await endWaypoint.getAttribute("data-flow-x")),
      y: Number(await endWaypoint.getAttribute("data-flow-y")),
    };
    expect(after).not.toBeNull();
    if (after) {
      expect(afterFlow.x - beforeFlow.x).toBeGreaterThan(42);
      expect(beforeFlow.y - afterFlow.y).toBeGreaterThan(24);
      expect(after.x - before.x).toBeGreaterThan(32);
      expect(before.y - after.y).toBeGreaterThan(18);
    }
  }

  const manuallyMovedFlow = {
    x: Number(await endWaypoint.getAttribute("data-flow-x")),
    y: Number(await endWaypoint.getAttribute("data-flow-y")),
  };
  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("menuitem", { name: "Tidy graph" }).click();
  await expect
    .poll(async () => ({
      x: Number(await endWaypoint.getAttribute("data-flow-x")),
      y: Number(await endWaypoint.getAttribute("data-flow-y")),
    }))
    .not.toEqual(manuallyMovedFlow);
  const tidiedStartX = Number(await startWaypoint.getAttribute("data-flow-x"));
  const tidiedEndX = Number(await endWaypoint.getAttribute("data-flow-x"));
  expect(tidiedStartX).toBeLessThan(tidiedEndX);

  await clickWireAt(page, "endpoint-loom", 0.08);
  await clickWireAt(page, "model-loom", 0.08, true);
  await expect(page.getByRole("button", { name: "Unbundle" })).toBeVisible();
  await page.getByRole("button", { name: "Unbundle" }).click();
  await expect(startWaypoint).toBeHidden();
  await expect(endWaypoint).toBeHidden();
  await expect(endpointWire).toHaveCount(1);
  await expect(modelWire).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("tidy graph keeps a mixed-source fan-in cable tie inside its target frame", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const model = page.locator('.react-flow__node[data-id="model"]');
  const loom = page.locator('.react-flow__node[data-id="loom"]');
  await model.locator("header").click();
  await page.keyboard.down("Control");
  await loom.locator("header").click();
  await page.keyboard.up("Control");
  await model.locator("header").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Group in collapsible frame" }).click();

  await clickWireAt(page, "endpoint-loom", 0.34);
  await clickWireAt(page, "model-loom", 0.34, true);
  await expect(page.getByText("2 wires", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bundle" }).press("Enter");

  const frame = page.locator('.react-flow__node[data-id^="frame-"]');
  const trunk = page.locator('path[class*="bundleTrunkHitArea"]').last();
  await expect(trunk).toBeVisible();
  await page.locator(".react-flow__pane").click({
    button: "right",
    position: { x: 400, y: 20 },
  });
  await page.getByRole("menuitem", { name: "Tidy graph" }).click();

  await expect
    .poll(async () => {
      const frameBox = await frame.boundingBox();
      const trunkBox = await trunk.boundingBox();
      if (!frameBox || !trunkBox) return false;
      const center = {
        x: trunkBox.x + trunkBox.width / 2,
        y: trunkBox.y + trunkBox.height / 2,
      };
      return (
        center.x >= frameBox.x &&
        center.y >= frameBox.y &&
        center.x <= frameBox.x + frameBox.width &&
        center.y <= frameBox.y + frameBox.height
      );
    })
    .toBe(true);
  expect(errors).toEqual([]);
});

test("document edits undo and redo through shortcuts and toolbar controls", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto("/");

  const undo = page.getByRole("button", { name: "Undo graph change" });
  const redo = page.getByRole("button", { name: "Redo graph change" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.locator('.react-flow__node[data-id="model"] header').click();
  const modelId = page.getByLabel("Model Id for Local model");
  const originalModelId = await modelId.inputValue();
  await modelId.fill("undo-redo-model");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await expect(undo).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(redo).toBeEnabled();
  await page.locator('.react-flow__node[data-id="model"] header').click();
  await expect(page.getByLabel("Model Id for Local model")).toHaveValue(originalModelId);
  await page.getByRole("button", { name: "Close inspector" }).click();

  await redo.click();
  await page.locator('.react-flow__node[data-id="model"] header').click();
  await expect(page.getByLabel("Model Id for Local model")).toHaveValue("undo-redo-model");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await undo.click();
  await page.keyboard.press("Control+Shift+z");
  await page.locator('.react-flow__node[data-id="model"] header').click();
  await expect(page.getByLabel("Model Id for Local model")).toHaveValue("undo-redo-model");
  await page.getByRole("button", { name: "Close inspector" }).click();

  await page.getByRole("button", { name: "Reset to starter graph" }).click();
  await page.getByRole("button", { name: "Reset graph" }).click();
  await undo.click();
  await page.locator('.react-flow__node[data-id="model"] header').click();
  await expect(page.getByLabel("Model Id for Local model")).toHaveValue("undo-redo-model");
  expect(errors).toEqual([]);
});

test("a successful run selects and renders deterministic output", async ({ page }) => {
  const errors = watchPageErrors(page);
  await useLegacyRunEndpoint(page);
  await page.route("**/api/runs", (route) => successfulRunResponse(route));
  await page.goto("/");

  await page.getByRole("button", { name: "Run graph" }).click();

  const previewNode = page.locator('.react-flow__node[data-id="preview"]');
  await expect(previewNode.getByText("stubbed completion", { exact: true })).toBeVisible();
  await expect(previewNode.getByText("1 completion", { exact: true })).toBeVisible();
  await expect(page.getByText("Full graph run")).toBeVisible();
  await expect(page.getByText(/4 nodes · completed/)).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="preview"] article')).toHaveClass(
    /status-completed/,
  );
  await previewNode.getByRole("button", { name: "Hide value on canvas" }).click();
  await expect(previewNode.getByText("stubbed completion", { exact: true })).toHaveCount(0);
  await previewNode.getByRole("button", { name: "Show value on canvas" }).click();
  await expect(previewNode.getByText("stubbed completion", { exact: true })).toBeVisible();
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
        target_node_ids: ["loom"],
        node_ids: ["endpoint", "loom"],
        edge_ids: ["endpoint-loom"],
      };
      const nodeResults = ["endpoint", "loom"].map((nodeId) => ({
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
            target_node_ids: ["loom"],
            executed_node_ids: ["endpoint", "loom"],
          },
          graph: request.graph,
        },
        nodes: nodeResults,
        terminal_outputs: { loom: {} },
      };
      const staged = [
        [0, { ...base, sequence: 1, event: "run_started", requested_scope: request.scope }],
        [10, { ...base, sequence: 2, event: "run_planned", plan }],
        [
          100,
          { ...base, sequence: 3, event: "node_started", node_id: "endpoint", kind: "endpoint" },
        ],
        [
          1_200,
          {
            ...base,
            sequence: 4,
            event: "node_completed",
            node_id: "endpoint",
            kind: "endpoint",
            duration_ms: 10,
          },
        ],
        [
          1_400,
          {
            ...base,
            sequence: 5,
            event: "node_started",
            node_id: "loom",
            kind: "loom",
          },
        ],
        [
          1_600,
          {
            ...base,
            sequence: 6,
            event: "edges_transferred",
            node_id: "loom",
            edge_ids: ["endpoint-loom"],
          },
        ],
        [
          2_800,
          {
            ...base,
            sequence: 7,
            event: "node_completed",
            node_id: "loom",
            kind: "loom",
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

  await page.locator('.react-flow__node[data-id="loom"] header').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Run to here" }).click();

  await expect(page.getByText("Running Local completion API")).toBeVisible();
  await expect(page.getByText("Running Branching draft")).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id="endpoint-loom"]')).toHaveClass(
    /edge-transfer-pulse/,
  );
  await expect(page.locator('.react-flow__node[data-id="loom"] article')).toHaveClass(
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
      if (value && typeof value === "object" && "__glitchlabPoison" in value) {
        throw new Error("Synthetic preview render failure");
      }
      return originalStringify(...args);
    };
  });

  await page.getByRole("button", { name: "Run graph" }).click();

  await expect(page.getByRole("alert").last()).toContainText("Output could not be rendered");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Run graph" })).toBeVisible();
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

  await page.locator('.react-flow__node[data-id="model"] header').click();
  await page.getByRole("button", { name: "Run graph" }).click();
  await expect(page.getByText("Preparing next node")).toBeVisible();
  await page.getByLabel("Model Id for Local model").evaluate((element) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(element, "Changed while running");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  releaseRun?.();

  await expect(
    page.getByText("Prior output — the graph changed after this run was submitted."),
  ).toBeVisible();
  await expect(page.getByText(/4 nodes · prior result is stale/)).toBeVisible();
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
          node_id: "loom",
          nodes: [],
        },
      }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Run graph" }).click();

  await expect(page.getByText("Run stopped")).toBeVisible();
  await expect(page.getByText("Synthetic completion failure")).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="loom"] article')).toHaveClass(
    /status-failed/,
  );
  await expect(page.locator('aside[aria-label="Inspector"]')).toBeVisible();
  expect(
    errors.filter(
      (message) => !/Failed to load resource:.*422 \(Unprocessable Entity\)/.test(message),
    ),
  ).toEqual([]);
});
