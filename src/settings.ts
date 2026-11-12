import type { LaunchMode, LaunchSetting, Settings } from "./types";

/** dist 仓库 GitHub Pages 上的 v2 manifest（2026-11-12 已上线）。用户可在设置里覆盖。 */
export const DIST_MANIFEST_URL = "https://gt841.github.io/todoocard-core-dist/manifest.json";

export const DEFAULT_SETTINGS: Settings = {
  coreDir: "",                    // resolved at runtime from dataDir; empty = use default
  manifestUrl: DIST_MANIFEST_URL, // 默认走官方 dist；本地开发可改成 file:// 或自建地址
  launch: "auto",
  port: 8199,
};

const VALID: LaunchSetting[] = ["auto", "direct", "disclaim", "terminal"];

export function normalizeLaunch(v: unknown): LaunchSetting {
  return VALID.includes(v as LaunchSetting) ? (v as LaunchSetting) : "auto";
}

export function resolveModes(setting: LaunchSetting, platform: string): LaunchMode[] {
  if (setting !== "auto") return [setting];
  return platform === "darwin" ? ["direct", "disclaim", "terminal"] : ["direct"];
}