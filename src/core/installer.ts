import fs from "fs";
import path from "path";
import crypto from "crypto";
import https from "https";
import http from "http";
import { CoreStore } from "./store";
import type { PlatformEntry } from "../types";
import { runSpawn } from "./process";

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
export function verifySha256(file: string, expected: string): boolean {
  return !!expected && sha256File(file) === expected.toLowerCase();
}
export function atomicReplaceDir(tmpDir: string, destDir: string): void {
  const backup = destDir + ".old";
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
  if (fs.existsSync(destDir)) fs.renameSync(destDir, backup);
  fs.renameSync(tmpDir, destDir);
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
}
export async function withLock(lockFile: string, fn: () => Promise<void>): Promise<void> {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (fs.existsSync(lockFile)) throw new Error("install already in progress");
  fs.writeFileSync(lockFile, String(process.pid));
  try { await fn(); } finally { try { fs.unlinkSync(lockFile); } catch {} }
}

function defaultDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("http://") ? http : https;
    const file = fs.createWriteStream(dest);
    const onFileError = (e: Error) => { try { fs.unlinkSync(dest); } catch {} reject(e); };
    file.on("error", onFileError);
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.removeListener("error", onFileError); file.close(); fs.unlinkSync(dest);
        defaultDownload(res.headers.location, dest).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      res.pipe(file); file.on("finish", () => file.close(() => resolve()));
    }).on("error", (e) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

export async function installCore(opts: {
  store: CoreStore; entry: PlatformEntry; version: string; manifestUrl: string;
  platform: string; arch: string;
  download?: (url: string, dest: string) => Promise<void>;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  const { store, entry } = opts;
  const download = opts.download ?? defaultDownload;
  const log = opts.onProgress ?? (() => {});
  const p = store.paths;
  fs.mkdirSync(p.tmpDir, { recursive: true });
  await withLock(path.join(store.coreDir, "install.lock"), async () => {
    const pyTar = path.join(p.tmpDir, "python.tar.gz");
    const einkZip = path.join(p.tmpDir, "eink.zip");
    log("下载便携 Python…"); await download(entry.pythonUrl, pyTar);
    if (!verifySha256(pyTar, entry.pythonSha256)) throw new Error("python sha256 mismatch");
    log("下载核心源码…"); await download(entry.einkUrl, einkZip);
    if (!verifySha256(einkZip, entry.einkSha256)) throw new Error("eink sha256 mismatch");
    const stage = path.join(p.tmpDir, "stage");
    fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
    // Extraction uses tar/unzip (darwin/linux). Windows extraction is verified per-OS in Task 12.
    log("解压 Python…");
    fs.mkdirSync(path.join(stage, "python"), { recursive: true });
    await runSpawn("tar", ["-xzf", pyTar, "-C", path.join(stage, "python")], { timeoutMs: 120000 });
    fs.mkdirSync(path.join(stage, "eink"), { recursive: true });
    log("解压核心…"); await runSpawn("unzip", ["-o", einkZip, "-d", path.join(stage, "eink")], { timeoutMs: 120000 });
    const python = opts.platform === "win32" ? path.join(stage, "python", "python.exe") : path.join(stage, "python", "bin", "python3");
    log("安装依赖…");
    // Ruling E: the eink zip has requirements.txt/server.py at the archive root.
    const req = path.join(stage, "eink", "requirements.txt");
    const r = await runSpawn(python, ["-m", "pip", "install", "-r", req], { timeoutMs: 300000 });
    if (r.code !== 0) throw new Error("pip install failed: " + r.stderr.slice(-400));
    log("原子替换核心目录…");
    atomicReplaceDir(path.join(stage, "python"), path.join(store.coreDir, "python"));
    atomicReplaceDir(path.join(stage, "eink"), path.join(store.coreDir, "eink"));
    store.writeCoreJson({ version: opts.version, installedAt: Date.now(), source: { manifestUrl: opts.manifestUrl, pythonSha256: entry.pythonSha256, einkSha256: entry.einkSha256 }, launchMode: null, platform: opts.platform, arch: opts.arch });
    fs.rmSync(p.tmpDir, { recursive: true, force: true });
    log("安装完成");
  });
}