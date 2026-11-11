import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, normalizeLaunch } from "./settings";

describe("settings", () => {
  it("defaults to auto launch and port 8199", () => {
    expect(DEFAULT_SETTINGS.launch).toBe("auto");
    expect(DEFAULT_SETTINGS.port).toBe(8199);
  });
  it("normalizeLaunch accepts valid modes", () => {
    expect(normalizeLaunch("direct")).toBe("direct");
    expect(normalizeLaunch("disclaim")).toBe("disclaim");
    expect(normalizeLaunch("terminal")).toBe("terminal");
    expect(normalizeLaunch("auto")).toBe("auto");
  });
  it("normalizeLaunch falls back to auto on garbage", () => {
    expect(normalizeLaunch("bogus")).toBe("auto");
    expect(normalizeLaunch(undefined)).toBe("auto");
    expect(normalizeLaunch(42)).toBe("auto");
  });
});