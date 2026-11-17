export const TODOCARD_MANUFACTURER = 0x5053;
export const TODOCARD_SCREEN_T3 = 0x134c;
export const PANEL_WIDTH = 528;
export const PANEL_HEIGHT = 792;

export interface DeviceInfo {
  id: string;
  name: string;
  rssi: number;
  services: string[];
  compatible: boolean;
  manufacturerId: number | null;
  screenType: number | null;
  /** 固件原始版本字节，例如 0xA7。 */
  firmware: number | null;
  secure: boolean;
  pairingOpen: boolean;
  recovery: boolean;
  turbo: boolean;
  lastSeenAt: number;
}

export interface SavedDevice {
  id: string;
  name: string;
  alias: string;
  compatible: boolean;
  firmware: number | null;
  paired: boolean;
  lastSeenAt: number | null;
  lastPairedAt: number | null;
  lastProbeAt: number | null;
  lastSendAt: number | null;
}

export interface Settings {
  sourceUrl: string;
  autoProbeAfterPair: boolean;
  rotateRight90: boolean;
}

export interface PluginState {
  version: 1;
  settings: Settings;
  devices: Record<string, SavedDevice>;
}

export interface Filters {
  q: string;
  onlyCompatible: boolean;
  onlyPairing: boolean;
  onlyPaired: boolean;
  sort: "rssi" | "name";
}

export interface DeviceRow extends DeviceInfo {
  alias: string;
  paired: boolean;
  live: boolean;
  lastPairedAt: number | null;
  lastSendAt: number | null;
}

export interface SkillView {
  installed: boolean;
  ready: boolean;
  sourceUrl: string;
  archiveUrl: string;
  ref: string;
  sha256: string;
  installedAt: number;
  scriptsDir: string;
}

export interface PrereqView {
  checked: boolean;
  swiftc: boolean;
  python3: boolean;
  sips: boolean;
  errors: string[];
}

export type JobKind = "install" | "scan" | "pair" | "probe" | "prepare" | "send";

export interface JobView {
  kind: JobKind | null;
  running: boolean;
  message: string;
  startedAt: number;
  canCancel: boolean;
}

export interface ImageView {
  path: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  dataUrl: string;
}

export interface PreparedView {
  binBase64: string;
  width: number;
  height: number;
  bytes: number;
  legacyBytes: number;
  qlzBytes: number;
  at: number;
  inputName: string;
  /** 这份 payload 是否由 2:3 取景裁剪图生成（而非原图）。 */
  usedCrop: boolean;
}

export interface PanelView {
  stateDir: string;
  skill: SkillView;
  prereq: PrereqView;
  devices: DeviceRow[];
  /** 全部已配对设备（不受设备页筛选影响），用于发送目标多选。 */
  pairedDevices: DeviceRow[];
  selected: DeviceRow | null;
  allDeviceCount: number;
  compatibleCount: number;
  selectedId: string | null;
  filters: Filters;
  scan: { running: boolean; secondsLeft: number };
  job: JobView;
  image: ImageView | null;
  prepared: PreparedView | null;
  log: string[];
  settings: Settings;
  platform: string;
}
