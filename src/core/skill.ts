import fs from "fs";
import path from "path";
import { atomicReplaceDir, download, extractArchive, isZipUrl, runSpawn, sha256File, which } from "./fsutil";
import { withDownloadMirror } from "./mirror";
import { statePaths } from "./paths";
import { DEFAULT_SOURCE_URL, PINNED_COMMIT, PINNED_SHA256 } from "./store";
import type { PrereqView, SkillView } from "../types";

export { DEFAULT_SOURCE_URL };

/**
 * 默认来源钉死了 commit，因此可以对下载内容做内容寻址校验。用户改成别的
 * commit / 分支后没有可预知摘要，只记录实际 SHA-256，不阻止安装。
 */
export function expectedSha256For(sourceUrl: string): string | null {
  const m = sourceUrl.trim().match(
    /^https?:\/\/github\.com\/sunbelife\/todoocard_skills\/commit\/([0-9a-f]{40})\/?$/i,
  );
  return m && m[1].toLowerCase() === PINNED_COMMIT ? PINNED_SHA256 : null;
}

export interface SkillMeta {
  sourceUrl: string;
  archiveUrl: string;
  ref: string;
  sha256: string;
  installedAt: number;
}

const GITHUB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\/(tree|commit)\/([^/]+))?\/?$/i;

