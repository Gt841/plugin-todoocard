import fs from "fs";
import path from "path";
import { StateStore, displayName } from "./store";
import { checkPrerequisites, detectSkill, installSkill } from "./skill";
import { SkillRunner } from "./runner";
import { classifyOutcome, parsePreparedPaths, parseScanLine, isUuid, type JobOutcome } from "./parse";
import { normalizeSendTargets, summarizeBatch, type SendTargetResult } from "./batch";
import { cleanupTempImages, isImageFile, previewDataUrl, readImageMeta, saveDroppedImage, savePastedPng, validateImageMeta } from "./image";
import { statePaths } from "./paths";
import {
  PANEL_HEIGHT,
  PANEL_WIDTH,
  type DeviceInfo,
  type DeviceRow,
  type Filters,
  type ImageView,
  type JobKind,
  type PanelView,
  type PreparedView,
  type PrereqView,
  type SkillView,
} from "../types";

const TIMEOUTS: Record<string, number> = {
  list: 75_000,
  pair: 150_000,
  probe: 100_000,
  prepare: 180_000,
  send: 15 * 60_000,
};

export interface ServiceOptions {
  stateDir: string;
  onUpdate: () => void;
  notify?: (message: string, level?: "info" | "error") => void;
  platform?: string;
}

function nowLabel(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export class TodooService {
  readonly store: StateStore;
  readonly stateDir: string;
  private readonly onUpdate: () => void;
  private readonly notify: (message: string, level?: "info" | "error") => void;
  private readonly platform: string;

  skill: SkillView;
  prereq: PrereqView = { checked: false, swiftc: false, python3: false, sips: false, errors: [] };
  live = new Map<string, DeviceInfo>();
  selectedId: string | null = null;
  filters: Filters = { q: "", onlyCompatible: true, onlyPairing: false, onlyPaired: false, sort: "rssi" };
  image: ImageView | null = null;
  prepared: PreparedView | null = null;
  private preparedSource: string | null = null;
  private preparedUsedCrop = false;
  job: { kind: JobKind | null; running: boolean; message: string; startedAt: number; canCancel: boolean } =
    { kind: null, running: false, message: "", startedAt: 0, canCancel: false };
  scan = { startedAt: 0, secondsLeft: 0 };
  logs: string[] = [];

  private runner: SkillRunner | null = null;
  private cancelRequested = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(opts: ServiceOptions) {
    this.stateDir = opts.stateDir;
    this.onUpdate = opts.onUpdate;
    this.notify = opts.notify || (() => {});
    this.platform = opts.platform || process.platform;
    this.store = new StateStore(opts.stateDir);
    this.skill = detectSkill(opts.stateDir);
  }

  async init(): Promise<void> {
    this.store.load();
    this.store.ensureDir();
    this.skill = detectSkill(this.stateDir, this.store.settings.sourceUrl);
    this.preloadRunner();
    cleanupTempImages();
    this.log(`数据目录：${this.stateDir}`);
    this.log(this.skill.installed
      ? `核心（Skill）已就绪：${this.skill.ref || this.skill.archiveUrl || this.skill.sourceUrl}`
      : "核心（Skill）尚未安装，点击「下载核心」开始");
    const paired = Object.values(this.store.state.devices).find((d) => d.paired);
    this.selectedId = paired?.id || this.selectedId;
    this.prereq = await checkPrerequisites();
    for (const err of this.prereq.errors) this.log(`环境检查：${err}`);
    this.push();
  }

  private preloadRunner() {
    this.runner = this.skill.installed ? new SkillRunner(this.skill.scriptsDir) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.runner?.cancel();
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.updateTimer) clearTimeout(this.updateTimer);
  }

  private push() {
    if (this.disposed) return;
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      if (!this.disposed) this.onUpdate();
    }, 60);
  }

  private log(line: string) {
    this.logs.push(`[${nowLabel()}] ${line}`);
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
    this.push();
  }

  private clearLogs() {
    this.logs = [];
    this.push();
  }

  private begin(kind: JobKind, message: string, canCancel = true): SkillRunner | null {
    if (this.job.running) {
      this.notify("已有操作进行中，请先等待或取消", "info");
      return null;
    }
    const runner = this.skill.installed ? new SkillRunner(this.skill.scriptsDir) : null;
    if (!runner?.canRun()) {
      this.notify("核心尚未安装，请先下载 Skill", "error");
      return null;
    }
    this.runner = runner;
    this.cancelRequested = false;
    this.job = { kind, running: true, message, startedAt: Date.now(), canCancel };
    this.log(`── ${message} ──`);
    this.push();
    return runner;
  }

  private finish(outcome: JobOutcome, opts: { toast?: boolean; prefix?: string } = {}) {
    const toast = opts.toast !== false;
    if (outcome.error) {
      this.log(`失败：${outcome.error}`);
      if (toast) this.notify(`${opts.prefix || ""}${outcome.error}`, "error");
    } else {
      this.log(`${opts.prefix || ""}${outcome.summary}`);
      if (toast) this.notify(`${opts.prefix || ""}${outcome.summary}`, "info");
    }
    this.job = { kind: null, running: false, message: "", startedAt: 0, canCancel: false };
    this.push();
  }

  getView(): PanelView {
    const rows: DeviceRow[] = [];
    const ids = new Set<string>([...this.live.keys(), ...Object.keys(this.store.state.devices)]);
    for (const id of ids) {
      const live = this.live.get(id);
      const rec = this.store.state.devices[id];
      const base: DeviceInfo = live || {
        id, name: rec?.name || "", rssi: -999, services: [], compatible: rec?.compatible ?? false,
        manufacturerId: null, screenType: null, firmware: rec?.firmware ?? null,
        secure: false, pairingOpen: false, recovery: false, turbo: false,
        lastSeenAt: rec?.lastSeenAt || 0,
      };
      rows.push({
        ...base,
        alias: rec?.alias || "",
        paired: rec?.paired ?? false,
        live: !!live,
        lastPairedAt: rec?.lastPairedAt ?? null,
        lastSendAt: rec?.lastSendAt ?? null,
      });
    }
    const f = this.filters;
    const q = f.q.trim().toLowerCase();
    const filtered = rows.filter((d) => {
      if (f.onlyCompatible && !d.compatible) return false;
      if (f.onlyPairing && !d.pairingOpen) return false;
      if (f.onlyPaired && !d.paired) return false;
      if (!q) return true;
      return [d.alias, d.name, d.id].some((v) => (v || "").toLowerCase().includes(q));
    });
    filtered.sort((a, b) => {
      if (f.sort === "name") return displayName(a).localeCompare(displayName(b), "zh-Hans-CN");
      if (a.live !== b.live) return a.live ? -1 : 1;
      return b.rssi - a.rssi;
    });
    const pairedDevices = rows
      .filter((d) => d.paired)
      .sort((a, b) => {
        if (a.live !== b.live) return a.live ? -1 : 1;
        const recent = (b.lastSendAt || 0) - (a.lastSendAt || 0);
        return recent || displayName(a).localeCompare(displayName(b), "zh-Hans-CN");
      });
    return {
      stateDir: this.stateDir,
      skill: this.skill,
      prereq: this.prereq,
      devices: filtered,
      pairedDevices,
      selected: rows.find((d) => d.id === this.selectedId) || null,
      allDeviceCount: rows.length,
      compatibleCount: rows.filter((d) => d.compatible).length,
      selectedId: this.selectedId,
      filters: { ...f },
      scan: { running: this.job.kind === "scan" && this.job.running, secondsLeft: this.scan.secondsLeft },
      job: { ...this.job },
      image: this.image,
      prepared: this.prepared,
      log: this.logs.slice(-300),
      settings: { ...this.store.settings },
      platform: this.platform,
    };
  }

  // ── Skill 安装 ────────────────────────────────────────────────

  async install(manual = true): Promise<void> {
    if (this.job.running) {
      if (manual) this.notify("有操作进行中，请稍后再试", "info");
      return;
    }
    this.job = { kind: "install", running: true, message: "正在下载上游 Skill…", startedAt: Date.now(), canCancel: false };
    this.log("── 下载核心（TodooCard_Skills）──");
    this.push();
    try {
      const source = this.store.settings.sourceUrl;
      const meta = await installSkill({
        stateDir: this.stateDir,
        sourceUrl: source,
        onProgress: (m) => this.log(m),
      });
      this.skill = detectSkill(this.stateDir, source);
      this.preloadRunner();
      this.store.updateSettings({ sourceUrl: source });
      this.log(`核心已安装：${meta.ref || meta.archiveUrl}（${meta.sha256.slice(0, 10)}…）`);
      if (manual) this.notify("核心下载完成", "info");
      if (this.prereq.checked && this.prereq.errors.length) {
        this.log("提示：环境检查存在问题，操作仍可能失败");
      }
    } catch (e) {
      this.log(`下载失败：${String(e)}`);
      this.notify(`核心下载失败：${String(e)}`, "error");
    } finally {
      this.job = { kind: null, running: false, message: "", startedAt: 0, canCancel: false };
      this.push();
    }
  }

  async recheckPrereq(): Promise<void> {
    this.prereq = await checkPrerequisites();
    this.log(this.prereq.errors.length ? `环境检查：${this.prereq.errors.join("；")}` : "环境检查通过");
    this.push();
  }

  // ── 扫描 / 设备 ──────────────────────────────────────────────

  async scanDevices(): Promise<void> {
    const runner = this.begin("scan", "正在编译扫描工具并搜索附近设备…");
    if (!runner) return;
    this.live.clear();
    this.scan = { startedAt: Date.now(), secondsLeft: 0 };
    this.startCountdown();
    const result = await runner.run(["--list"], {
      timeoutMs: TIMEOUTS.list,
      onLine: (line, stream) => {
        this.log(stream === "stderr" ? `stderr: ${line}` : line);
        const device = parseScanLine(line);
        if (device) {
          this.live.set(device.id, device);
          this.job.message = `已发现 ${this.live.size} 台设备…`;
          this.push();
        }
        if (line.includes("Scanning nearby BLE devices for 30s")) {
          this.scan = { startedAt: Date.now(), secondsLeft: 30 };
        }
      },
    });
    this.stopCountdown();
    const outcome = classifyOutcome("scan", result.lines, result.code, result.signal);
    if (result.canceled) outcome.summary = "扫描已取消";
    else if (result.timedOut) { outcome.ok = false; outcome.error = "扫描超时"; }
    this.store.mergeSeen([...this.live.values()]);
    if (!this.selectedId) {
      const first = [...this.live.values()].find((d) => d.compatible) || [...this.live.values()][0];
      if (first) this.selectedId = first.id;
    }
    this.finish(outcome, { toast: false });
    this.log(`本次发现 ${this.live.size} 台设备`);
  }

  cancelJob(): void {
    if (!this.job.running) return;
    if (!this.job.canCancel) { this.notify("当前任务不可取消", "info"); return; }
    this.cancelRequested = true;
    this.log("正在取消当前操作…");
    this.runner?.cancel();
  }

  private startCountdown() {
    this.stopCountdown();
    this.scanTimer = setInterval(() => {
      if (this.scan.secondsLeft > 0) {
        this.scan.secondsLeft = Math.max(0, this.scan.secondsLeft - 1);
        this.push();
      }
    }, 1000);
  }

  private stopCountdown() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
    this.scan.secondsLeft = 0;
    this.push();
  }

  selectDevice(id: string | null): void {
    this.selectedId = id;
    this.push();
  }

  setFilters(patch: Partial<Filters>): void {
    this.filters = { ...this.filters, ...patch };
    this.push();
  }

  setAlias(id: string, alias: string): void {
    if (!isUuid(id)) return;
    this.store.setAlias(id, alias);
    this.log(`设备备注已更新：${alias || "(空)"}`);
    this.push();
  }

  forgetDevice(id: string): void {
    this.store.remove(id);
    if (this.selectedId === id) this.selectedId = null;
    this.log("已移除设备记录（不会解除 macOS 系统蓝牙配对）");
    this.push();
  }

  // ── 配对 / 探测 ──────────────────────────────────────────────

  async pair(id = this.selectedId): Promise<void> {
    if (!id || !isUuid(id)) { this.notify("请先选择一台设备", "error"); return; }
    const device = this.live.get(id);
    if (device?.recovery) { this.notify("设备处于 OTA 恢复模式，拒绝传图/配对，请先修复固件", "error"); return; }
    const runner = this.begin("pair", "等待卡片进入配对窗口…");
    if (!runner) return;
    const result = await runner.run(["--pair", "--device-id", id], {
      timeoutMs: TIMEOUTS.pair,
      onLine: (line, stream) => {
        this.log(stream === "stderr" ? `stderr: ${line}` : line);
        if (line.includes("Physical pairing window detected")) this.job.message = "检测到配对窗口，正在建立系统绑定…";
        if (line.includes("Hold the rear button")) this.job.message = "请长按卡片背面按钮 5 秒，直到正面灯快闪…";
        this.push();
      },
    });
    const outcome = classifyOutcome("pair", result.lines, result.code, result.signal);
    if (result.canceled) { outcome.ok = false; outcome.error = "配对已取消"; }
    if (outcome.ok) {
      this.store.record(id, {
        paired: true,
        name: device?.name || "",
        compatible: device?.compatible ?? true,
        firmware: device?.firmware ?? null,
        lastPairedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      this.selectedId = id;
      if (this.store.settings.autoProbeAfterPair) {
        this.job.message = "配对成功，正在验证设备…";
        this.log("配对成功，自动执行一次探测验证…");
        this.push();
        const probeOutcome = await this.probeInternal(runner, id);
        if (probeOutcome.ok) {
          this.finish({ ...outcome, summary: `${outcome.summary}；${probeOutcome.summary}` });
          return;
        }
        this.finish(outcome, { toast: true, prefix: "配对成功；探测失败：" });
        return;
      }
      this.finish(outcome);
      return;
    }
    this.finish(outcome);
  }

  async probe(id = this.selectedId): Promise<void> {
    if (!id || !isUuid(id)) { this.notify("请先选择一台设备", "error"); return; }
    const runner = this.begin("probe", "正在探测设备并验证加密连接…");
    if (!runner) return;
    const outcome = await this.probeInternal(runner, id);
    this.finish(outcome);
  }

  private async probeInternal(runner: SkillRunner, id: string): Promise<JobOutcome> {
    const result = await runner.run(["--probe", "--device-id", id], {
      timeoutMs: TIMEOUTS.probe,
      onLine: (line, stream) => {
        this.log(stream === "stderr" ? `stderr: ${line}` : line);
        if (line.includes("Encrypted link verified")) this.job.message = "加密连接已验证，读取设备信息…";
        this.push();
      },
    });
    const outcome = classifyOutcome("probe", result.lines, result.code, result.signal);
    if (outcome.ok) {
      const live = this.live.get(id);
      this.store.record(id, {
        paired: true,
        name: live?.name || this.store.state.devices[id]?.name || "",
        compatible: live?.compatible ?? this.store.state.devices[id]?.compatible ?? true,
        firmware: live?.firmware ?? this.store.state.devices[id]?.firmware ?? null,
        lastProbeAt: Date.now(),
      });
      this.selectedId = id;
    }
    this.push();
    return outcome;
  }

  // ── 图片 ─────────────────────────────────────────────────────

  async setImage(file: string): Promise<void> {
    try {
      if (!isImageFile(file)) throw new Error("请选择 JPG/PNG/HEIC 等图片文件");
      if (!fs.existsSync(file)) throw new Error("图片不存在或已被移动");
      const meta = await readImageMeta(file);
      validateImageMeta(meta);
      const dataUrl = await previewDataUrl(file, statePaths(this.stateDir).cacheDir);
      this.image = {
        path: file,
        name: path.basename(file),
        width: meta.width,
        height: meta.height,
        bytes: meta.bytes,
        dataUrl,
      };
      this.clearPreparedState();
      this.log(`已选择图片：${path.basename(file)}（${meta.width}×${meta.height}）`);
      this.push();
    } catch (e) {
      this.notify(String(e instanceof Error ? e.message : e), "error");
    }
  }

  async setPastedPng(png: Buffer): Promise<void> {
    if (!png.length) { this.notify("剪贴板里没有图片", "error"); return; }
    const file = savePastedPng(png);
    await this.setImage(file);
    if (this.image) this.log("已从剪贴板粘贴截图");
  }

  async setDroppedImage(bytes: Buffer, name: string): Promise<void> {
    if (!bytes.length) { this.notify("拖入的文件为空", "error"); return; }
    const file = saveDroppedImage(bytes, name || "image.png");
    await this.setImage(file);
  }

  clearImage(): void {
    this.image = null;
    this.clearPreparedState();
    this.push();
  }

  setRotate(value: boolean): void {
    this.store.updateSettings({ rotateRight90: value });
    this.clearPreparedState();
    this.push();
  }

  /** 裁剪构图变化后，旧的 payload 已经不再对应当前画面。 */
  invalidatePrepared(): void {
    this.clearPreparedState();
    this.push();
  }

  private clearPreparedState(): void {
    this.prepared = null;
    this.preparedSource = null;
    this.preparedUsedCrop = false;
  }

  // ── 生成 / 发送 ──────────────────────────────────────────────

  async prepare(croppedPng: Buffer | null = null, croppedName = "crop.png"): Promise<void> {
    if (!this.image) { this.notify("请先选择或粘贴一张图片", "error"); return; }
    const runner = this.begin("prepare", "正在转换六色 payload 并校验…");
    if (!runner) return;
    let inputPath = this.image.path;
    let usedCrop = false;
    if (croppedPng?.length) {
      try {
        inputPath = saveDroppedImage(croppedPng, croppedName || "crop.png");
        usedCrop = true;
      } catch (e) {
        this.finish({ ok: false, summary: "预览失败", error: `无法保存裁剪图：${String(e)}` });
        return;
      }
    }
    this.clearPreparedState();
    const args = ["--input", inputPath];
    // 裁剪图里的旋转已经烘焙进像素，不能再让上游转一次。
    if (!usedCrop && this.store.settings.rotateRight90) args.push("--rotate-right-90");
    const result = await runner.run(args, {
      timeoutMs: TIMEOUTS.prepare,
      onLine: (line, stream) => {
        this.log(stream === "stderr" ? `stderr: ${line}` : line);
        if (line.startsWith("Color mode:")) this.job.message = "正在进行六色抖动与面板校准…";
        if (line.startsWith("Prepared v157+")) this.job.message = "payload 校验通过";
        this.push();
      },
    });
    const outcome = classifyOutcome("prepare", result.lines, result.code, result.signal);
    if (result.canceled) { outcome.ok = false; outcome.error = "已取消"; }
    if (outcome.ok) {
      const paths = parsePreparedPaths(result.lines);
      if (paths.binPath && fs.existsSync(paths.binPath)) {
        const buf = fs.readFileSync(paths.binPath);
        const expected = (PANEL_WIDTH * PANEL_HEIGHT) / 2;
        if (buf.length !== expected) {
          this.finish({ ok: false, summary: "预览失败", error: `payload 尺寸异常：${buf.length}，期望 ${expected}` });
          return;
        }
        this.prepared = {
          binBase64: buf.toString("base64"),
          width: PANEL_WIDTH,
          height: PANEL_HEIGHT,
          bytes: buf.length,
          legacyBytes: paths.legacyBytes || 0,
          qlzBytes: paths.qlzPath && fs.existsSync(paths.qlzPath) ? fs.statSync(paths.qlzPath).size : 0,
          at: Date.now(),
          inputName: this.image.name,
          usedCrop,
        };
        this.preparedSource = inputPath;
        this.preparedUsedCrop = usedCrop;
      } else {
        this.finish({ ok: false, summary: "预览失败", error: "未找到生成的 payload 文件" });
        return;
      }
    }
    this.finish(outcome);
  }

  async send(targetIds?: string[]): Promise<void> {
    if (!this.image) { this.notify("请先选择或粘贴一张图片", "error"); return; }
    if (!this.prepared || !this.preparedSource) { this.notify("请先生成并校验预览，再发送", "error"); return; }
    const pairedIds = Object.values(this.store.state.devices)
      .filter((d) => d.paired)
      .map((d) => d.id);
    const targets = normalizeSendTargets(targetIds, pairedIds, this.selectedId);
    if (!targets.length) { this.notify("请至少选择一台已配对的卡片", "error"); return; }

    const nameOf = (id: string) =>
      displayName(this.store.state.devices[id] || this.live.get(id) || { id });
    const multi = targets.length > 1;
    const runner = this.begin(
      "send",
      multi ? `正在发送到 ${targets.length} 台卡片…` : `正在发送到 ${nameOf(targets[0])}…`,
    );
    if (!runner) return;

    const results: SendTargetResult[] = [];
    let canceled = false;

    for (let i = 0; i < targets.length; i++) {
      if (this.cancelRequested) { canceled = true; break; }
      const id = targets[i];
      const name = nameOf(id);
      const tag = multi ? `${i + 1}/${targets.length} · ${name}` : name;
      if (!isUuid(id)) {
        results.push({ id, name, ok: false, error: "设备 UUID 无效" });
        this.log(`跳过 ${name}：设备 UUID 无效`);
        continue;
      }
      const device = this.live.get(id);
      if (device?.recovery) {
        results.push({ id, name, ok: false, error: "设备处于 OTA 恢复模式，拒绝传图" });
        this.log(`跳过 ${name}：设备处于 OTA 恢复模式`);
        continue;
      }

      this.job.message = `正在发送到 ${tag}…`;
      this.log(`── 发送到 ${name}（${id}）──`);
      this.push();

      const args = ["--input", this.preparedSource, "--device-id", id, "--send"];
      if (this.store.settings.rotateRight90 && !this.preparedUsedCrop) args.push("--rotate-right-90");
      const result = await runner.run(args, {
        timeoutMs: TIMEOUTS.send,
        onLine: (line, stream) => {
          this.log(multi ? `[${tag}] ${stream === "stderr" ? `stderr: ${line}` : line}` : (stream === "stderr" ? `stderr: ${line}` : line));
          const progress = line.match(/^Progress: (\d+)% block=(\d+)/);
          if (progress) this.job.message = `${tag} 发送中 ${progress[1]}%（块 ${progress[2]}）`;
          else if (line.startsWith("Connecting")) this.job.message = `正在连接 ${tag}…`;
          else if (line.startsWith("Control notification enabled")) this.job.message = `${tag} 已连接，开始传输…`;
          else if (line.includes("waiting for refresh")) this.job.message = `等待 ${tag} 显影确认…`;
          this.push();
        },
      });
      const outcome = classifyOutcome("send", result.lines, result.code, result.signal);
      if (result.canceled) {
        canceled = true;
        results.push({ id, name, ok: false, error: "已取消" });
        break;
      }
      if (outcome.ok) {
        results.push({ id, name, ok: true });
        this.store.record(id, {
          lastSendAt: Date.now(),
          paired: true,
          name: device?.name || this.store.state.devices[id]?.name || "",
        });
      } else {
        results.push({ id, name, ok: false, error: outcome.error || outcome.summary || "发送失败" });
      }
      this.push();
    }

    const sent = results.filter((r) => r.ok).length;
    if (canceled) {
      this.finish({
        ok: false,
        summary: `已取消（完成 ${sent}/${targets.length} 台）`,
        error: "发送已取消（卡片可能只收到部分数据）",
      });
      return;
    }
    const agg = summarizeBatch(results);
    if (agg.failed > 0) this.log(agg.summary);
    this.finish({ ok: agg.ok, summary: agg.summary, error: agg.error });
  }

  // ── 设置 / 工具 ──────────────────────────────────────────────

  updateSettings(patch: { sourceUrl?: string; autoProbeAfterPair?: boolean }): void {
    const clean: Record<string, unknown> = {};
    if (typeof patch.sourceUrl === "string" && patch.sourceUrl.trim()) clean.sourceUrl = patch.sourceUrl.trim();
    if (typeof patch.autoProbeAfterPair === "boolean") clean.autoProbeAfterPair = patch.autoProbeAfterPair;
    this.store.updateSettings(clean);
    this.skill = detectSkill(this.stateDir, this.store.settings.sourceUrl);
    this.log("设置已保存（存储在同步范围之外）");
    this.push();
  }

  clearLog(): void {
    this.clearLogs();
  }
}
