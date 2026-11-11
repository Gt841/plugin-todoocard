import type { LaunchSetting, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  coreDir: "",          // resolved at runtime from dataDir; empty = use default
  manifestUrl: "",      // maintainer-provided
  launch: "auto",
  port: 8199,
};

const VALID: LaunchSetting[] = ["auto", "direct", "disclaim", "terminal"];

export function normalizeLaunch(v: unknown): LaunchSetting {
  return VALID.includes(v as LaunchSetting) ? (v as LaunchSetting) : "auto";
}