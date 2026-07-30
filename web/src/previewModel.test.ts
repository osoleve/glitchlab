import { describe, expect, it } from "vitest";
import { normalizePreviewValue } from "./previewModel";

describe("normalizePreviewValue", () => {
  it("normalizes a completion result without losing empty text", () => {
    expect(
      normalizePreviewValue({
        kind: "completion_result",
        text: "",
        model: "talkie-older",
        model_revision: "rev-123456789",
        finish_reason: "stop",
        usage: {
          prompt_tokens: 4,
          completion_tokens: 0,
          total_tokens: 4,
        },
        latency_ms: 12.5,
        cache: { hit: false },
        parameters: { seed: 17, temperature: 0.8 },
        prompt: "The bank",
      }),
    ).toEqual({
      kind: "completion",
      entries: [
        {
          text: "",
          model: "talkie-older",
          modelRevision: "rev-123456789",
          finishReason: "stop",
          usage: {
            prompt_tokens: 4,
            completion_tokens: 0,
            total_tokens: 4,
          },
          latencyMs: 12.5,
          cacheHit: false,
          seed: "17",
          prompt: "The bank",
          parameters: { seed: 17, temperature: 0.8 },
        },
      ],
      raw: expect.any(String),
      readableText: "",
      shapeLabel: "1 completion",
    });
  });

  it("normalizes every choice and prefers each choice's reported seed", () => {
    const model = normalizePreviewValue({
      object: "text_completion",
      model: "talkie-newer",
      model_revision: "abcdef123456",
      elapsed_seconds: 1.25,
      parameters: { seed: 40 },
      usage: {
        prompt_tokens: 5,
        completion_tokens: 4,
        total_tokens: 9,
      },
      choices: [
        { index: 0, text: " first", finish_reason: "stop", seed: 40 },
        { index: 1, text: " second", finish_reason: "length", seed: 41 },
      ],
    });

    expect(model).toMatchObject({
      kind: "completion",
      readableText: " first\n\n second",
      shapeLabel: "2 completions",
      entries: [
        {
          text: " first",
          choiceIndex: 0,
          seed: "40",
          latencyMs: 1250,
        },
        {
          text: " second",
          choiceIndex: 1,
          seed: "41",
          latencyMs: 1250,
        },
      ],
    });
  });

  it("flattens wrapped lists of normalized and raw completion shapes", () => {
    const model = normalizePreviewValue({
      value: [
        {
          result: {
            kind: "completion_result",
            text: "normalized",
            request_id: "req-1",
          },
        },
        {
          choices: [{ text: "raw", index: 3 }],
        },
      ],
    });

    expect(model).toMatchObject({
      kind: "completion",
      readableText: "normalized\n\nraw",
      entries: [{ text: "normalized" }, { text: "raw", choiceIndex: 3 }],
    });
  });

  it("normalizes corruption records and preserves their provenance", () => {
    expect(
      normalizePreviewValue({
        kind: "corruption_result",
        input: "original",
        output: "orlginal",
        seed: 90210,
        spec: { name: "Typogre" },
      }),
    ).toMatchObject({
      kind: "text",
      readableText: "orlginal",
      shapeLabel: "1 text item",
      entries: [
        {
          text: "orlginal",
          label: "Typogre",
          seed: "90210",
          input: "original",
        },
      ],
    });
  });

  it.each([
    {
      name: "a mixed list",
      value: ["readable", { nested: true }],
      shapeLabel: "2 items",
    },
    {
      name: "an empty list",
      value: [],
      shapeLabel: "0 items",
    },
    {
      name: "an arbitrary object",
      value: { nested: { value: 3 } },
      shapeLabel: "Structured value",
    },
  ])("falls back to structured JSON for $name", ({ value, shapeLabel }) => {
    const model = normalizePreviewValue(value);
    expect(model).toMatchObject({
      kind: "structured",
      shapeLabel,
      raw: JSON.stringify(value, null, 2),
    });
  });
});
