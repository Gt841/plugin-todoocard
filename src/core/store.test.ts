import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreStore, defaultCoreDir } from "./store";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-")); });

describe("defaultCoreDir", () => {
  it("appends todoocard-core to dataDir", () => {
    expect(defaultCoreDir("/data")).toBe(path.join("/data", "todoocard-core"));
  });
});

describe("CoreStore.detect", () => {
  it("not-installed when empty", () => {
    expect(new CoreStore(dir).detect()).toBe("not-installed");
  });
  it("installed when python + server.py + core.json present", () => {
    const s = new CoreStore(dir);
    fs.mkdirSync(path.dirname(s.paths.python), { recursive: true });
    fs.writeFileSync(s.paths.python, "#!/bin/sh\n");
    fs.mkdirSync(path.dirname(s.paths.serverPy), { recursive: true });
    fs.writeFileSync(s.paths.serverPy, "");
    s.writeCoreJson({ version: "1.0.0", installedAt: 1, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
    expect(s.detect()).toBe("installed");
  });
});

describe("CoreStore cached mode", () => {
  it("round-trips launchMode", () => {
    const s = new CoreStore(dir);
    s.writeCoreJson({ version: "1.0.0", installedAt: 1, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
    expect(s.getCachedMode()).toBeNull();
    s.setCachedMode("disclaim");
    expect(s.getCachedMode()).toBe("disclaim");
    expect(new CoreStore(dir).readCoreJson()!.launchMode).toBe("disclaim");
  });
  it("readCoreJson returns null on missing/corrupt", () => {
    expect(new CoreStore(dir).readCoreJson()).toBeNull();
    fs.writeFileSync(new CoreStore(dir).paths.coreJson, "{bad");
    expect(new CoreStore(dir).readCoreJson()).toBeNull();
  });
});

describe("detect platform-aware python path", () => {
  function mkStore(platform: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
    const s = new CoreStore(dir, platform);
    fs.mkdirSync(path.join(dir, "eink"), { recursive: true });
    fs.writeFileSync(path.join(dir, "eink", "server.py"), "");
    s.writeCoreJson({ version: "1.0.0", installedAt: 0, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform, arch: "x64" });
    return { dir, s };
  }
  it("win32: installed when python/python.exe exists", () => {
    const { dir, s } = mkStore("win32");
    fs.mkdirSync(path.join(dir, "python"), { recursive: true });
    fs.writeFileSync(path.join(dir, "python", "python.exe"), "");
    expect(s.detect()).toBe("installed");
  });
  it("win32: not-installed when only posix layout exists", () => {
    const { dir, s } = mkStore("win32");
    fs.mkdirSync(path.join(dir, "python", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "python", "bin", "python3"), "");
    expect(s.detect()).toBe("not-installed");
  });
  it("darwin: installed when python/bin/python3 exists", () => {
    const { dir, s } = mkStore("darwin");
    fs.mkdirSync(path.join(dir, "python", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "python", "bin", "python3"), "");
    expect(s.detect()).toBe("installed");
  });
});