/** 把常见的 GitHub 仓库地址转换成 codeload tarball 地址；直接给压缩包则原样使用。 */
export function sourceToArchiveUrl(source: string, ref = "main"): string {
  const value = source.trim();
  if (/\.(tar\.gz|tgz|zip)(\?|#|$)/i.test(value)) return value;
  const m = value.match(GITHUB_RE);
  if (!m) throw new Error("Skill 地址需为 GitHub 仓库、commit 或 .tar.gz/.zip 直链");
  const owner = m[1];
  const repo = m[2];
  const kind = m[3];
  const target = m[4] || ref;
  // commit 用裸 sha；分支用 refs/heads/<branch>，避免与同名 tag 混淆。
  const suffix = kind === "commit" ? target : `refs/heads/${target}`;
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${suffix}`;
}

export interface SkillLayout {
  root: string;
  scriptsDir: string;
  ref: string;
}

function isSkillRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, "todoocard-skills", "scripts", "prepare_and_send.sh"))
    || fs.existsSync(path.join(dir, "scripts", "prepare_and_send.sh"));
}

export function scriptsDirOf(root: string): string | null {
  const nested = path.join(root, "todoocard-skills", "scripts");
  if (fs.existsSync(path.join(nested, "prepare_and_send.sh"))) return nested;
  const flat = path.join(root, "scripts");
  if (fs.existsSync(path.join(flat, "prepare_and_send.sh"))) return flat;
  return null;
}

/**
 * 解压 GitHub tarball 后通常只有一层 `TodooCard_Skills-main/`。找到包含
 * `todoocard-skills/scripts` 的那一层并移动到 stage/skill，保证后续版本更新
 * 始终是整目录替换，不会出现新旧文件混在一起。
 */
export function normalizeSkillDir(rawDir: string, stageRoot: string): SkillLayout {
  let source: string | null = null;
  let ref = "";
  if (isSkillRoot(rawDir)) {
    source = rawDir;
  } else {
    const entries = fs.readdirSync(rawDir).filter((n) => !n.startsWith("."));
    for (const entry of entries) {
      const candidate = path.join(rawDir, entry);
      if (fs.statSync(candidate).isDirectory() && isSkillRoot(candidate)) {
        source = candidate;
        ref = entry;
        break;
      }
    }
  }
  if (!source) throw new Error("下载内容不是 TodooCard_Skills（缺少 todoocard-skills/scripts/prepare_and_send.sh）");
  fs.mkdirSync(path.dirname(stageRoot), { recursive: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.renameSync(source, stageRoot);
  const scriptsDir = scriptsDirOf(stageRoot);
  if (!scriptsDir) throw new Error("Skill 目录结构异常：找不到 prepare_and_send.sh");
  return { root: stageRoot, scriptsDir, ref };
}

export function readSkillMeta(stateDir: string): SkillMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(statePaths(stateDir).skillMetaFile, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.installedAt) return null;
    return {
      sourceUrl: String(raw.sourceUrl || DEFAULT_SOURCE_URL),
      archiveUrl: String(raw.archiveUrl || ""),
      ref: String(raw.ref || ""),
      sha256: String(raw.sha256 || ""),
      installedAt: Number(raw.installedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function detectSkill(stateDir: string, sourceUrl = DEFAULT_SOURCE_URL): SkillView {
  const p = statePaths(stateDir);
  const scriptsDir = scriptsDirOf(p.skillDir);
  const meta = readSkillMeta(stateDir);
  return {
    installed: !!scriptsDir,
    ready: !!scriptsDir,
    sourceUrl: meta?.sourceUrl || sourceUrl,
    archiveUrl: meta?.archiveUrl || "",
    ref: meta?.ref || "",
    sha256: meta?.sha256 || "",
    installedAt: meta?.installedAt || 0,
    scriptsDir: scriptsDir || "",
  };
}

export interface InstallSkillOptions {
  stateDir: string;
  sourceUrl: string;
  /** 可选下载加速前缀，例如 https://gh-proxy.com/。 */
  mirror?: string;
  /**
   * 测试用摘要覆盖：省略时按默认钉死来源自动校验；
   * 显式 null 表示跳过校验（仅单测注入假包时使用）。
   */
  expectedSha256?: string | null;
  onProgress?: (message: string) => void;
  downloader?: typeof download;
  extractor?: typeof extractArchive;
}

/** 下载上游 Skill 并原子安装到 `<stateDir>/skill`；任何一步失败都不会破坏旧副本。 */
export async function installSkill(opts: InstallSkillOptions): Promise<SkillMeta> {
  const log = opts.onProgress || (() => {});
  const p = statePaths(opts.stateDir);
  const downloader = opts.downloader || download;
  const extractor = opts.extractor || extractArchive;
  const directUrl = sourceToArchiveUrl(opts.sourceUrl);
  const archiveUrl = withDownloadMirror(directUrl, opts.mirror);
  const expectedSha256 = opts.expectedSha256 === undefined
    ? expectedSha256For(opts.sourceUrl)
    : opts.expectedSha256;
  fs.mkdirSync(p.tmpDir, { recursive: true });
  fs.mkdirSync(p.cacheDir, { recursive: true });
  const archive = path.join(p.tmpDir, isZipUrl(archiveUrl) ? "skill.zip" : "skill.tar.gz");
  const rawDir = path.join(p.tmpDir, "raw");
  const stageDir = path.join(p.tmpDir, "stage");
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  try {
    if (archiveUrl !== directUrl) log(`下载线路：第三方加速（原始地址 ${directUrl}）`);
    log(`下载 Skill：${archiveUrl}`);
    await downloader(archiveUrl, archive);
    const sha256 = sha256File(archive);
    log(`下载完成（${(fs.statSync(archive).size / 1024 / 1024).toFixed(2)} MB）`);
    if (expectedSha256 && sha256 !== expectedSha256) {
      throw new Error(
        `下载内容 SHA-256 校验失败，已拒绝安装（期望 ${expectedSha256.slice(0, 12)}…，实际 ${sha256.slice(0, 12)}…）`,
      );
    }
    log("解压并检查目录结构…");
    await extractor(archive, rawDir, isZipUrl(archiveUrl));
    const layout = normalizeSkillDir(rawDir, path.join(stageDir, "skill"));
    log("原子替换旧 Skill…");
    atomicReplaceDir(path.join(stageDir, "skill"), p.skillDir);
    const meta: SkillMeta = {
      sourceUrl: opts.sourceUrl.trim(),
      archiveUrl,
      ref: layout.ref,
      sha256,
      installedAt: Date.now(),
    };
    fs.writeFileSync(p.skillMetaFile, JSON.stringify(meta, null, 2), "utf8");
    log("Skill 安装完成");
    return meta;
  } finally {
    try { fs.unlinkSync(archive); } catch {}
    try { fs.rmSync(rawDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
  }
}

export async function checkPrerequisites(): Promise<PrereqView> {
  const errors: string[] = [];
  const [swiftc, python3] = await Promise.all([which("swiftc"), which("python3")]);
  const sipsPath = "/usr/bin/sips";
  const sips = fs.existsSync(sipsPath);
  if (!swiftc) errors.push("未找到 swiftc：请安装 Xcode Command Line Tools（xcode-select --install）");
  if (!python3) errors.push("未找到 python3：请安装 Xcode Command Line Tools 或 python3");
  if (!sips) errors.push("未找到 /usr/bin/sips（macOS 系统图片工具）");
  if (process.platform !== "darwin") errors.push("TodooCard_Skills 仅支持 macOS");
  return { checked: true, swiftc: !!swiftc, python3: !!python3, sips, errors };
}

export interface SwiftVersion {
  ok: boolean;
  version: string;
}

export async function readSwiftVersion(): Promise<SwiftVersion> {
  const r = await runSpawn("swiftc", ["--version"], { timeoutMs: 8000 });
  if (r.code !== 0) return { ok: false, version: r.stderr.trim() };
  return { ok: true, version: (r.stdout || r.stderr).split("\n")[0].trim() };
}
