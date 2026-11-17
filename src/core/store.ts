import fs from "fs";
import type { DeviceInfo, PluginState, SavedDevice, Settings } from "../types";
import { statePaths } from "./paths";

/** 默认钉死的上游提交；更新时由维护者改这个常量并发新版插件。 */
export const PINNED_COMMIT = "81f61e10c60ff0e7199749c67d090bb74252fd66";
export const DEFAULT_SOURCE_URL = `https://github.com/Sunbelife/TodooCard_Skills/commit/${PINNED_COMMIT}`;
/**
 * 上面那个 commit 的 tarball SHA-256。无论走直连还是第三方加速，内容都必须与它一致，
 * 防止镜像返回被替换或损坏的包。
 */
export const PINNED_SHA256 = "3fdde5a150dd967687af0e250d163b1f36ea378b1e13026f2bb6abe7fe7ce869";

export const DEFAULT_SETTINGS: Settings = {
  sourceUrl: DEFAULT_SOURCE_URL,
  downloadMirror: "",
  autoProbeAfterPair: true,
  rotateRight90: false,
};

export function defaultState(): PluginState {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, devices: {} };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function normalizeSavedDevice(raw: any): SavedDevice | null {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  return {
    id,
    name: str(raw.name),
    alias: str(raw.alias),
    compatible: bool(raw.compatible, false),
    firmware: numOrNull(raw.firmware),
    paired: bool(raw.paired, false),
    lastSeenAt: numOrNull(raw.lastSeenAt),
    lastPairedAt: numOrNull(raw.lastPairedAt),
    lastProbeAt: numOrNull(raw.lastProbeAt),
    lastSendAt: numOrNull(raw.lastSendAt),
  };
}

export function normalizeState(raw: any): PluginState {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  base.settings = {
    sourceUrl: str(settings.sourceUrl, DEFAULT_SOURCE_URL).trim() || DEFAULT_SOURCE_URL,
    downloadMirror: str(settings.downloadMirror, "").trim(),
    autoProbeAfterPair: bool(settings.autoProbeAfterPair, true),
    rotateRight90: bool(settings.rotateRight90, false),
  };
  if (raw.devices && typeof raw.devices === "object") {
    for (const [key, value] of Object.entries(raw.devices)) {
      const rec = normalizeSavedDevice({ ...(value as any), id: (value as any)?.id || key });
      if (rec) base.devices[rec.id] = rec;
    }
  }
  return base;
}

/**
 * 同步范围之外的插件状态。写入采用「临时文件 + rename」，避免思源异常退出
 * 留下半截 JSON 导致下次启动读不到设备/配对信息。
 */
export class StateStore {
  readonly paths: ReturnType<typeof statePaths>;
  state: PluginState = defaultState();

  constructor(readonly dir: string) {
    this.paths = statePaths(dir);
  }

  load(): PluginState {
    try {
      const text = fs.readFileSync(this.paths.stateFile, "utf8");
      this.state = normalizeState(JSON.parse(text));
    } catch {
      this.state = defaultState();
    }
    return this.state;
  }

  ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.paths.tmpDir, { recursive: true });
    fs.mkdirSync(this.paths.cacheDir, { recursive: true });
  }

  save(): void {
    this.ensureDir();
    const tmp = this.paths.stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.paths.stateFile);
  }

  get settings(): Settings {
    return this.state.settings;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    if (!this.state.settings.sourceUrl.trim()) this.state.settings.sourceUrl = DEFAULT_SOURCE_URL;
    this.state.settings.downloadMirror = (this.state.settings.downloadMirror || "").trim();
    this.save();
  }

  /** 把一次扫描到的设备并入记录；不会把扫描结果误当成「已配对」。 */
  mergeSeen(devices: DeviceInfo[]): void {
    const now = Date.now();
    for (const d of devices) {
      const prev = this.state.devices[d.id];
      this.state.devices[d.id] = {
        id: d.id,
        name: d.name || prev?.name || "",
        alias: prev?.alias || "",
        compatible: d.compatible,
        firmware: d.firmware ?? prev?.firmware ?? null,
        paired: prev?.paired ?? false,
        lastSeenAt: now,
        lastPairedAt: prev?.lastPairedAt ?? null,
        lastProbeAt: prev?.lastProbeAt ?? null,
        lastSendAt: prev?.lastSendAt ?? null,
      };
    }
    this.save();
  }

  record(id: string, patch: Partial<SavedDevice>): void {
    const prev = this.state.devices[id];
    const normalizedId = id.toLowerCase();
    this.state.devices[normalizedId] = {
      id: normalizedId,
      name: "", alias: "", compatible: false, firmware: null, paired: false,
      lastSeenAt: null, lastPairedAt: null, lastProbeAt: null, lastSendAt: null,
      ...prev,
      ...patch,
    };
    this.save();
  }

  setAlias(id: string, alias: string): void {
    this.record(id, { alias: alias.trim() });
  }

  remove(id: string): void {
    delete this.state.devices[id.toLowerCase()];
    this.save();
  }
}

export function displayName(rec: { alias?: string; name?: string; id: string }): string {
  return rec.alias || rec.name || rec.id.slice(0, 8);
}
