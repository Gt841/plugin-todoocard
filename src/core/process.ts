import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export interface SpawnResult {
  code: number | null; signal: string | null;
  stdout: string; stderr: string; timedOut: boolean;
}

export function runSpawn(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs: number }): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timedOut = false;
    let child;
    try { child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env }); }
    catch (e) { resolve({ code: -1, signal: null, stdout: "", stderr: String(e), timedOut: false }); return; }
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch {} }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ code: -1, signal: null, stdout, stderr: stderr + String(e), timedOut }); });
    child.on("close", (code, signal) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}

export function killTree(pid: number): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try { const tk = spawn("taskkill", ["/PID", String(pid), "/T", "/F"]); tk.on("error", () => {}); } catch {}
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
}

export function writePid(file: string, pid: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid));
}

export function readPid(file: string): number | null {
  try { const n = parseInt(fs.readFileSync(file, "utf8").trim(), 10); return Number.isFinite(n) && n > 0 ? n : null; }
  catch { return null; }
}