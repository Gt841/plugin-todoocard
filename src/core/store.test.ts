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