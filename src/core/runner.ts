import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";

export interface RunOptions {
  timeoutMs: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  onStart?: (pid: number) => void;
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  lines: string[];
  canceled: boolean;
  timedOut: boolean;
}

function shellPathEnv(): NodeJS.ProcessEnv {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const current = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const p of extra) if (!current.includes(p)) current.push(p);
  return { ...process.env, PATH: current.join(path.delimiter), LANG: process.env.LANG || "en_US.UTF-8" };
}

/**
 * 上游 Skill 的脚本每次都会把 scripts 复制到 /tmp 再编译 Swift，属于一次性 CLI。
 * 这里以独立进程组运行，支持中途取消（连同 swiftc / sender 子进程一起终止）。
 */
export class SkillRunner {
  private child: ChildProcess | null = null;
  private canceled = false;
  private timedOut = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private scriptsDir: string) {}

  get running(): boolean {
    return !!this.child;
  }

  get scriptPath(): string {
    return path.join(this.scriptsDir, "prepare_and_send.sh");
  }

  canRun(): boolean {
    return fs.existsSync(this.scriptPath);
  }

  async run(args: string[], opts: RunOptions): Promise<RunResult> {
    if (this.child) throw new Error("已有操作进行中");
    this.canceled = false;
    this.timedOut = false;
    const lines: string[] = [];
    const child = spawn("/bin/bash", [this.scriptPath, ...args], {
      cwd: this.scriptsDir,
      env: shellPathEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    if (child.pid) opts.onStart?.(child.pid);

    const handle = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (!line) continue;
        lines.push(line);
        try { opts.onLine?.(line, stream); } catch {}
      }
    };
    child.stdout?.on("data", (d: Buffer) => handle(d, "stdout"));
    child.stderr?.on("data", (d: Buffer) => handle(d, "stderr"));

    return await new Promise<RunResult>((resolve) => {
      let settled = false;
      const finish = (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.child = null;
        resolve({ code, signal, lines, canceled: this.canceled, timedOut: this.timedOut });
      };
      this.timer = setTimeout(() => {
        this.timedOut = true;
        this.killGroup("SIGKILL");
      }, opts.timeoutMs);
      child.on("error", (e) => {
        lines.push(`spawn error: ${e.message}`);
        finish(-1, null);
      });
      child.on("close", (code, signal) => finish(code, signal));
    });
  }

  cancel(): void {
    this.canceled = true;
    this.killGroup("SIGTERM");
    const pid = this.child?.pid;
    setTimeout(() => {
      if (this.child && this.child.pid === pid) this.killGroup("SIGKILL");
    }, 1500);
  }

  private killGroup(signal: NodeJS.Signals): void {
    const child = this.child;
    if (!child?.pid) return;
    try { process.kill(-child.pid, signal); }
    catch { try { child.kill(signal); } catch {} }
  }
}
