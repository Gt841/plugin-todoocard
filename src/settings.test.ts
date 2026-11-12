import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, DIST_MANIFEST_URL, normalizeLaunch, resolveModes } from "./settings";

describe("settings", () => {
  it("defaults to auto launch and port 8199", () => {
    expect(DEFAULT_SETTINGS.launch).toBe("auto");
    expect(DEFAULT_SETTINGS.port).toBe(8199);
  });
  it("defaults manifestUrl to the published dist Pages manifest", () => {
    expect(DEFAULT_SETTINGS.manifestUrl).toBe(DIST_MANIFEST_URL);
    expect(DEFAULT_SETTINGS.manifestUrl).toMatch(/^https:\/\/.+\/manifest\.json$/);
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

describe("resolveModes", () => {
  it("auto on darwin cascades ①②④", () => {
    expect(resolveModes("auto", "darwin")).toEqual(["direct", "disclaim", "terminal"]);
  });
  it("auto on non-darwin is direct only", () => {
    expect(resolveModes("auto", "win32")).toEqual(["direct"]);
    expect(resolveModes("auto", "linux")).toEqual(["direct"]);
  });
  it("forced mode is single regardless of platform", () => {
    expect(resolveModes("disclaim", "darwin")).toEqual(["disclaim"]);
    expect(resolveModes("terminal", "darwin")).toEqual(["terminal"]);
  });
});