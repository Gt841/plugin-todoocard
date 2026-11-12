import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreStore, defaultCoreDir, coreVersionOf } from "./store";
import type { CoreJson } from "../types";

function v2(platform = "darwin", arch = "arm64"): CoreJson {
  return {
    version: "2.0.0",
    coreVersion: "1.0.11",
    coreCommit: "3642b4b25e42e38776f3227db601474173f915b1",
    installedAt: 1,
    source: { manifestUrl: "", sourceSha256: "s", pythonSha256: "p", extensionSha256: "e" },
    launchMode: null, platform, arch,
  };
}

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
    s.writeCoreJson(v2());
    expect(s.detect()).toBe("installed");
  });
});

describe("CoreStore cached mode", () => {
  it("round-trips launchMode", () => {
    const s = new CoreStore(dir);
    s.writeCoreJson(v2());
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
    s.writeCoreJson(v2(platform, "x64"));
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

describe("core.json v2 + migration", () => {
  it("round-trips coreVersion / coreCommit / three sha256 fields", () => {
    const s = new CoreStore(dir);
    const cj = v2();
    s.writeCoreJson(cj);
    const read = s.readCoreJson()!;
    expect(read.coreVersion).toBe("1.0.11");
    expect(read.coreCommit).toBe("3642b4b25e42e38776f3227db601474173f915b1");
    expect(read.source).toEqual(cj.source);
  });
  it("coreVersionOf returns the v2 version", () => {
    expect(coreVersionOf(v2())).toBe("1.0.11");
  });
  it("coreVersionOf(null) is 0.0.0", () => {
    expect(coreVersionOf(null)).toBe("0.0.0");
  });
  it("legacy core.json (no coreVersion) still detects as installed, but version is 0.0.0", () => {
    const s = new CoreStore(dir);
    fs.mkdirSync(path.dirname(s.paths.python), { recursive: true });
    fs.writeFileSync(s.paths.python, "#!/bin/sh\n");
    fs.mkdirSync(path.dirname(s.paths.serverPy), { recursive: true });
    fs.writeFileSync(s.paths.serverPy, "");
    fs.writeFileSync(s.paths.coreJson, JSON.stringify({
      version: "1.0.0", installedAt: 1,
      source: { manifestUrl: "", pythonSha256: "", einkSha256: "" },
      launchMode: null, platform: "darwin", arch: "arm64",
    }));
    expect(s.detect()).toBe("installed");               // 不因缺字段判 not-installed
    expect(coreVersionOf(s.readCoreJson())).toBe("0.0.0"); // doInstall 据此必更新 → 写 v2
  });
});
