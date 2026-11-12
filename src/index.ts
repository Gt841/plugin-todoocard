import { Plugin, Dialog, showMessage, openTab, Setting } from "siyuan";
import ControlPanel from "./ui/ControlPanel.svelte";
import TodooWebview from "./ui/TodooWebview.svelte";
import { DEFAULT_SETTINGS, normalizeLaunch } from "./settings";
import type { Settings } from "./types";
import { CoreStore, defaultCoreDir } from "./core/store";
import { CoreLifecycle } from "./core/lifecycle";
import { installCore } from "./core/installer";
import { parseManifest, selectPlatform, platformKey, compareVersion } from "./core/manifest";
import { pythonExe, type LaunchCtx } from "./core/launcher";
import fs from "fs";
import path from "path";

declare const window: any;

const STORAGE_NAME = "settings.json";

export default class TodoocardPlugin extends Plugin {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private store!: CoreStore;
  private lifecycle!: CoreLifecycle;
  private dialog: Dialog | null = null;
  private panel: any = null;
  private logText = "";
  private running = false;
  private currentMode = "";

  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData(STORAGE_NAME)) };
    this.settings.launch = normalizeLaunch(this.settings.launch);
    this.rebuild();
    this.setting = new Setting({
      confirmCallback: () => { this.saveData(STORAGE_NAME, this.settings); this.rebuild(); this.refresh(); },
    });
    this.setting.addItem({
      title: "Manifest URL",
      description: "核心下载清单地址（维护者托管；本地开发可用 file:// 指向本地 manifest）",
      createActionElement: () => {
        const input = document.createElement("input");
        input.className = "b3-text-field fn__block";
        input.placeholder = "https://example.com/manifest.json";
        input.value = this.settings.manifestUrl;
        input.addEventListener("change", () => { this.settings.manifestUrl = input.value.trim(); });
        return input;
      },
    });
    this.addTab({
      type: "todoocard-web",
      init() {
        const url = this.data?.url as string;
        const div = document.createElement("div");
        div.setAttribute("style", "width:100%;height:100%;position:relative;");
        new TodooWebview({ target: div, props: { src: url } });
        this.element.appendChild(div);
      },
      destroy() {},
    });
    this.addTopBar({
      icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14.88 16.29L13 18.17v-3.76l1.88 1.88M13 5.83l1.88 1.88L13 9.59V5.83m4.71 1.88L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29z"/></svg>`,
      title: "土豆片", position: "right", callback: () => this.openPanel(),
    });
    const ipc = window.require?.("electron")?.ipcRenderer;
    if (ipc) this.lifecycle.installExitHook(ipc);
    window.addEventListener("beforeunload", () => this.lifecycle.stop());
    const stale = this.lifecycle.detectStale();
    if (stale) showMessage(`检测到残留土豆片核心进程 (PID ${stale})，可在控制台停止或接管`, 6000, "info");
  }

  private rebuild() {
    const dataDir = window.siyuan?.config?.system?.dataDir || "";
    const pluginDir = path.join(dataDir, "plugins", this.name);
    const coreDir = this.settings.coreDir || defaultCoreDir(dataDir);
    this.store = new CoreStore(coreDir);
    const platform = process.platform;
    const ctx: LaunchCtx = {
      python: pythonExe(coreDir, platform), serverPy: this.store.paths.serverPy,
      einkDir: this.store.paths.eink, coreDir, port: this.settings.port, platform,
      pidFile: this.store.paths.pidFile, logFile: this.store.paths.logFile,
      probePy: path.join(pluginDir, "probe", "probe.py"),
      disclaimPy: path.join(pluginDir, "probe", "disclaim_spawn.py"),
      terminalTpl: path.join(pluginDir, "probe", "terminal.command.tpl"),
    };
    this.lifecycle = new CoreLifecycle({ store: this.store, ctx, setting: this.settings.launch, platform });
  }

  private log(msg: string) { this.logText += `[${new Date().toLocaleTimeString()}] ${msg}\n`; this.panel?.$set({ log: this.logText }); }

  private openPanel() {
    this.panel?.$destroy(); this.dialog?.destroy();
    this.dialog = new Dialog({ title: "土豆片控制台", width: "720px", height: "560px", content: `<div id="tcMount"></div>` });
    const target = this.dialog.element.querySelector("#tcMount") as HTMLElement;
    this.panel = new ControlPanel({ target, props: this.panelProps() });
    this.panel.$on("install", () => this.doInstall());
    this.panel.$on("start", () => this.doStart());
    this.panel.$on("stop", () => this.doStop());
    this.panel.$on("recheck", () => { this.store.setCachedMode(null as any); this.log("已清除模式缓存，下次启动重新预检"); });
    this.panel.$on("openweb", () => this.openWeb());
    this.panel.$on("opendir", async () => {
      try {
        const remote = window.require?.("@electron/remote");
        if (!remote?.shell) { showMessage("当前环境不支持打开目录", 5000, "error"); return; }
        const err = await remote.shell.openPath(this.store.coreDir);
        if (err) { this.log("打开目录失败: " + err); showMessage(err, 5000, "error"); }
      } catch (e) { this.log("打开目录失败: " + e); showMessage(String(e), 5000, "error"); }
    });
    this.panel.$on("changedir", async () => {
      try {
        const remote = window.require?.("@electron/remote");
        if (!remote?.dialog) { showMessage("当前环境不支持目录选择", 5000, "error"); return; }
        const r = await remote.dialog.showOpenDialog({ title: "选择土豆片核心存储目录", properties: ["openDirectory", "createDirectory"] });
        if (r.canceled || !r.filePaths?.length) return;
        if (this.running) { this.lifecycle.stop(); this.running = false; this.currentMode = ""; this.log("更改目录前已停止运行中的核心"); }
        this.settings.coreDir = r.filePaths[0];
        await this.saveData(STORAGE_NAME, this.settings);
        this.rebuild(); this.refresh();
        this.log("核心目录已设为 " + this.settings.coreDir);
      } catch (e) { this.log("更改目录失败: " + e); showMessage(String(e), 5000, "error"); }
    });
    this.panel.$on("launch", (e: CustomEvent) => this.saveLaunch(e.detail));
    this.refresh();
  }

  private panelProps() {
    return { status: this.store.detect(), running: this.running, mode: this.currentMode, launch: this.settings.launch, coreDir: this.store.coreDir, log: this.logText, isDarwin: process.platform === "darwin" };
  }
  private refresh() { this.panel?.$set(this.panelProps()); }

  private async saveLaunch(v: string) { this.settings.launch = normalizeLaunch(v); await this.saveData(STORAGE_NAME, this.settings); this.rebuild(); this.refresh(); }

  private async doInstall() {
    try {
      if (!this.settings.manifestUrl) { showMessage("请先在设置里填写 manifest URL", 5000, "error"); return; }
      this.log("拉取 manifest…");
      const text = await this.fetchText(this.settings.manifestUrl);
      const m = parseManifest(text);
      const key = platformKey(process.platform, process.arch);
      const entry = selectPlatform(m, key);
      const cur = this.store.readCoreJson();
      if (cur && compareVersion(cur.version, m.version) >= 0) { this.log("已是最新版本"); return; }
      await installCore({ store: this.store, entry, version: m.version, manifestUrl: this.settings.manifestUrl, platform: process.platform, arch: process.arch, onProgress: (s) => this.log(s) });
      this.refresh();
    } catch (e) { this.log("安装失败: " + e); showMessage("安装失败，详见日志", 5000, "error"); }
  }

  private async fetchText(url: string): Promise<string> {
    if (url.startsWith("file://")) return fs.readFileSync(url.slice(7), "utf8");
    const res = await fetch(url); return res.text();
  }

  private async doStart() {
    try {
      this.log("启动中（含 BLE 预检，若弹蓝牙授权请点允许）…");
      const r = await this.lifecycle.start();
      this.running = true; this.currentMode = r.mode;
      this.log(`已启动，模式=${r.mode} PID=${r.pid}`);
      this.refresh();
    } catch (e) { this.log("启动失败: " + e); showMessage(String(e), 6000, "error"); }
  }

  private doStop() { this.lifecycle.stop(); this.running = false; this.currentMode = ""; this.log("已停止"); this.refresh(); }

  private openWeb() {
    const url = `http://127.0.0.1:${this.settings.port}`;
    openTab({ app: this.app, custom: { id: this.name + "todoocard-web", title: "土豆片传图", icon: "iconImage", data: { url } } });
  }

  onunload() { this.lifecycle?.stop(); this.panel?.$destroy(); this.dialog?.destroy(); }
}