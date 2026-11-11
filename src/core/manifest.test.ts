import { describe, it, expect } from "vitest";
import { platformKey, parseManifest, selectPlatform, compareVersion } from "./manifest";

const SAMPLE = JSON.stringify({
  version: "1.0.3",
  platforms: {
    "darwin-arm64": { pythonUrl: "p", pythonSha256: "a", einkUrl: "e", einkSha256: "b" },
    "windows-x64": { pythonUrl: "p2", pythonSha256: "c", einkUrl: "e2", einkSha256: "d" },
  },
});

describe("platformKey", () => {
  it("joins platform-arch", () => { expect(platformKey("darwin", "arm64")).toBe("darwin-arm64"); });
  it("maps win32 to windows", () => { expect(platformKey("win32", "x64")).toBe("windows-x64"); });
});

describe("parseManifest", () => {
  it("parses valid", () => { expect(parseManifest(SAMPLE).version).toBe("1.0.3"); });
  it("throws on bad json", () => { expect(() => parseManifest("{bad")).toThrow(); });
  it("throws on missing platforms", () => { expect(() => parseManifest('{"version":"1"}')).toThrow(); });
});

describe("selectPlatform", () => {
  it("returns entry", () => { expect(selectPlatform(parseManifest(SAMPLE), "darwin-arm64").einkUrl).toBe("e"); });
  it("throws on missing key", () => { expect(() => selectPlatform(parseManifest(SAMPLE), "linux-x64")).toThrow(); });
});

describe("compareVersion", () => {
  it("orders numerically", () => {
    expect(compareVersion("1.0.3", "1.0.10")).toBeLessThan(0);
    expect(compareVersion("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersion("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });
});