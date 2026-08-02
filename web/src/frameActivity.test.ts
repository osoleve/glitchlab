import { describe, expect, it } from "vitest";
import { frameAggregate } from "./frameActivity";
import type { LoomNode } from "./types";

const node = (id: string, runStatus: LoomNode["data"]["runStatus"] = "idle") =>
  ({ id, data: { title: id, runStatus } }) as LoomNode;

describe("frame aggregate status", () => {
  it("reports a partial count when a target run leaves children unscoped", () => {
    const aggregate = frameAggregate(
      [node("done", "completed"), node("outside")],
      new Set(["done"]),
      new Set(["done"]),
    );

    expect(aggregate).toMatchObject({ status: "partial", completedCount: 1, totalCount: 2 });
  });

  it("only reports fully completed when every child was scoped and completed", () => {
    const children = [node("one", "completed"), node("two", "completed")];
    expect(frameAggregate(children, new Set(["one", "two"]), new Set()).status).toBe("completed");
    expect(frameAggregate(children, new Set(["one"]), new Set()).status).toBe("partial");
  });
});
