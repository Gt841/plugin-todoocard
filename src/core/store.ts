import fs from "fs";
import path from "path";
import type { CoreJson, CoreStatus, LaunchMode } from "../types";
import { pythonExe } from "./launcher";

export function defaultCoreDir(dataDir: string): string {
  return path.join(dataDir, "todoocard-core");
}

export class CoreStore {
  constructor(public readonly coreDir: string, private platform: string = process.platform) {}

  get paths() {
    const runDir = path.join(this.coreDir, "run");
    return {
      python: pythonExe(this.coreDir, this.platform),
      eink: path.join(this.coreDir, "eink"),
      serverPy: path.join(this.coreDir, "eink", "server.py"),
      coreJson: path.join(this.coreDir, "core.json"),
      runDir,
      pidFile: path.join(runDir, "core.pid"),
      logFile: path.join(runDir, "core.log"),
      tmpDir: path.join(runDir, "tmp"),
    };
  }

  readCoreJson(): CoreJson | null {
    try { return JSON.parse(fs.readFileSync(this.paths.coreJson, "utf8")) as CoreJson; }
    catch { return null; }
  }

  writeCoreJson(v: CoreJson): void {
    fs.mkdirSync(this.coreDir, { recursive: true });
    fs.writeFileSync(this.paths.coreJson, JSON.stringify(v, null, 2));
  }

  detect(): CoreStatus {
    const cj = this.readCoreJson();
    if (!cj) return "not-installed";
    if (!fs.existsSync(this.paths.python) || !fs.existsSync(this.paths.serverPy)) return "not-installed";
    return "installed"; // update-available decided by installer comparing manifest version
  }

  getCachedMode(): LaunchMode | null { return this.readCoreJson()?.launchMode ?? null; }

  setCachedMode(m: LaunchMode | null): void {
    const cj = this.readCoreJson();
    if (!cj) return;
    cj.launchMode = m;
    this.writeCoreJson(cj);
  }
}
