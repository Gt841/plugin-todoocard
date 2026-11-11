import fs from "fs";
import { spawn } from "child_process";
import type { LaunchMode, LaunchSetting, ProbeResult } from "../types";
import { CoreStore } from "./store";
import { selectMode, launchCore as realLaunch, preflightCmd, terminalProbeCommand, type LaunchCtx } from "./launcher";
import { runPreflight as realPreflight } from "./preflight";
import { resolveModes } from "../settings";
import { readPid, killTree as realKill } from "./process";

interface Deps {
  launchCore?: typeof realLaunch;
  runPreflight?: (cmd: string, args: string[], resultFile: string, timeoutMs: number) => Promise<ProbeResult>;
  killTree?: typeof realKill;
}

export class CoreLifecycle {
  private launch: typeof realLaunch;
  private preflight: NonNullable<Deps["runPreflight"]>;
  private kill: typeof realKill;
  constructor(
    private cfg: { store: CoreStore; ctx: LaunchCtx; setting: LaunchSetting; platform: string },
    deps: Deps = {},
  ) {
    this.launch = deps.launchCore ?? realLaunch;
    this.preflight = deps.runPreflight ?? realPreflight;
    this.kill = deps.killTree ?? realKill;
  }

  runningPid(): number | null { return readPid(this.cfg.store.paths.pidFile); }

  async start(): Promise<{ mode: LaunchMode; pid: number }> {
    const { store, ctx, setting, platform } = this.cfg;
    let mode = store.getCachedMode();
    if (!mode) {
      fs.mkdirSync(store.paths.runDir, { recursive: true }); // preflight result files + terminal .command are written here; must exist on a fresh core dir
      const modes = resolveModes(setting, platform);
      const sel = await selectMode(modes, (m) => this.probeMode(m, `${store.paths.runDir}/preflight-${m}.json`));
      if (!sel.mode) throw new Error("三种启动方式均不可用（BLE 预检全失败），请检查蓝牙权限/配对");
      mode = sel.mode;
      store.setCachedMode(mode);
    }
    const { pid } = await this.launch(mode, ctx);
    return { mode, pid };
  }

  private async probeMode(m: LaunchMode, resultFile: string): Promise<ProbeResult> {
    // Entire body is try/caught: selectMode propagates probe rejections, so any error here
    // (fs ENOENT, spawn failure, bad JSON, rejected preflight) must degrade to ok:false and
    // let the cascade fall through to the next mode instead of aborting start().
    try {
      const { store, ctx } = this.cfg;
      if (m === "terminal") {
        const cmdFile = `${store.paths.runDir}/probe-terminal.command`;
        fs.writeFileSync(cmdFile, terminalProbeCommand(ctx, resultFile));
        fs.chmodSync(cmdFile, 0o755);
        try { fs.unlinkSync(resultFile); } catch {}
        const opener = spawn("open", ["-a", "Terminal", cmdFile], { detached: true, stdio: "ignore" });
        opener.on("error", () => {}); // swallow async spawn error; the result-file poll below times out if Terminal never starts
        opener.unref();
        const start = Date.now();
        while (Date.now() - start < 40000) {
          await new Promise((r) => setTimeout(r, 1000));
          try { return JSON.parse(fs.readFileSync(resultFile, "utf8")).ok === true
            ? { ok: true, exitCode: 0, signal: null, timedOut: false, authorization: null, devices_count: null, is_self: null, responsible_comm: "Terminal", responsible_app: "Terminal.app", error: null }
            : { ok: false, exitCode: null, signal: null, timedOut: false, authorization: null, devices_count: null, is_self: null, responsible_comm: null, responsible_app: null, error: "probe not ok" }; } catch {}
        }
        return { ok: false, exitCode: null, signal: null, timedOut: true, authorization: null, devices_count: null, is_self: null, responsible_comm: null, responsible_app: null, error: "terminal probe timeout" };
      }
      const c = preflightCmd(m, ctx, resultFile);
      return await this.preflight(c.cmd, c.args, resultFile, 20000);
    } catch (e) {
      return { ok: false, exitCode: null, signal: null, timedOut: false, authorization: null, devices_count: null, is_self: null, responsible_comm: null, responsible_app: null, error: String(e) };
    }
  }

  stop(): void {
    const pid = this.runningPid();
    if (pid) this.kill(pid);
    try { fs.unlinkSync(this.cfg.store.paths.pidFile); } catch {}
  }

  detectStale(): number | null {
    const pid = this.runningPid();
    if (!pid) return null;
    try { process.kill(pid, 0); return pid; } catch { return null; }
  }

  installExitHook(ipc: { on: (ch: string, cb: () => void) => void }): void {
    ipc.on("siyuan-save-close", () => this.stop());
  }
}
