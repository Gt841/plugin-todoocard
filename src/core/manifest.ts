import type { Manifest, PlatformEntry } from "../types";

export function platformKey(platform: string, arch: string): string {
  const p = platform === "win32" ? "windows" : platform;
  return `${p}-${arch}`;
}

export function parseManifest(text: string): Manifest {
  const obj = JSON.parse(text);
  if (!obj || typeof obj.version !== "string"
      || typeof obj.coreVersion !== "string"
      || typeof obj.coreCommit !== "string"
      || typeof obj.platforms !== "object" || !obj.platforms) {
    throw new Error("invalid manifest: need version + coreVersion + coreCommit + platforms");
  }
  return obj as Manifest;
}

const REQUIRED_FIELDS: (keyof PlatformEntry)[] = [
  "sourceUrl", "sourceSha256", "pythonUrl", "pythonSha256",
  "extensionUrl", "extensionSha256",
];

export function selectPlatform(m: Manifest, key: string): PlatformEntry {
  const entry = m.platforms[key];
  if (!entry) throw new Error(`manifest has no platform entry: ${key}`);
  for (const f of REQUIRED_FIELDS) {
    if (!entry[f]) throw new Error(`incomplete platform entry: ${key} (missing ${f})`);
  }
  return entry;
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}