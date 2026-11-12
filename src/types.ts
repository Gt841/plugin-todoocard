export type LaunchMode = "direct" | "disclaim" | "terminal";
export type LaunchSetting = "auto" | LaunchMode;
export type CoreStatus = "not-installed" | "installed" | "update-available";

export interface CoreJson {
  version: string;          // manifest.version（发布版，辅助）
  coreVersion: string;      // 上游核心版本（版本判定主键）
  coreCommit: string;       // 钉死的上游 commit sha
  installedAt: number;
  source: { manifestUrl: string; sourceSha256: string; pythonSha256: string; extensionSha256: string };
  launchMode: LaunchMode | null;
  platform: string;
  arch: string;
}
export interface PlatformEntry {
  sourceUrl: string; sourceSha256: string;      // 上游源码 tarball（松散 .py，可打补丁）
  pythonUrl: string; pythonSha256: string;      // astral-sh 便携 Python install_only
  extensionUrl: string; extensionSha256: string; // 我们的版本匹配扩展 zip
  depsUrl?: string; depsSha256?: string;
}
export interface Manifest {
  version: string;
  coreVersion: string;
  coreCommit: string;
  coreTag?: string;         // 仅展示/追溯，不参与下载与校验
  platforms: Record<string, PlatformEntry>;
}
export interface ProbeResult {
  ok: boolean; exitCode: number | null; signal: string | null; timedOut: boolean;
  authorization: string | null; devices_count: number | null;
  is_self: boolean | null; responsible_comm: string | null; responsible_app: string | null;
  error: string | null;
}
export interface Settings { coreDir: string; manifestUrl: string; launch: LaunchSetting; port: number; }