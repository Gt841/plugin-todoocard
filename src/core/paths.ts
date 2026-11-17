import path from "path";
import os from "os";

/**
 * 插件数据（Skill 副本、设备别名、配对状态、上次选择）必须放在思源的同步范围之外。
 *
 * 默认位置是 `~/Library/Application Support/SiYuan/todoocard`（workspace 的 `data/`
 * 上一级）。注意 Electron 的 `userData` 实际是 `SiYuan-Electron`，这里会映射回
 * `SiYuan/todoocard`。思源同步只覆盖 `data/`，因此核心文件与配对信息不会被云端旧副本覆盖。
 */
export function resolveStateDir(opts: {
  dataDir?: string;
  userData?: string;
  home?: string;
  platform?: string;
} = {}): string {
  const home = opts.home || os.homedir();
  const platform = opts.platform || process.platform;
  const candidates: string[] = [];

  if (opts.dataDir) {
    const dataDir = path.resolve(opts.dataDir);
    if (path.basename(dataDir) === "data") {
      candidates.push(path.join(path.dirname(dataDir), "todoocard"));
    }
  }
  if (opts.userData) {
    const userData = path.resolve(opts.userData);
    const root = path.basename(userData) === "SiYuan-Electron"
      ? path.join(path.dirname(userData), "SiYuan")
      : userData;
    candidates.push(path.join(root, "todoocard"));
  }
  if (platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "SiYuan", "todoocard"));
  }
  candidates.push(path.join(home, ".siyuan-todoocard"));

  return candidates[0] || path.join(home, ".siyuan-todoocard");
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function statePaths(stateDir: string) {
  return {
    dir: stateDir,
    stateFile: path.join(stateDir, "state.json"),
    skillDir: path.join(stateDir, "skill"),
    skillMetaFile: path.join(stateDir, "skill-meta.json"),
    tmpDir: path.join(stateDir, "tmp"),
    cacheDir: path.join(stateDir, "cache"),
  };
}

/** 应用退出后仍可能残留的临时图片目录。 */
export function tempImageDir(): string {
  return path.join(os.tmpdir(), "siyuan-todoocard");
}
