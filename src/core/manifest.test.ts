import { describe, it, expect } from "vitest";
import { platformKey, parseManifest, selectPlatform, compareVersion } from "./manifest";

const ENTRY = {
  sourceUrl: "s", sourceSha256: "sa",
  pythonUrl: "p", pythonSha256: "pa",
  extensionUrl: "e", extensionSha256: "ea",
};
const SAMPLE = JSON.stringify({
  version: "2.0.0",
  coreVersion: "1.0.11",
  coreCommit: "3642b4b25e42e38776f3227db601474173f915b1",
  coreTag: "v1.0.11-macos",
  platforms: {
    "darwin-arm64": ENTRY,
    "windows-x64": { ...ENTRY, pythonUrl: "p2" },
  },
});

describe("platformKey", () => {
  it("joins platform-arch", () => { expect(platformKey("darwin", "arm64")).toBe("darwin-arm64"); });
  it("maps win32 to windows", () => { expect(platformKey("win32", "x64")).toBe("windows-x64"); });
});

describe("parseManifest (v2)", () => {
  it("parses valid and keeps version fields", () => {
    const m = parseManifest(SAMPLE);
    expect(m.version).toBe("2.0.0");
    expect(m.coreVersion).toBe("1.0.11");
    expect(m.coreCommit).toBe("3642b4b25e42e38776f3227db601474173f915b1");
    expect(m.coreTag).toBe("v1.0.11-macos");
  });
  it("throws on bad json", () => { expect(() => parseManifest("{bad")).toThrow(); });
  it("throws on missing platforms", () => { expect(() => parseManifest('{"version":"1"}')).toThrow(); });
  it("throws when coreVersion is missing (v1 manifest)", () => {
    const v1 = { version: "1.0.3", platforms: { "darwin-arm64": { pythonUrl: "p", einkUrl: "e" } } };
    expect(() => parseManifest(JSON.stringify(v1))).toThrow(/coreVersion/);
  });
  it("throws when coreCommit is missing", () => {
    const bad = JSON.parse(SAMPLE); delete bad.coreCommit;
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(/coreCommit/);
  });
  it("coreTag is optional (display only)", () => {
    const noTag = JSON.parse(SAMPLE); delete noTag.coreTag;
    expect(parseManifest(JSON.stringify(noTag)).coreTag).toBeUndefined();
  });
});

describe("selectPlatform (v2)", () => {
  it("returns entry", () => {
    expect(selectPlatform(parseManifest(SAMPLE), "darwin-arm64").sourceUrl).toBe("s");
  });
  it("throws on missing key", () => {
    expect(() => selectPlatform(parseManifest(SAMPLE), "linux-x64")).toThrow();
  });
  it("throws on incomplete entry (missing extensionUrl)", () => {
    const bad = JSON.parse(SAMPLE);
    delete bad.platforms["darwin-arm64"].extensionUrl;
    expect(() => selectPlatform(parseManifest(JSON.stringify(bad)), "darwin-arm64"))
      .toThrow(/extensionUrl/);
  });
  it("throws on missing sha256 field", () => {
    const bad = JSON.parse(SAMPLE);
    delete bad.platforms["darwin-arm64"].sourceSha256;
    expect(() => selectPlatform(parseManifest(JSON.stringify(bad)), "darwin-arm64"))
      .toThrow(/sourceSha256/);
  });
});

describe("compareVersion", () => {
  it("orders numerically", () => {
    expect(compareVersion("1.0.3", "1.0.10")).toBeLessThan(0);
    expect(compareVersion("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersion("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });
});
