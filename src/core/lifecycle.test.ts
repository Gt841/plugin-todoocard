import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreLifecycle } from "./lifecycle";
import { CoreStore } from "./store";

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-"));
  const store = new CoreStore(dir);
  store.writeCoreJson({ version: "2.0.0", coreVersion: "1.0.11", coreCommit: "3642b4b25e42e38776f3227db601474173f915b1", installedAt: 1, source: { manifestUrl: "", sourceSha256: "", pythonSha256: "", extensionSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
  const ctx: any = { python: "/py", serverPy: "/e/server.py", einkDir: "/e", coreDir: dir, port: 8199, platform: "darwin", pidFile: store.paths.pidFile, logFile: store.paths.logFile, probePy: "/probe.py", disclaimPy: "/dis.py", terminalTpl: "/tpl" };
  return { store, ctx, dir };
}

describe("CoreLifecycle", () => {
  it("start uses cached mode without preflight", async () => {
    const { store, ctx } = mk();
    store.setCachedMode("direct");
    const launch = vi.fn(async () => ({ pid: 999 }));
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { launchCore: launch, runPreflight: vi.fn() } as any);
    const r = await lc.start();
    expect(r.mode).toBe("direct"); expect(r.pid).toBe(999);
    expect(launch).toHaveBeenCalledWith("direct", ctx);
  });
  it("start runs cascade when no cache and caches winner", async () => {
    const { store, ctx } = mk();
    const launch = vi.fn(async () => ({ pid: 5 }));
    const preflight = vi.fn(async () => ({ ok: true } as any));
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { launchCore: launch, runPreflight: preflight } as any);
    const r = await lc.start();
    expect(r.mode).toBe("direct");
    expect(store.getCachedMode()).toBe("direct");
  });
  it("stop kills running pid and clears pid file", () => {
    const { store, ctx } = mk();
    fs.mkdirSync(path.dirname(ctx.pidFile), { recursive: true });
    fs.writeFileSync(ctx.pidFile, "12345");
    const kill = vi.fn();
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { killTree: kill } as any);
    lc.stop();
    expect(kill).toHaveBeenCalledWith(12345);
    expect(fs.existsSync(ctx.pidFile)).toBe(false);
  });
  it("installExitHook registers siyuan-save-close and stops", () => {
    const { store, ctx } = mk();
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { killTree: vi.fn() } as any);
    let cb: () => void = () => {};
    const ipc = { on: (ch: string, f: () => void) => { if (ch === "siyuan-save-close") cb = f; } };
    const stopSpy = vi.spyOn(lc, "stop");
    lc.installExitHook(ipc);
    cb();
    expect(stopSpy).toHaveBeenCalled();
  });
});
