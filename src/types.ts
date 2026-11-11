export type LaunchMode = "direct" | "disclaim" | "terminal";
export type LaunchSetting = "auto" | LaunchMode;
export type CoreStatus = "not-installed" | "installed" | "update-available";

export interface CoreJson {
  version: string;
  installedAt: number;
  source: { manifestUrl: string; pythonSha256: string; einkSha256: string };
  launchMode: LaunchMode | null;
  platform: string;
  arch: string;
}
export interface PlatformEntry {
  pythonUrl: string; pythonSha256: string;
  einkUrl: string; einkSha256: string;
  depsUrl?: string; depsSha256?: string;
}
export interface Manifest { version: string; platforms: Record<string, PlatformEntry>; }
export interface ProbeResult {
  ok: boolean; exitCode: number | null; signal: string | null; timedOut: boolean;
  authorization: string | null; devices_count: number | null;
  is_self: boolean | null; responsible_comm: string | null; responsible_app: string | null;
  error: string | null;
}
export interface Settings { coreDir: string; manifestUrl: string; launch: LaunchSetting; port: number; }