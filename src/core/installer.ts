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
export function isZipUrl(url: string): boolean {
  return url.split("?")[0].split("#")[0].toLowerCase().endsWith(".zip");
}
export function extractCommand(archive: string, dest: string, platform: string, isZip: boolean): { cmd: string; args: string[] } {
  if (platform === "win32") {
    if (isZip) {
      const a = archive.replace(/'/g, "''"); const d = dest.replace(/'/g, "''");
      return { cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${a}' -DestinationPath '${d}' -Force`] };
    }
    return { cmd: "tar", args: ["-xf", archive, "-C", dest] };   // Windows bsdtar auto-detects
  }
  if (isZip) return { cmd: "unzip", args: ["-o", archive, "-d", dest] };
  return { cmd: "tar", args: ["-xzf", archive, "-C", dest] };
}
export async function extractArchive(archive: string, dest: string, platform: string, isZip: boolean): Promise<void> {
  const { cmd, args } = extractCommand(archive, dest, platform, isZip);
  const r = await runSpawn(cmd, args, { timeoutMs: 120000 });
  if (r.code !== 0) throw new Error(`解压失败 (${cmd} exit ${r.code}): ${r.stderr.slice(-400)}`);
}
export function atomicReplaceDir(tmpDir: string, destDir: string): void {
  const backup = destDir + ".old";
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
  const hadDest = fs.existsSync(destDir);
  if (hadDest) fs.renameSync(destDir, backup);
  try {
    fs.renameSync(tmpDir, destDir);
  } catch (e) {
    if (hadDest) { try { fs.renameSync(backup, destDir); } catch {} }   // restore old core on failure
    throw e;
  }
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
}
export async function withLock(lockFile: string, fn: () => Promise<void>): Promise<void> {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (fs.existsSync(lockFile)) {
    const pid = parseInt(fs.readFileSync(lockFile, "utf8").trim(), 10);
    let alive = false;
    if (Number.isFinite(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch {} }
    if (alive) throw new Error("install already in progress");
    try { fs.unlinkSync(lockFile); } catch {}   // stale lock from a dead process → recover
  }
  fs.writeFileSync(lockFile, String(process.pid));
  try { await fn(); } finally { try { fs.unlinkSync(lockFile); } catch {} }
}

export function defaultDownload(url: string, dest: string, timeoutMs = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("http://") ? http : https;
    const file = fs.createWriteStream(dest);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (fn: () => void) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); fn(); };
    const fail = (e: Error) => finish(() => { try { file.close(); } catch {} try { fs.unlinkSync(dest); } catch {} reject(e); });
    const succeed = () => finish(() => { try { file.close(() => resolve()); } catch { resolve(); } });
    file.on("error", fail);
    const req = mod.get(url, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        file.removeListener("error", fail);
        try { file.close(); } catch {} try { fs.unlinkSync(dest); } catch {}
        if (timer) clearTimeout(timer);
        defaultDownload(res.headers.location, dest, timeoutMs).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); fail(new Error(`HTTP ${code} for ${url}`)); return; }
      res.on("error", fail);            // response-stream error listener (the missing half)
      res.pipe(file);
      file.on("finish", succeed);
    });
    req.on("error", fail);
    timer = setTimeout(() => { try { req.destroy(new Error("download timeout")); } catch {} }, timeoutMs);
  });
}

export function httpGetText(url: string, timeoutMs = 30000, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("too many redirects")); return; }
    const mod = url.startsWith("http://") ? http : https;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const req = mod.get(url, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location) { res.resume(); done(() => {}); httpGetText(res.headers.location, timeoutMs, redirects + 1).then(resolve, reject); return; }
      if (code !== 200) { res.resume(); done(() => reject(new Error(`HTTP ${code} for ${url}`))); return; }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("error", (e) => done(() => reject(e)));
      res.on("end", () => done(() => resolve(body)));
    });
    req.on("error", (e) => done(() => reject(e)));
    timer = setTimeout(() => { try { req.destroy(new Error("manifest fetch timeout")); } catch {} }, timeoutMs);
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
    const pyIsZip = isZipUrl(entry.pythonUrl);
    const pyArchive = path.join(p.tmpDir, pyIsZip ? "python.zip" : "python.tar.gz");
    const einkZip = path.join(p.tmpDir, "eink.zip");
    log("下载便携 Python…"); await download(entry.pythonUrl, pyArchive);
    if (!verifySha256(pyArchive, entry.pythonSha256)) throw new Error("python sha256 mismatch");
    log("下载核心源码…"); await download(entry.einkUrl, einkZip);
    if (!verifySha256(einkZip, entry.einkSha256)) throw new Error("eink sha256 mismatch");
    const stage = path.join(p.tmpDir, "stage");
    fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
    log("解压 Python…");
    fs.mkdirSync(path.join(stage, "python"), { recursive: true });
    await extractArchive(pyArchive, path.join(stage, "python"), opts.platform, pyIsZip);
    fs.mkdirSync(path.join(stage, "eink"), { recursive: true });
    log("解压核心…"); await extractArchive(einkZip, path.join(stage, "eink"), opts.platform, true);
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
