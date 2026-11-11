import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { LaunchMode, ProbeResult } from "../types";
import { writePid, readPid } from "./process";

export async function selectMode(
  modes: LaunchMode[],
  probe: (m: LaunchMode) => Promise<ProbeResult>,
): Promise<{ mode: LaunchMode | null; results: { mode: LaunchMode; result: ProbeResult }[] }> {
  const results: { mode: LaunchMode; result: ProbeResult }[] = [];
  for (const m of modes) {
    const result = await probe(m);
    results.push({ mode: m, result });
    if (result.ok) return { mode: m, results };
  }
  return { mode: null, results };
}

export interface LaunchCtx {
  python: string; serverPy: string; einkDir: string; coreDir: string; port: number;
  platform: string; pidFile: string; logFile: string; probePy: string; disclaimPy: string; terminalTpl: string;
}

export function pythonExe(coreDir: string, platform: string): string {
  return platform === "win32" ? path.join(coreDir, "python", "python.exe") : path.join(coreDir, "python", "bin", "python3");
}

export function buildCoreEnv(platform: string, base: Record<string, string>): Record<string, string> {
  const env = { ...base };
  if (platform === "darwin") env.TODOOCARD_FORCE_PYTHON = "1";
  return env;
}

export function renderTerminalCommand(tpl: string, vars: { python: string; einkDir: string; pidFile: string; logFile: string; port: number }): string {
  return tpl
    .replace(/{{python}}/g, vars.python).replace(/{{einkDir}}/g, vars.einkDir)
    .replace(/{{pidFile}}/g, vars.pidFile).replace(/{{logFile}}/g, vars.logFile)
    .replace(/{{port}}/g, String(vars.port));
}

export function preflightCmd(mode: LaunchMode, ctx: LaunchCtx, resultFile: string): { cmd: string; args: string[] } {
  if (mode === "disclaim") return { cmd: ctx.python, args: [ctx.disclaimPy, ctx.python, ctx.probePy, resultFile, "preflight-disclaim"] };
  if (mode === "terminal") return { cmd: ctx.python, args: [ctx.probePy, resultFile, "preflight-terminal"] }; // terminal preflight run via open in launchCore path; see note
  return { cmd: ctx.python, args: [ctx.probePy, resultFile, "preflight-direct"] };
}

export async function launchCore(mode: LaunchMode, ctx: LaunchCtx): Promise<{ pid: number }> {
  fs.mkdirSync(path.dirname(ctx.pidFile), { recursive: true });
  const env = buildCoreEnv(ctx.platform, process.env as Record<string, string>);
  env.PORT = String(ctx.port); // server.py reads PORT from env (no --port flag); covers direct & disclaim, terminal gets it via template
  if (mode === "direct") {
    const child = spawn(ctx.python, [ctx.serverPy], { cwd: ctx.einkDir, env, detached: process.platform !== "win32", stdio: ["ignore", fs.openSync(ctx.logFile, "a"), fs.openSync(ctx.logFile, "a")] });
    child.on("error", () => {}); // swallow async spawn error so a missing python cannot crash the host (mirrors runSpawn/killTree)
    child.unref();
    if (child.pid === undefined) throw new Error("core spawn failed: python executable not found or not spawnable");
    writePid(ctx.pidFile, child.pid);
    return { pid: child.pid };
  }
  if (mode === "disclaim") {
    const child = spawn(ctx.python, [ctx.disclaimPy, ctx.python, ctx.serverPy], { cwd: ctx.einkDir, env, stdio: ["ignore", "pipe", fs.openSync(ctx.logFile, "a")] });
    const pid = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("disclaim PID timeout")), 15000);
      child.stdout!.on("data", (d) => {
        const m = /PID (\d+)/.exec(d.toString());
        if (m) { clearTimeout(t); resolve(parseInt(m[1], 10)); }
      });
      child.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    writePid(ctx.pidFile, pid);
    return { pid };
  }
  // terminal
  const tpl = fs.readFileSync(ctx.terminalTpl, "utf8");
  const cmdFile = path.join(ctx.coreDir, "run", "start-terminal.command");
  fs.writeFileSync(cmdFile, renderTerminalCommand(tpl, { python: ctx.python, einkDir: ctx.einkDir, pidFile: ctx.pidFile, logFile: ctx.logFile, port: ctx.port }));
  fs.chmodSync(cmdFile, 0o755);
  try { fs.unlinkSync(ctx.pidFile); } catch {}
  const opener = spawn("open", ["-a", "Terminal", cmdFile], { detached: true, stdio: "ignore" });
  opener.on("error", () => {}); // swallow async spawn error; the pidFile poll below times out if Terminal never starts
  opener.unref();
  const pid = await new Promise<number>((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const p = readPid(ctx.pidFile);
      if (p) { clearInterval(iv); resolve(p); }
      else if (Date.now() - start > 30000) { clearInterval(iv); reject(new Error("terminal PID timeout")); }
    }, 500);
  });
  return { pid };
}
