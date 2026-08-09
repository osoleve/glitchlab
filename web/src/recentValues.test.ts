import { beforeEach, describe, expect, it } from "vitest";
import { loadRecentValues, rememberRecentValue } from "./recentValues";

describe("recent endpoint and model values", () => {
  beforeEach(() => localStorage.clear());

  it("keeps unique most-recent-first values locally", () => {
    rememberRecentValue("endpoint", " http://models.test/v1 ");
    rememberRecentValue("endpoint", "http://other.test/v1");
    rememberRecentValue("endpoint", "http://models.test/v1");

    expect(loadRecentValues("endpoint")).toEqual(["http://models.test/v1", "http://other.test/v1"]);
    expect(loadRecentValues("model")).toEqual([]);
  });

  it("does not save empty or starter-placeholder model IDs", () => {
    rememberRecentValue("model", " ");
    rememberRecentValue("model", "model-id");
    rememberRecentValue("model", "first-model-id");
    rememberRecentValue("model", "second-model-id");

    expect(loadRecentValues("model")).toEqual([]);
  });
});
