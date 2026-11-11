import { describe, it, expect } from "vitest";
import { selectMode, buildCoreEnv, renderTerminalCommand, pythonExe, preflightCmd } from "./launcher";
import type { ProbeResult } from "../types";

const ok: ProbeResult = { ok: true, exitCode: 0, signal: null, timedOut: false, authorization: "allowedAlways", devices_count: 3, is_self: false, responsible_comm: null, responsible_app: null, error: null };
const bad: ProbeResult = { ...ok, ok: false, signal: "SIGABRT" };

describe("selectMode", () => {
  it("stops at first ok (①)", async () => {
    const seen: string[] = [];
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => { seen.push(m); return ok; });
    expect(r.mode).toBe("direct");
    expect(seen).toEqual(["direct"]);
  });
  it("falls back ①→② when ① fails", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "direct" ? bad : ok);
    expect(r.mode).toBe("disclaim");
    expect(r.results.map((x) => x.mode)).toEqual(["direct", "disclaim"]);
  });
  it("falls back to ④ when ①② fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "terminal" ? ok : bad);
    expect(r.mode).toBe("terminal");
  });
  it("null when all fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async () => bad);
    expect(r.mode).toBeNull();
    expect(r.results).toHaveLength(3);
  });
});

describe("buildCoreEnv", () => {
  it("sets TODOOCARD_FORCE_PYTHON on darwin", () => {
    expect(buildCoreEnv("darwin", { A: "1" }).TODOOCARD_FORCE_PYTHON).toBe("1");
  });
  it("does not set it on win32", () => {
    expect(buildCoreEnv("win32", {}).TODOOCARD_FORCE_PYTHON).toBeUndefined();
  });
});

describe("pythonExe", () => {
  it("darwin uses bin/python3", () => { expect(pythonExe("/c", "darwin")).toBe("/c/python/bin/python3"); });
  it("win32 uses python.exe", () => { expect(pythonExe("/c", "win32")).toBe("/c/python/python.exe"); });
});

describe("renderTerminalCommand", () => {
  it("substitutes all vars", () => {
    const out = renderTerminalCommand('P={{python}} E={{einkDir}} PID={{pidFile}} L={{logFile}} PORT={{port}}',
      { python: "/py", einkDir: "/e", pidFile: "/p", logFile: "/l", port: 8199 });
    expect(out).toBe("P=/py E=/e PID=/p L=/l PORT=8199");
  });
});

describe("preflightCmd", () => {
  const ctx: any = { python: "/py", probePy: "/probe.py", disclaimPy: "/dis.py", platform: "darwin" };
  it("direct runs probe directly", () => {
    const c = preflightCmd("direct", ctx, "/r.json");
    expect(c.cmd).toBe("/py"); expect(c.args).toEqual(["/probe.py", "/r.json", "preflight-direct"]);
  });
  it("disclaim wraps probe in disclaim supervisor", () => {
    const c = preflightCmd("disclaim", ctx, "/r.json");
    expect(c.cmd).toBe("/py"); expect(c.args).toEqual(["/dis.py", "/py", "/probe.py", "/r.json", "preflight-disclaim"]);
  });
});
