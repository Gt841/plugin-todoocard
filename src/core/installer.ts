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

/**
 * GitHub archive 解压后是 todoocard-eink-<commit-sha>/ 一层；把它提升为 stage/eink
 * （使 server.py 落在根）。已扁平（根下直接有 server.py）则原样提升，幂等。
 * 目录名与钉死的 coreCommit 不符即中止——这是三重版本守卫的第 2 重。
 */
export function normalizeSourceDir(rawDir: string, coreCommit: string, stageEink: string): void {
  const flat = path.join(rawDir, "server.py");
  if (fs.existsSync(flat)) {
    fs.mkdirSync(path.dirname(stageEink), { recursive: true });
    fs.renameSync(rawDir, stageEink);
    return;
  }
  const entries = fs.readdirSync(rawDir).filter((n) => !n.startsWith("."));
  const expected = `todoocard-eink-${coreCommit}`;
  if (entries.length !== 1 || entries[0] !== expected) {
    throw new Error(`源码顶层目录名与 coreCommit 不符：期望 ${expected}，实际 [${entries.join(", ")}]`);
  }
  const top = path.join(rawDir, entries[0]);
  if (!fs.statSync(top).isDirectory()) throw new Error(`源码顶层不是目录：${top}`);
  fs.mkdirSync(path.dirname(stageEink), { recursive: true });
  fs.renameSync(top, stageEink);
  if (!fs.existsSync(path.join(stageEink, "server.py"))) {
    throw new Error("归一化后的源码缺少 server.py");
  }
}

/**
 * astral-sh install_only 解压后是 python/ 一层；剥掉它使 bin/python3（或 python.exe）
 * 落在 stage/python 下。已扁平则原样，幂等。
 */
export function normalizePythonDir(rawDir: string, stagePython: string, platform: string): void {
  const inner = path.join(rawDir, "python");
  const source = fs.existsSync(inner) && fs.statSync(inner).isDirectory() ? inner : rawDir;
  fs.mkdirSync(path.dirname(stagePython), { recursive: true });
  fs.renameSync(source, stagePython);
  const exe = platform === "win32"
    ? path.join(stagePython, "python.exe")
    : path.join(stagePython, "bin", "python3");
  if (!fs.existsSync(exe)) throw new Error(`便携 Python 布局异常：缺少 ${exe}`);
}

/**
 * v2 安装：三下载 → 三 sha 校验 → 解压归一化 → pip → 跑扩展补丁器 → 原子替换 → 写 core.json。
 * 任一步失败即中止；apply.py 在原子替换之前，失败时旧核心完好。
 */
export async function installCore(opts: {
  store: CoreStore; entry: PlatformEntry; version: string;
  coreVersion: string; coreCommit: string; manifestUrl: string;
  platform: string; arch: string;
  download?: (url: string, dest: string) => Promise<void>;
  extract?: typeof extractArchive;
  spawn?: typeof runSpawn;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  const { store, entry } = opts;
  const download = opts.download ?? defaultDownload;
  const extract = opts.extract ?? extractArchive;
  const spawn = opts.spawn ?? runSpawn;
  const log = opts.onProgress ?? (() => {});
  const p = store.paths;
  fs.mkdirSync(p.tmpDir, { recursive: true });

  await withLock(path.join(store.coreDir, "install.lock"), async () => {
    const pyIsZip = isZipUrl(entry.pythonUrl);
    const srcIsZip = isZipUrl(entry.sourceUrl);
    const extIsZip = isZipUrl(entry.extensionUrl);
    const sourceArchive = path.join(p.tmpDir, srcIsZip ? "source.zip" : "source.tar.gz");
    const pyArchive = path.join(p.tmpDir, pyIsZip ? "python.zip" : "python.tar.gz");
    const extArchive = path.join(p.tmpDir, "extension.zip");

    log("下载上游核心源码…"); await download(entry.sourceUrl, sourceArchive);
    if (!verifySha256(sourceArchive, entry.sourceSha256)) throw new Error("source sha256 mismatch");
    log("下载便携 Python…"); await download(entry.pythonUrl, pyArchive);
    if (!verifySha256(pyArchive, entry.pythonSha256)) throw new Error("python sha256 mismatch");
    log("下载版本匹配扩展包…"); await download(entry.extensionUrl, extArchive);
    if (!verifySha256(extArchive, entry.extensionSha256)) throw new Error("extension sha256 mismatch");

    const stage = path.join(p.tmpDir, "stage");
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const srcRaw = path.join(stage, "src_raw");
    const pyRaw = path.join(stage, "py_raw");
    const extDir = path.join(stage, "extension");
    const stageEink = path.join(stage, "eink");
    const stagePython = path.join(stage, "python");
    for (const d of [srcRaw, pyRaw, extDir]) fs.mkdirSync(d, { recursive: true });

    log("解压 + 归一化布局…");
    await extract(sourceArchive, srcRaw, opts.platform, srcIsZip);
    normalizeSourceDir(srcRaw, opts.coreCommit, stageEink);
    await extract(pyArchive, pyRaw, opts.platform, pyIsZip);
    normalizePythonDir(pyRaw, stagePython, opts.platform);
    await extract(extArchive, extDir, opts.platform, extIsZip);
    const applyPy = path.join(extDir, "apply.py");
    if (!fs.existsSync(applyPy)) throw new Error("扩展包缺少 apply.py");

    const python = opts.platform === "win32"
      ? path.join(stagePython, "python.exe")
      : path.join(stagePython, "bin", "python3");

    log("安装依赖…");
    const req = path.join(stageEink, "requirements.txt");
    const pip = await spawn(python, ["-m", "pip", "install", "-r", req], { timeoutMs: 300000 });
    if (pip.code !== 0) throw new Error("pip install failed: " + pip.stderr.slice(-400));

    log("应用版本匹配扩展…");
    const patched = await spawn(python, [
      applyPy, stageEink,
      "--core-version", opts.coreVersion,
      "--core-commit", opts.coreCommit,
    ], { timeoutMs: 120000 });
    if (patched.code !== 0) {
      throw new Error("扩展补丁失败（上游版本可能已漂移）: " + patched.stderr.slice(-400));
    }

    log("原子替换核心目录…");
    atomicReplaceDir(stagePython, path.join(store.coreDir, "python"));
    atomicReplaceDir(stageEink, path.join(store.coreDir, "eink"));
    store.writeCoreJson({
      version: opts.version,
      coreVersion: opts.coreVersion,
      coreCommit: opts.coreCommit,
      installedAt: Date.now(),
      source: {
        manifestUrl: opts.manifestUrl,
        sourceSha256: entry.sourceSha256,
        pythonSha256: entry.pythonSha256,
        extensionSha256: entry.extensionSha256,
      },
      launchMode: null, platform: opts.platform, arch: opts.arch,
    });
    fs.rmSync(p.tmpDir, { recursive: true, force: true });
    log("安装完成");
  });
}
