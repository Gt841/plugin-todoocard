# plugin-todoocard Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**  build a SiYuan desktop plugin that downloads/manages a local TodooCard eink core and launches it via a ①direct→②disclaim→④Terminal cascade (default ①), with start/stop, exit-cleanup, a control panel, and an embedded core Web UI.

**Architecture:** The plugin is a core manager (OpenClash-style) plus a shell hosting the core's own aiohttp Web UI (:8199). Pure-logic modules (store/manifest/settings/mode-selection/judge) are unit-tested with vitest; process/network/BLE/UI parts are verified via integration and real-machine steps. macOS uses the core's self-contained pure-Python send path via a fork env toggle.

**Tech Stack:** Svelte 3 + TypeScript + Vite 4 (CJS lib build, reuse plugin-pptgo template), siyuan 0.9.2 API, vitest 0.34 (node env), Node builtins via window.require, portable Python (python-build-standalone) + bleak core.

**Spec:** `docs/superpowers/specs/2026-11-11-todoocard-plugin-design.md`

## Global Constraints

- Plugin name: `plugin-todoocard`; project path `<repo>`.
- `minAppVersion: "3.0.1"`; `backends: ["windows","linux","darwin"]`; `frontends: ["desktop","desktop-window"]`.
- Core HTTP port default: `8199`.
- macOS pure-Python env toggle: `TODOOCARD_FORCE_PYTHON=1` (set when launching core on darwin).
- SiYuan cooperative-exit IPC channel: `siyuan-save-close`.
- Launch modes: `direct` (①), `disclaim` (②), `terminal` (④). Setting `launch`: `auto` (default) | `direct` | `disclaim` | `terminal`.
- `auto` on darwin resolves to `[direct, disclaim, terminal]`; on windows/linux resolves to `[direct]`. Forced mode resolves to `[thatMode]` (no fallback).
- Default core dir: `<siyuan dataDir>/todoocard-core` (dataDir from `window.siyuan.config.system.dataDir`).
- Fallback trigger is a **BLE preflight probe** (`result.ok === true`), NOT a port health check.
- Disclaim/terminal modes are macOS-only; hide/disable them in settings on non-darwin.
- Bundle externals (do not bundle): `siyuan`, `process`, and Node builtins `child_process fs path os crypto https http url electron`.
- Do NOT redistribute or depend on `Sunbelife/TodooCard_Skills` (unlicensed Swift). macOS send/pair goes pure-Python + OS-level pairing.
- Commit after every task. Never skip hooks. Only commit when executing a task's commit step.

---

## File Structure

```
plugin-todoocard/
├─ package.json                 deps + scripts (build/dev/test/make-link/tag)
├─ vite.config.ts               CJS lib build, externals, static-copy, zip-pack
├─ vitest.config.ts             node-env unit tests (separate from svelte vite config)
├─ tsconfig.json / tsconfig.node.json / svelte.config.js
├─ plugin.json                  manifest
├─ .gitignore
├─ scripts/make_dev_link.js     dev symlink (reuse pptgo)
├─ icon.png / preview.png       (placeholder ok for Phase 1)
├─ README.md
├─ src/
│  ├─ index.ts                  Plugin entry: wiring, topbar, exit hook, custom tab
│  ├─ types.ts                  shared types
│  ├─ settings.ts               defaults + normalizeLaunch + resolveModes
│  ├─ settings.test.ts
│  ├─ core/
│  │  ├─ store.ts               CoreStore: paths/detect/core.json/cached mode
│  │  ├─ store.test.ts
│  │  ├─ manifest.ts            parse/platformKey/selectPlatform/compareVersion
│  │  ├─ manifest.test.ts
│  │  ├─ process.ts             runSpawn/killTree/pid read+write
│  │  ├─ process.test.ts
│  │  ├─ preflight.ts           judgeProbe + runPreflight
│  │  ├─ preflight.test.ts
│  │  ├─ launcher.ts            selectMode + launchCore + buildCoreEnv + renderTerminalCommand
│  │  ├─ launcher.test.ts
│  │  ├─ installer.ts           sha256/verify/atomicReplace/lock/installCore
│  │  ├─ installer.test.ts
│  │  ├─ lifecycle.ts           CoreLifecycle: start/stop/stale/exit hook
│  │  └─ lifecycle.test.ts
│  ├─ probe/
│  │  ├─ probe.py               bundled BLE probe (short scan)
│  │  ├─ disclaim_spawn.py      bundled macOS disclaim supervisor
│  │  └─ terminal.command.tpl   terminal wrapper template
│  └─ ui/
│     └─ ControlPanel.svelte    control dialog content
└─ docs/superpowers/{specs,plans}/...
```

Responsibilities are split by module boundary (see spec §3). Pure logic lives in `settings.ts`, `core/store.ts`, `core/manifest.ts`, `core/preflight.ts (judgeProbe)`, `core/launcher.ts (selectMode/buildCoreEnv/renderTerminalCommand)`, `core/installer.ts (sha256/verify/atomicReplace)` — these carry the unit tests. Process/network/BLE/UI carry integration + manual verification.

---

## Task 1: Scaffold + test harness + settings defaults

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `svelte.config.js`, `.gitignore`, `plugin.json`, `scripts/make_dev_link.js`, `src/index.ts`, `src/types.ts`, `src/settings.ts`, `src/settings.test.ts`, `README.md`, `icon.png`, `preview.png`

**Interfaces:**
- Produces: `types.ts` exports `LaunchMode`, `LaunchSetting`, `CoreStatus`, `CoreJson`, `PlatformEntry`, `Manifest`, `ProbeResult`, `Settings`. `settings.ts` exports `DEFAULT_SETTINGS: Settings`, `normalizeLaunch(v: unknown): LaunchSetting`. Later tasks import these exact names.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "plugin-todoocard",
  "version": "0.0.1",
  "scripts": {
    "make-link": "node --no-warnings ./scripts/make_dev_link.js",
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "tag": "git add ./plugin.json && git commit -m \"update version\" && git push && node ./autoTag.js"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^2.4.1",
    "@tsconfig/svelte": "^4.0.1",
    "@types/node": "^20.3.0",
    "fast-glob": "^3.2.12",
    "minimist": "^1.2.8",
    "rollup-plugin-livereload": "^2.0.5",
    "sass": "^1.63.3",
    "siyuan": "0.9.2",
    "svelte": "^3.59.1",
    "typescript": "^5.1.3",
    "vite": "^4.5.2",
    "vite-plugin-static-copy": "^0.15.0",
    "vite-plugin-zip-pack": "^1.0.5",
    "vitest": "^0.34.6"
  },
  "dependencies": {
    "siyuan-kit-svelte": "^0.1.3"
  }
}
```

- [ ] **Step 2: Create config files**

`vite.config.ts` (adapted from pptgo: macOS dev dir + Node builtin externals):

```ts
import { resolve } from "path";
import { defineConfig } from "vite";
import minimist from "minimist";
import { viteStaticCopy } from "vite-plugin-static-copy";
import livereload from "rollup-plugin-livereload";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";

const args = minimist(process.argv.slice(2));
const isWatch = args.watch || args.w || false;
const devDistDir = process.env.SIYUAN_PLUGIN_DIR
  ? resolve(process.env.SIYUAN_PLUGIN_DIR, "plugin-todoocard")
  : resolve("<home>/Library/Application Support/SiYuan/data/plugins/plugin-todoocard");
const distDir = isWatch ? devDistDir : "./dist";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  plugins: [
    svelte(),
    viteStaticCopy({ targets: [
      { src: "./README*.md", dest: "./" },
      { src: "./plugin.json", dest: "./" },
      { src: "./preview.png", dest: "./" },
      { src: "./icon.png", dest: "./" },
      { src: "./src/probe/*", dest: "./probe" },
    ]}),
  ],
  define: {
    "process.env.DEV_MODE": `"${isWatch}"`,
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
  },
  build: {
    outDir: distDir, emptyOutDir: false, sourcemap: false, minify: !isWatch,
    lib: { entry: resolve(__dirname, "src/index.ts"), fileName: "index", formats: ["cjs"] },
    rollupOptions: {
      plugins: [ ...(isWatch ? [livereload(devDistDir)] : [zipPack({ inDir: "./dist", outDir: "./", outFileName: "package.zip" })]) ],
      external: ["siyuan", "process", "child_process", "fs", "path", "os", "crypto", "https", "http", "url", "electron"],
      output: { entryFileNames: "[name].js", assetFileNames: (a) => a.name === "style.css" ? "index.css" : a.name },
    },
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

`tsconfig.json` (reuse pptgo, add vitest types off — we import explicitly):

```json
{
  "compilerOptions": {
    "target": "ESNext", "useDefineForClassFields": true, "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"], "skipLibCheck": true,
    "moduleResolution": "Node", "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true,
    "strict": false, "noUnusedLocals": true, "noUnusedParameters": true,
    "allowJs": true, "checkJs": false,
    "types": ["node", "vite/client", "svelte"],
    "baseUrl": "./src", "paths": { "@/*": ["./*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.svelte"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:

```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Node", "allowSyntheticDefaultImports": true }, "include": ["vite.config.ts", "vitest.config.ts"] }
```

`svelte.config.js`:

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
export default { preprocess: vitePreprocess() };
```

`.gitignore`:

```
.idea
.vscode
.DS_Store
node_modules
dev
dist
package.zip
tmp
*.log
```

`plugin.json`:

```json
{
  "name": "plugin-todoocard",
  "author": "Gt841",
  "url": "https://github.com/Gt841/plugin-todoocard",
  "version": "0.0.1",
  "minAppVersion": "3.0.1",
  "backends": ["windows", "linux", "darwin"],
  "frontends": ["desktop", "desktop-window"],
  "displayName": { "en_US": "TodooCard", "zh_CN": "土豆片" },
  "description": {
    "en_US": "Manage a local TodooCard eink core and transfer images from SiYuan.",
    "zh_CN": "在思源中管理本地土豆片墨水屏核心并传图。"
  },
  "readme": { "default": "README.md" },
  "keywords": ["todoocard", "eink", "bluetooth", "墨水屏"]
}
```

Copy `scripts/make_dev_link.js` verbatim from `plugin-pptgo/scripts/make_dev_link.js`. Create placeholder `icon.png`/`preview.png` (copy from pptgo for now) and a short `README.md` stating Phase 1 scope + macOS pairing note.

- [ ] **Step 3: Create `src/types.ts`**

```ts
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
```

- [ ] **Step 4: Write the failing test `src/settings.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, normalizeLaunch } from "./settings";

describe("settings", () => {
  it("defaults to auto launch and port 8199", () => {
    expect(DEFAULT_SETTINGS.launch).toBe("auto");
    expect(DEFAULT_SETTINGS.port).toBe(8199);
  });
  it("normalizeLaunch accepts valid modes", () => {
    expect(normalizeLaunch("direct")).toBe("direct");
    expect(normalizeLaunch("disclaim")).toBe("disclaim");
    expect(normalizeLaunch("terminal")).toBe("terminal");
    expect(normalizeLaunch("auto")).toBe("auto");
  });
  it("normalizeLaunch falls back to auto on garbage", () => {
    expect(normalizeLaunch("bogus")).toBe("auto");
    expect(normalizeLaunch(undefined)).toBe("auto");
    expect(normalizeLaunch(42)).toBe("auto");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install && npx vitest run src/settings.test.ts`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 6: Implement `src/settings.ts` (defaults + normalize only)**

```ts
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
```

- [ ] **Step 7: Create minimal `src/index.ts` so the build works**

```ts
import { Plugin } from "siyuan";

export default class TodoocardPlugin extends Plugin {
  onload() {
    this.addTopBar({
      icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14.88 16.29L13 18.17v-3.76l1.88 1.88M13 5.83l1.88 1.88L13 9.59V5.83m4.71 1.88L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29z"/></svg>`,
      title: "土豆片",
      position: "right",
      callback: () => { /* wired in Task 10 */ },
    });
  }
}
```

- [ ] **Step 8: Run test + build to verify pass**

Run: `npx vitest run src/settings.test.ts && npm run build`
Expected: tests PASS; build emits `dist/index.js` + `dist/package.zip`.

- [ ] **Step 9: Commit**

```bash
git add package.json vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json svelte.config.js .gitignore plugin.json scripts src README.md icon.png preview.png
git commit -m "feat: scaffold plugin-todoocard with vitest harness and settings defaults"
```

---

## Task 2: CoreStore (paths, detection, core.json, cached mode)

**Files:**
- Create: `src/core/store.ts`, `src/core/store.test.ts`

**Interfaces:**
- Consumes: `CoreJson`, `CoreStatus`, `LaunchMode` from `types.ts`.
- Produces: `defaultCoreDir(dataDir: string): string`; class `CoreStore` with `constructor(coreDir: string)`, `paths` getter `{ python, eink, serverPy, coreJson, runDir, pidFile, logFile, tmpDir }` (all absolute strings), `detect(): CoreStatus`, `readCoreJson(): CoreJson | null`, `writeCoreJson(v: CoreJson): void`, `getCachedMode(): LaunchMode | null`, `setCachedMode(m: LaunchMode): void`.

- [ ] **Step 1: Write failing test `src/core/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreStore, defaultCoreDir } from "./store";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-")); });

describe("defaultCoreDir", () => {
  it("appends todoocard-core to dataDir", () => {
    expect(defaultCoreDir("/data")).toBe(path.join("/data", "todoocard-core"));
  });
});

describe("CoreStore.detect", () => {
  it("not-installed when empty", () => {
    expect(new CoreStore(dir).detect()).toBe("not-installed");
  });
  it("installed when python + server.py + core.json present", () => {
    const s = new CoreStore(dir);
    fs.mkdirSync(path.dirname(s.paths.python), { recursive: true });
    fs.writeFileSync(s.paths.python, "#!/bin/sh\n");
    fs.mkdirSync(path.dirname(s.paths.serverPy), { recursive: true });
    fs.writeFileSync(s.paths.serverPy, "");
    s.writeCoreJson({ version: "1.0.0", installedAt: 1, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
    expect(s.detect()).toBe("installed");
  });
});

describe("CoreStore cached mode", () => {
  it("round-trips launchMode", () => {
    const s = new CoreStore(dir);
    s.writeCoreJson({ version: "1.0.0", installedAt: 1, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
    expect(s.getCachedMode()).toBeNull();
    s.setCachedMode("disclaim");
    expect(s.getCachedMode()).toBe("disclaim");
    expect(new CoreStore(dir).readCoreJson()!.launchMode).toBe("disclaim");
  });
  it("readCoreJson returns null on missing/corrupt", () => {
    expect(new CoreStore(dir).readCoreJson()).toBeNull();
    fs.writeFileSync(new CoreStore(dir).paths.coreJson, "{bad");
    expect(new CoreStore(dir).readCoreJson()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/core/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Implement `src/core/store.ts`**

```ts
import fs from "fs";
import path from "path";
import type { CoreJson, CoreStatus, LaunchMode } from "../types";

export function defaultCoreDir(dataDir: string): string {
  return path.join(dataDir, "todoocard-core");
}

export class CoreStore {
  constructor(public readonly coreDir: string) {}

  get paths() {
    const runDir = path.join(this.coreDir, "run");
    return {
      python: path.join(this.coreDir, "python", "bin", "python3"),
      eink: path.join(this.coreDir, "eink"),
      serverPy: path.join(this.coreDir, "eink", "server.py"),
      coreJson: path.join(this.coreDir, "core.json"),
      runDir,
      pidFile: path.join(runDir, "core.pid"),
      logFile: path.join(runDir, "core.log"),
      tmpDir: path.join(runDir, "tmp"),
    };
  }

  readCoreJson(): CoreJson | null {
    try { return JSON.parse(fs.readFileSync(this.paths.coreJson, "utf8")) as CoreJson; }
    catch { return null; }
  }

  writeCoreJson(v: CoreJson): void {
    fs.mkdirSync(this.coreDir, { recursive: true });
    fs.writeFileSync(this.paths.coreJson, JSON.stringify(v, null, 2));
  }

  detect(): CoreStatus {
    const cj = this.readCoreJson();
    if (!cj) return "not-installed";
    if (!fs.existsSync(this.paths.python) || !fs.existsSync(this.paths.serverPy)) return "not-installed";
    return "installed"; // update-available decided by installer comparing manifest version
  }

  getCachedMode(): LaunchMode | null { return this.readCoreJson()?.launchMode ?? null; }

  setCachedMode(m: LaunchMode): void {
    const cj = this.readCoreJson();
    if (!cj) return;
    cj.launchMode = m;
    this.writeCoreJson(cj);
  }
}
```

Note: `paths.python` uses `bin/python3` for darwin/linux; Task 7's `buildCoreEnv`/launcher resolves the Windows `python.exe` variant via a `pythonExe(platform)` helper added there. For Task 2 tests (darwin-style) `bin/python3` is fine.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/store.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts src/core/store.test.ts
git commit -m "feat: CoreStore paths, detection, core.json and cached launch mode"
```

---

## Task 3: Manifest parsing + platform selection + version compare

**Files:**
- Create: `src/core/manifest.ts`, `src/core/manifest.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `PlatformEntry` from `types.ts`.
- Produces: `platformKey(platform: string, arch: string): string`; `parseManifest(text: string): Manifest` (throws on invalid); `selectPlatform(m: Manifest, key: string): PlatformEntry` (throws if missing); `compareVersion(a: string, b: string): number` (negative if a<b, 0 equal, positive if a>b; numeric dot segments).

- [ ] **Step 1: Write failing test `src/core/manifest.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { platformKey, parseManifest, selectPlatform, compareVersion } from "./manifest";

const SAMPLE = JSON.stringify({
  version: "1.0.3",
  platforms: {
    "darwin-arm64": { pythonUrl: "p", pythonSha256: "a", einkUrl: "e", einkSha256: "b" },
    "windows-x64": { pythonUrl: "p2", pythonSha256: "c", einkUrl: "e2", einkSha256: "d" },
  },
});

describe("platformKey", () => {
  it("joins platform-arch", () => { expect(platformKey("darwin", "arm64")).toBe("darwin-arm64"); });
  it("maps win32 to windows", () => { expect(platformKey("win32", "x64")).toBe("windows-x64"); });
});

describe("parseManifest", () => {
  it("parses valid", () => { expect(parseManifest(SAMPLE).version).toBe("1.0.3"); });
  it("throws on bad json", () => { expect(() => parseManifest("{bad")).toThrow(); });
  it("throws on missing platforms", () => { expect(() => parseManifest('{"version":"1"}')).toThrow(); });
});

describe("selectPlatform", () => {
  it("returns entry", () => { expect(selectPlatform(parseManifest(SAMPLE), "darwin-arm64").einkUrl).toBe("e"); });
  it("throws on missing key", () => { expect(() => selectPlatform(parseManifest(SAMPLE), "linux-x64")).toThrow(); });
});

describe("compareVersion", () => {
  it("orders numerically", () => {
    expect(compareVersion("1.0.3", "1.0.10")).toBeLessThan(0);
    expect(compareVersion("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersion("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/core/manifest.test.ts`
Expected: FAIL — cannot resolve `./manifest`.

- [ ] **Step 3: Implement `src/core/manifest.ts`**

```ts
import type { Manifest, PlatformEntry } from "../types";

export function platformKey(platform: string, arch: string): string {
  const p = platform === "win32" ? "windows" : platform;
  return `${p}-${arch}`;
}

export function parseManifest(text: string): Manifest {
  const obj = JSON.parse(text);
  if (!obj || typeof obj.version !== "string" || typeof obj.platforms !== "object" || !obj.platforms) {
    throw new Error("invalid manifest: need version + platforms");
  }
  return obj as Manifest;
}

export function selectPlatform(m: Manifest, key: string): PlatformEntry {
  const entry = m.platforms[key];
  if (!entry) throw new Error(`manifest has no platform entry: ${key}`);
  if (!entry.pythonUrl || !entry.einkUrl) throw new Error(`incomplete platform entry: ${key}`);
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/manifest.test.ts`
Expected: PASS (all 9).

- [ ] **Step 5: Commit**

```bash
git add src/core/manifest.ts src/core/manifest.test.ts
git commit -m "feat: manifest parse, platform selection and version compare"
```

---

## Task 4: Process utils (runSpawn, killTree, pid file)

**Files:**
- Create: `src/core/process.ts`, `src/core/process.test.ts`

**Interfaces:**
- Produces: `interface SpawnResult { code: number|null; signal: string|null; stdout: string; stderr: string; timedOut: boolean }`; `runSpawn(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string,string>; timeoutMs: number }): Promise<SpawnResult>`; `killTree(pid: number): void`; `writePid(file: string, pid: number): void`; `readPid(file: string): number|null`.

- [ ] **Step 1: Write failing test `src/core/process.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runSpawn, writePid, readPid } from "./process";

describe("runSpawn", () => {
  it("captures stdout and exit 0", async () => {
    const r = await runSpawn(process.execPath, ["-e", "console.log('hi')"], { timeoutMs: 8000 });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.timedOut).toBe(false);
  });
  it("flags timeout and kills", async () => {
    const r = await runSpawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });
});

describe("pid file", () => {
  it("round-trips", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pid-")), "core.pid");
    writePid(f, 4321);
    expect(readPid(f)).toBe(4321);
  });
  it("readPid null on missing/garbage", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "pid-"));
    expect(readPid(path.join(d, "none"))).toBeNull();
    const f = path.join(d, "bad"); fs.writeFileSync(f, "abc");
    expect(readPid(f)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/core/process.test.ts`
Expected: FAIL — cannot resolve `./process`.

- [ ] **Step 3: Implement `src/core/process.ts`**

```ts
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export interface SpawnResult {
  code: number | null; signal: string | null;
  stdout: string; stderr: string; timedOut: boolean;
}

export function runSpawn(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs: number }): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false, timedOut = false;
    let child;
    try { child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env }); }
    catch (e) { resolve({ code: -1, signal: null, stdout: "", stderr: String(e), timedOut: false }); return; }
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch {} }, opts.timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ code: -1, signal: null, stdout, stderr: stderr + String(e), timedOut }); });
    child.on("close", (code, signal) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}

export function killTree(pid: number): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"]); } catch {}
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
}

export function writePid(file: string, pid: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(pid));
}

export function readPid(file: string): number | null {
  try { const n = parseInt(fs.readFileSync(file, "utf8").trim(), 10); return Number.isFinite(n) && n > 0 ? n : null; }
  catch { return null; }
}
```

Note: `killTree` tries the process group (`-pid`) first; launcher spawns cores with `detached: true` on POSIX so they lead a group (Task 7). Tests here only cover runSpawn/pid (killTree verified in Task 12 real-machine).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/core/process.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/core/process.ts src/core/process.test.ts
git commit -m "feat: process utils runSpawn, killTree and pid file"
```

---

## Task 5: BLE probe (bundled) + judgeProbe

**Files:**
- Create: `src/probe/probe.py`, `src/core/preflight.ts`, `src/core/preflight.test.ts`

**Interfaces:**
- Consumes: `SpawnResult` from `process.ts`; `ProbeResult`, `LaunchMode` from `types.ts`.
- Produces: `judgeProbe(resultJson: any, info: SpawnResult): ProbeResult`; `runPreflight(mode, ctx): Promise<ProbeResult>` (ctx typed in Task 7 `LaunchCtx`; here implement using `runSpawn` + a per-mode command builder declared in Task 7 — to keep Task 5 independent, `runPreflight` accepts an explicit `cmd/args` via a `PreflightCmd` param). Signature: `runPreflight(cmd: string, args: string[], resultFile: string, timeoutMs: number): Promise<ProbeResult>`.

- [ ] **Step 1: Create bundled `src/probe/probe.py`** (trimmed from the validated spike; 6s scan)

```python
#!/usr/bin/env python3
"""BLE preflight probe. Usage: python probe.py <result.json> [label]
exit 0 = scan ok; 4 = exception; TCC kill = SIGABRT (shell 134)."""
import json, os, subprocess, sys, time
RESULT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tcc-probe.json"
LABEL = sys.argv[2] if len(sys.argv) > 2 else "preflight"

def responsible():
    try:
        import ctypes
        lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        fn = lib.responsibility_get_pid_responsible_for_pid
        fn.argtypes = [ctypes.c_int]; fn.restype = ctypes.c_int
        rpid = fn(os.getpid())
        comm = subprocess.run(["ps", "-o", "comm=", "-p", str(rpid)], capture_output=True, text=True, timeout=5).stdout.strip()
        return {"responsible_pid": rpid, "responsible_comm": comm, "is_self": rpid == os.getpid()}
    except Exception as e:
        return {"responsible_pid_error": repr(e)}

def write(p):
    p["label"] = LABEL; p["pid"] = os.getpid(); p["tcc_responsible"] = responsible(); p["ts"] = time.time()
    with open(RESULT, "w") as f: json.dump(p, f, ensure_ascii=False, indent=2)
    print(json.dumps(p, ensure_ascii=False)); sys.stdout.flush()

def main():
    info = {}
    try:
        from CoreBluetooth import CBManager
        a = int(CBManager.authorization())
        info["authorization"] = {0: "notDetermined", 1: "restricted", 2: "denied", 3: "allowedAlways"}.get(a, str(a))
    except Exception as e:
        info["authorization_error"] = repr(e)
    try:
        import asyncio
        from bleak import BleakScanner
        async def scan(): return await BleakScanner.discover(timeout=6.0)
        devs = asyncio.run(scan())
        info["ok"] = True; info["devices_count"] = len(devs)
        info["devices_sample"] = [{"name": d.name, "address": d.address} for d in devs[:5]]
        write(info); return 0
    except Exception as e:
        info["ok"] = False; info["error"] = repr(e); write(info); return 4

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Write failing test `src/core/preflight.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { judgeProbe } from "./preflight";

const info = { code: 0, signal: null, stdout: "", stderr: "", timedOut: false };

describe("judgeProbe", () => {
  it("ok when result.ok true", () => {
    const j = judgeProbe({ ok: true, authorization: "allowedAlways", devices_count: 5, tcc_responsible: { is_self: true, responsible_comm: "python" } }, info);
    expect(j.ok).toBe(true);
    expect(j.devices_count).toBe(5);
    expect(j.is_self).toBe(true);
  });
  it("fail when result missing (TCC killed before write)", () => {
    const j = judgeProbe(null, { code: null, signal: "SIGABRT", stdout: "", stderr: "", timedOut: false });
    expect(j.ok).toBe(false);
    expect(j.signal).toBe("SIGABRT");
  });
  it("fail when result.ok false", () => {
    const j = judgeProbe({ ok: false, error: "denied" }, info);
    expect(j.ok).toBe(false);
    expect(j.error).toBe("denied");
  });
  it("fail on timeout", () => {
    const j = judgeProbe(null, { code: null, signal: "SIGKILL", stdout: "", stderr: "", timedOut: true });
    expect(j.ok).toBe(false);
    expect(j.timedOut).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run src/core/preflight.test.ts`
Expected: FAIL — cannot resolve `./preflight`.

- [ ] **Step 4: Implement `src/core/preflight.ts`**

```ts
import fs from "fs";
import type { ProbeResult } from "../types";
import { runSpawn, type SpawnResult } from "./process";

export function judgeProbe(resultJson: any, info: SpawnResult): ProbeResult {
  const r = resultJson;
  const resp = r && r.tcc_responsible ? r.tcc_responsible : {};
  return {
    ok: !!(r && r.ok === true),
    exitCode: info.code, signal: info.signal, timedOut: !!info.timedOut,
    authorization: r ? (r.authorization ?? null) : null,
    devices_count: r ? (r.devices_count ?? null) : null,
    is_self: resp.is_self === undefined ? null : resp.is_self,
    responsible_comm: resp.responsible_comm ?? null,
    responsible_app: r ? (r.responsible_app ?? null) : null,
    error: r ? (r.error ?? null) : (info.stderr || "").slice(-400) || null,
  };
}

export async function runPreflight(cmd: string, args: string[], resultFile: string, timeoutMs: number): Promise<ProbeResult> {
  try { fs.unlinkSync(resultFile); } catch {}
  const info = await runSpawn(cmd, args, { timeoutMs });
  let r: any = null;
  try { r = JSON.parse(fs.readFileSync(resultFile, "utf8")); } catch {}
  return judgeProbe(r, info);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/core/preflight.test.ts`
Expected: PASS (all 4).

- [ ] **Step 6: Commit**

```bash
git add src/probe/probe.py src/core/preflight.ts src/core/preflight.test.ts
git commit -m "feat: bundled BLE probe and judgeProbe/runPreflight"
```

---

## Task 6: Mode resolution + cascade selection

**Files:**
- Modify: `src/settings.ts` (add `resolveModes`)
- Create: `src/core/launcher.ts` (only `selectMode` in this task), `src/core/launcher.test.ts`
- Modify: `src/settings.test.ts` (add resolveModes tests)

**Interfaces:**
- Consumes: `LaunchSetting`, `LaunchMode`, `ProbeResult` from `types.ts`.
- Produces: `resolveModes(setting: LaunchSetting, platform: string): LaunchMode[]` (in settings.ts); `selectMode(modes: LaunchMode[], probe: (m: LaunchMode) => Promise<ProbeResult>): Promise<{ mode: LaunchMode | null; results: { mode: LaunchMode; result: ProbeResult }[] }>` (in launcher.ts).

- [ ] **Step 1: Add failing tests to `src/settings.test.ts`**

```ts
import { resolveModes } from "./settings";
describe("resolveModes", () => {
  it("auto on darwin cascades ①②④", () => {
    expect(resolveModes("auto", "darwin")).toEqual(["direct", "disclaim", "terminal"]);
  });
  it("auto on non-darwin is direct only", () => {
    expect(resolveModes("auto", "win32")).toEqual(["direct"]);
    expect(resolveModes("auto", "linux")).toEqual(["direct"]);
  });
  it("forced mode is single regardless of platform", () => {
    expect(resolveModes("disclaim", "darwin")).toEqual(["disclaim"]);
    expect(resolveModes("terminal", "darwin")).toEqual(["terminal"]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — `resolveModes` not exported.

- [ ] **Step 3: Add `resolveModes` to `src/settings.ts`**

```ts
import type { LaunchMode } from "./types";

export function resolveModes(setting: LaunchSetting, platform: string): LaunchMode[] {
  if (setting !== "auto") return [setting];
  return platform === "darwin" ? ["direct", "disclaim", "terminal"] : ["direct"];
}
```

- [ ] **Step 4: Write failing test `src/core/launcher.test.ts` (selectMode)**

```ts
import { describe, it, expect } from "vitest";
import { selectMode } from "./launcher";
import type { ProbeResult } from "../types";

const ok: ProbeResult = { ok: true, exitCode: 0, signal: null, timedOut: false, authorization: "allowedAlways", devices_count: 3, is_self: false, responsible_comm: null, responsible_app: null, error: null };
const bad: ProbeResult = { ...ok, ok: false, signal: "SIGABRT" };

describe("selectMode", () => {
  it("stops at first ok (①)", async () => {
    const seen: string[] = [];
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => { seen.push(m); return ok; });
    expect(r.mode).toBe("direct");
    expect(seen).toEqual(["direct"]);
  });
  it("falls back ①→② when ① fails", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "direct" ? bad : ok);
    expect(r.mode).toBe("disclaim");
    expect(r.results.map((x) => x.mode)).toEqual(["direct", "disclaim"]);
  });
  it("falls back to ④ when ①② fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async (m) => m === "terminal" ? ok : bad);
    expect(r.mode).toBe("terminal");
  });
  it("null when all fail", async () => {
    const r = await selectMode(["direct", "disclaim", "terminal"], async () => bad);
    expect(r.mode).toBeNull();
    expect(r.results).toHaveLength(3);
  });
});
```

- [ ] **Step 5: Run to verify fail**

Run: `npx vitest run src/core/launcher.test.ts`
Expected: FAIL — cannot resolve `./launcher`.

- [ ] **Step 6: Implement `selectMode` in `src/core/launcher.ts`**

```ts
import type { LaunchMode, ProbeResult } from "../types";

export async function selectMode(
  modes: LaunchMode[],
  probe: (m: LaunchMode) => Promise<ProbeResult>,
): Promise<{ mode: LaunchMode | null; results: { mode: LaunchMode; result: ProbeResult }[] }> {
  const results: { mode: LaunchMode; result: ProbeResult }[] = [];
  for (const m of modes) {
    const result = await probe(m);
    results.push({ mode: m, result });
    if (result.ok) return { mode: m, results };
  }
  return { mode: null, results };
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/settings.test.ts src/core/launcher.test.ts`
Expected: PASS (settings 6 + launcher 4).

- [ ] **Step 8: Commit**

```bash
git add src/settings.ts src/settings.test.ts src/core/launcher.ts src/core/launcher.test.ts
git commit -m "feat: resolveModes and ①→②→④ cascade selectMode"
```

---

## Task 7: Launch context, env, terminal template, disclaim helper, launchCore

**Files:**
- Create: `src/probe/disclaim_spawn.py`, `src/probe/terminal.command.tpl`
- Modify: `src/core/launcher.ts` (add `LaunchCtx`, `pythonExe`, `buildCoreEnv`, `renderTerminalCommand`, `launchCore`)
- Modify: `src/core/launcher.test.ts` (add pure-part tests)

**Interfaces:**
- Consumes: `CoreStore` paths, `runSpawn`/`writePid`/`readPid`, `runPreflight`.
- Produces:
  - `interface LaunchCtx { python: string; serverPy: string; einkDir: string; coreDir: string; port: number; platform: string; pidFile: string; logFile: string; probePy: string; disclaimPy: string; terminalTpl: string; }`
  - `pythonExe(coreDir: string, platform: string): string`
  - `buildCoreEnv(platform: string, base: Record<string,string>): Record<string,string>` (adds `TODOOCARD_FORCE_PYTHON=1` on darwin)
  - `renderTerminalCommand(tpl: string, vars: { python: string; einkDir: string; pidFile: string; logFile: string; port: number }): string`
  - `launchCore(mode: LaunchMode, ctx: LaunchCtx): Promise<{ pid: number }>`
  - `preflightCmd(mode: LaunchMode, ctx: LaunchCtx, resultFile: string): { cmd: string; args: string[] }`

- [ ] **Step 1: Create `src/probe/disclaim_spawn.py`** (macOS disclaim supervisor; prints `PID <n>` then waits)

```python
#!/usr/bin/env python3
"""macOS disclaim supervisor. Usage: python disclaim_spawn.py <prog> [args...]
Spawn child with TCC responsibility detached, print 'PID <n>', then wait (supervise)."""
import ctypes, os, sys
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
class SpawnAttr(ctypes.Structure):
    _fields_ = [("opaque", ctypes.c_byte * 128)]
libc.posix_spawnattr_init.argtypes = [ctypes.POINTER(SpawnAttr)]; libc.posix_spawnattr_init.restype = ctypes.c_int
libc.posix_spawnattr_destroy.argtypes = [ctypes.POINTER(SpawnAttr)]
libc.responsibility_spawnattrs_setdisclaim.argtypes = [ctypes.POINTER(SpawnAttr), ctypes.c_int]; libc.responsibility_spawnattrs_setdisclaim.restype = ctypes.c_int
libc.posix_spawnp.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(SpawnAttr), ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_char_p)]
libc.posix_spawnp.restype = ctypes.c_int
def to_argv(lst):
    arr = (ctypes.c_char_p * (len(lst) + 1))()
    for i, s in enumerate(lst): arr[i] = s.encode() if isinstance(s, str) else s
    arr[len(lst)] = None; return arr
def main():
    if len(sys.argv) < 2: return 2
    attr = SpawnAttr(); libc.posix_spawnattr_init(ctypes.byref(attr))
    libc.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), 1)
    argv = to_argv(sys.argv[1:]); envp = to_argv(["%s=%s" % (k, v) for k, v in os.environ.items()])
    pid = ctypes.c_int(0)
    rc = libc.posix_spawnp(ctypes.byref(pid), sys.argv[1].encode(), None, ctypes.byref(attr), argv, envp)
    libc.posix_spawnattr_destroy(ctypes.byref(attr))
    if rc != 0: return rc
    print("PID %d" % pid.value); sys.stdout.flush()
    _, status = os.waitpid(pid.value, 0)
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Create `src/probe/terminal.command.tpl`**

```bash
#!/bin/bash
cd "{{einkDir}}" || exit 1
export TODOOCARD_FORCE_PYTHON=1
"{{python}}" server.py --port {{port}} >> "{{logFile}}" 2>&1 &
echo $! > "{{pidFile}}"
wait
```

Note: verify `server.py` accepts `--port`; if it reads PORT env instead (spec says PORT=8199 constant), Task 12 adjusts to `export PORT={{port}}` and drops `--port`. Check `eink/server.py` during this task and pick the correct form; keep the template consistent with reality.

- [ ] **Step 3: Add failing pure-part tests to `src/core/launcher.test.ts`**

```ts
import { buildCoreEnv, renderTerminalCommand, pythonExe, preflightCmd } from "./launcher";

describe("buildCoreEnv", () => {
  it("sets TODOOCARD_FORCE_PYTHON on darwin", () => {
    expect(buildCoreEnv("darwin", { A: "1" }).TODOOCARD_FORCE_PYTHON).toBe("1");
  });
  it("does not set it on win32", () => {
    expect(buildCoreEnv("win32", {}).TODOOCARD_FORCE_PYTHON).toBeUndefined();
  });
});

describe("pythonExe", () => {
  it("darwin uses bin/python3", () => { expect(pythonExe("/c", "darwin")).toBe("/c/python/bin/python3"); });
  it("win32 uses python.exe", () => { expect(pythonExe("/c", "win32")).toBe("/c/python/python.exe"); });
});

describe("renderTerminalCommand", () => {
  it("substitutes all vars", () => {
    const out = renderTerminalCommand('P={{python}} E={{einkDir}} PID={{pidFile}} L={{logFile}} PORT={{port}}',
      { python: "/py", einkDir: "/e", pidFile: "/p", logFile: "/l", port: 8199 });
    expect(out).toBe("P=/py E=/e PID=/p L=/l PORT=8199");
  });
});

describe("preflightCmd", () => {
  const ctx: any = { python: "/py", probePy: "/probe.py", disclaimPy: "/dis.py", platform: "darwin" };
  it("direct runs probe directly", () => {
    const c = preflightCmd("direct", ctx, "/r.json");
    expect(c.cmd).toBe("/py"); expect(c.args).toEqual(["/probe.py", "/r.json", "preflight-direct"]);
  });
  it("disclaim wraps probe in disclaim supervisor", () => {
    const c = preflightCmd("disclaim", ctx, "/r.json");
    expect(c.cmd).toBe("/py"); expect(c.args).toEqual(["/dis.py", "/py", "/probe.py", "/r.json", "preflight-disclaim"]);
  });
});
```

- [ ] **Step 4: Run to verify fail**

Run: `npx vitest run src/core/launcher.test.ts`
Expected: FAIL — new exports not defined.

- [ ] **Step 5: Implement additions in `src/core/launcher.ts`**

```ts
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { LaunchMode } from "../types";
import { writePid, readPid } from "./process";

export interface LaunchCtx {
  python: string; serverPy: string; einkDir: string; coreDir: string; port: number;
  platform: string; pidFile: string; logFile: string; probePy: string; disclaimPy: string; terminalTpl: string;
}

export function pythonExe(coreDir: string, platform: string): string {
  return platform === "win32" ? path.join(coreDir, "python", "python.exe") : path.join(coreDir, "python", "bin", "python3");
}

export function buildCoreEnv(platform: string, base: Record<string, string>): Record<string, string> {
  const env = { ...base };
  if (platform === "darwin") env.TODOOCARD_FORCE_PYTHON = "1";
  return env;
}

export function renderTerminalCommand(tpl: string, vars: { python: string; einkDir: string; pidFile: string; logFile: string; port: number }): string {
  return tpl
    .replace(/{{python}}/g, vars.python).replace(/{{einkDir}}/g, vars.einkDir)
    .replace(/{{pidFile}}/g, vars.pidFile).replace(/{{logFile}}/g, vars.logFile)
    .replace(/{{port}}/g, String(vars.port));
}

export function preflightCmd(mode: LaunchMode, ctx: LaunchCtx, resultFile: string): { cmd: string; args: string[] } {
  if (mode === "disclaim") return { cmd: ctx.python, args: [ctx.disclaimPy, ctx.python, ctx.probePy, resultFile, "preflight-disclaim"] };
  if (mode === "terminal") return { cmd: ctx.python, args: [ctx.probePy, resultFile, "preflight-terminal"] }; // terminal preflight run via open in launchCore path; see note
  return { cmd: ctx.python, args: [ctx.probePy, resultFile, "preflight-direct"] };
}

export async function launchCore(mode: LaunchMode, ctx: LaunchCtx): Promise<{ pid: number }> {
  fs.mkdirSync(path.dirname(ctx.pidFile), { recursive: true });
  const env = buildCoreEnv(ctx.platform, process.env as Record<string, string>);
  if (mode === "direct") {
    const child = spawn(ctx.python, [ctx.serverPy], { cwd: ctx.einkDir, env, detached: process.platform !== "win32", stdio: ["ignore", fs.openSync(ctx.logFile, "a"), fs.openSync(ctx.logFile, "a")] });
    child.unref();
    writePid(ctx.pidFile, child.pid!);
    return { pid: child.pid! };
  }
  if (mode === "disclaim") {
    const child = spawn(ctx.python, [ctx.disclaimPy, ctx.python, ctx.serverPy], { cwd: ctx.einkDir, env, stdio: ["ignore", "pipe", fs.openSync(ctx.logFile, "a")] });
    const pid = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("disclaim PID timeout")), 15000);
      child.stdout!.on("data", (d) => {
        const m = /PID (\d+)/.exec(d.toString());
        if (m) { clearTimeout(t); resolve(parseInt(m[1], 10)); }
      });
      child.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    writePid(ctx.pidFile, pid);
    return { pid };
  }
  // terminal
  const tpl = fs.readFileSync(ctx.terminalTpl, "utf8");
  const cmdFile = path.join(ctx.coreDir, "run", "start-terminal.command");
  fs.writeFileSync(cmdFile, renderTerminalCommand(tpl, { python: ctx.python, einkDir: ctx.einkDir, pidFile: ctx.pidFile, logFile: ctx.logFile, port: ctx.port }));
  fs.chmodSync(cmdFile, 0o755);
  try { fs.unlinkSync(ctx.pidFile); } catch {}
  spawn("open", ["-a", "Terminal", cmdFile], { detached: true, stdio: "ignore" }).unref();
  const pid = await new Promise<number>((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const p = readPid(ctx.pidFile);
      if (p) { clearInterval(iv); resolve(p); }
      else if (Date.now() - start > 30000) { clearInterval(iv); reject(new Error("terminal PID timeout")); }
    }, 500);
  });
  return { pid };
}
```

Note on terminal preflight: ④'s preflight must run UNDER Terminal to be meaningful. In Task 9 `CoreLifecycle` wires ④ preflight by generating a probe `.command` (reuse `renderTerminalCommand` with a probe variant) and polling its result file. `preflightCmd("terminal", …)` here returns a direct-probe placeholder used only for unit shape; the real terminal preflight is implemented in Task 9 via a `terminalProbeCommand` helper added there. Keep this note so the executor does not mistake the placeholder for the real path.

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/core/launcher.test.ts`
Expected: PASS (selectMode 4 + buildCoreEnv 2 + pythonExe 2 + renderTerminalCommand 1 + preflightCmd 2 = 11).

- [ ] **Step 7: Commit**

```bash
git add src/probe/disclaim_spawn.py src/probe/terminal.command.tpl src/core/launcher.ts src/core/launcher.test.ts
git commit -m "feat: launch context, core env, terminal template, disclaim supervisor and launchCore"
```

---

## Task 8: CoreInstaller (sha256, verify, atomic replace, lock, installCore)

**Files:**
- Create: `src/core/installer.ts`, `src/core/installer.test.ts`

**Interfaces:**
- Consumes: `CoreStore`, `PlatformEntry`, `runSpawn`.
- Produces: `sha256File(file: string): string`; `verifySha256(file: string, expected: string): boolean`; `atomicReplaceDir(tmpDir: string, destDir: string): void`; `withLock(lockFile: string, fn: () => Promise<void>): Promise<void>`; `installCore(opts: { store: CoreStore; entry: PlatformEntry; version: string; manifestUrl: string; platform: string; arch: string; fetchText?: (url: string) => Promise<string>; download?: (url: string, dest: string) => Promise<void>; onProgress?: (msg: string) => void }): Promise<void>`.

- [ ] **Step 1: Write failing test `src/core/installer.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { sha256File, verifySha256, atomicReplaceDir } from "./installer";

describe("sha256", () => {
  it("matches known vector and verifies", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sha-")), "f.txt");
    fs.writeFileSync(f, "abc");
    const h = sha256File(f);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(verifySha256(f, h)).toBe(true);
    expect(verifySha256(f, "deadbeef")).toBe(false);
  });
});

describe("atomicReplaceDir", () => {
  it("replaces dest with tmp content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atom-"));
    const tmp = path.join(root, "tmp"); const dest = path.join(root, "dest");
    fs.mkdirSync(tmp); fs.writeFileSync(path.join(tmp, "new"), "N");
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, "old"), "O");
    atomicReplaceDir(tmp, dest);
    expect(fs.existsSync(path.join(dest, "new"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "old"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/core/installer.test.ts`
Expected: FAIL — cannot resolve `./installer`.

- [ ] **Step 3: Implement `src/core/installer.ts`**

```ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import https from "https";
import http from "http";
import { CoreStore } from "./store";
import type { PlatformEntry } from "../types";
import { runSpawn } from "./process";

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
export function verifySha256(file: string, expected: string): boolean {
  return !!expected && sha256File(file) === expected.toLowerCase();
}
export function atomicReplaceDir(tmpDir: string, destDir: string): void {
  const backup = destDir + ".old";
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
  if (fs.existsSync(destDir)) fs.renameSync(destDir, backup);
  fs.renameSync(tmpDir, destDir);
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
}
export async function withLock(lockFile: string, fn: () => Promise<void>): Promise<void> {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  if (fs.existsSync(lockFile)) throw new Error("install already in progress");
  fs.writeFileSync(lockFile, String(process.pid));
  try { await fn(); } finally { try { fs.unlinkSync(lockFile); } catch {} }
}

function defaultDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("http://") ? http : https;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        defaultDownload(res.headers.location, dest).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      res.pipe(file); file.on("finish", () => file.close(() => resolve()));
    }).on("error", (e) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

export async function installCore(opts: {
  store: CoreStore; entry: PlatformEntry; version: string; manifestUrl: string;
  platform: string; arch: string;
  download?: (url: string, dest: string) => Promise<void>;
  onProgress?: (msg: string) => void;
}): Promise<void> {
  const { store, entry } = opts;
  const download = opts.download ?? defaultDownload;
  const log = opts.onProgress ?? (() => {});
  const p = store.paths;
  fs.mkdirSync(p.tmpDir, { recursive: true });
  await withLock(path.join(store.coreDir, "install.lock"), async () => {
    const pyTar = path.join(p.tmpDir, "python.tar.gz");
    const einkZip = path.join(p.tmpDir, "eink.zip");
    log("下载便携 Python…"); await download(entry.pythonUrl, pyTar);
    if (!verifySha256(pyTar, entry.pythonSha256)) throw new Error("python sha256 mismatch");
    log("下载核心源码…"); await download(entry.einkUrl, einkZip);
    if (!verifySha256(einkZip, entry.einkSha256)) throw new Error("eink sha256 mismatch");
    const stage = path.join(p.tmpDir, "stage");
    fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
    log("解压 Python…"); await runSpawn("tar", ["-xzf", pyTar, "-C", path.join(stage, "python")], { timeoutMs: 120000 }).then(() => {});
    fs.mkdirSync(path.join(stage, "python"), { recursive: true });
    await runSpawn("tar", ["-xzf", pyTar, "-C", path.join(stage, "python")], { timeoutMs: 120000 });
    fs.mkdirSync(path.join(stage, "eink"), { recursive: true });
    log("解压核心…"); await runSpawn("unzip", ["-o", einkZip, "-d", path.join(stage, "eink")], { timeoutMs: 120000 });
    const python = opts.platform === "win32" ? path.join(stage, "python", "python.exe") : path.join(stage, "python", "bin", "python3");
    log("安装依赖…");
    const req = path.join(stage, "eink", "requirements.txt");
    const r = await runSpawn(python, ["-m", "pip", "install", "-r", req], { timeoutMs: 300000 });
    if (r.code !== 0) throw new Error("pip install failed: " + r.stderr.slice(-400));
    log("原子替换核心目录…");
    atomicReplaceDir(path.join(stage, "python"), path.join(store.coreDir, "python"));
    atomicReplaceDir(path.join(stage, "eink"), path.join(store.coreDir, "eink"));
    store.writeCoreJson({ version: opts.version, installedAt: Date.now(), source: { manifestUrl: opts.manifestUrl, pythonSha256: entry.pythonSha256, einkSha256: entry.einkSha256 }, launchMode: null, platform: opts.platform, arch: opts.arch });
    fs.rmSync(p.tmpDir, { recursive: true, force: true });
    log("安装完成");
  });
}
```

Note: the double `tar` call above is a mistake to avoid — extract ONCE after creating the dir. Executor: create `stage/python` dir first, then a single `tar -xzf pyTar -C stage/python`. (Remove the first stray `runSpawn(tar…).then(()=>{})` line.) Windows extraction (`tar`/`unzip`) may differ; Task 12 verifies per-OS and adjusts (Windows 10+ has `tar`; unzip via PowerShell `Expand-Archive` fallback). Keep darwin/linux path correct here.

- [ ] **Step 4: Fix the stray double-extract, then run to verify pass**

Remove the first `await runSpawn("tar", …).then(() => {});` line so extraction happens once after `fs.mkdirSync(stage/python)`.
Run: `npx vitest run src/core/installer.test.ts`
Expected: PASS (sha256 1 + atomicReplaceDir 1).

- [ ] **Step 5: Commit**

```bash
git add src/core/installer.ts src/core/installer.test.ts
git commit -m "feat: CoreInstaller sha256/verify/atomic replace/lock and installCore"
```

---

## Task 9: CoreLifecycle (start/stop orchestration, stale detection, exit hook, terminal preflight)

**Files:**
- Create: `src/core/lifecycle.ts`, `src/core/lifecycle.test.ts`
- Modify: `src/core/launcher.ts` (add `terminalProbeCommand`)

**Interfaces:**
- Consumes: `CoreStore`, `selectMode`, `launchCore`, `runPreflight`, `preflightCmd`, `resolveModes`, `readPid`, `killTree`, `LaunchCtx`.
- Produces: class `CoreLifecycle` with `constructor(deps: { store: CoreStore; ctx: LaunchCtx; setting: LaunchSetting; platform: string })`, `async start(): Promise<{ mode: LaunchMode; pid: number }>`, `stop(): void`, `runningPid(): number | null`, `detectStale(): number | null`, `installExitHook(ipc: { on: (ch: string, cb: () => void) => void }): void`. Plus `terminalProbeCommand(ctx, resultFile): string` in launcher.ts.

- [ ] **Step 1: Write failing test `src/core/lifecycle.test.ts`** (orchestration with injected fakes)

```ts
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CoreLifecycle } from "./lifecycle";
import { CoreStore } from "./store";

function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-"));
  const store = new CoreStore(dir);
  store.writeCoreJson({ version: "1", installedAt: 1, source: { manifestUrl: "", pythonSha256: "", einkSha256: "" }, launchMode: null, platform: "darwin", arch: "arm64" });
  const ctx: any = { python: "/py", serverPy: "/e/server.py", einkDir: "/e", coreDir: dir, port: 8199, platform: "darwin", pidFile: store.paths.pidFile, logFile: store.paths.logFile, probePy: "/probe.py", disclaimPy: "/dis.py", terminalTpl: "/tpl" };
  return { store, ctx, dir };
}

describe("CoreLifecycle", () => {
  it("start uses cached mode without preflight", async () => {
    const { store, ctx } = mk();
    store.setCachedMode("direct");
    const launch = vi.fn(async () => ({ pid: 999 }));
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { launchCore: launch, runPreflight: vi.fn() } as any);
    const r = await lc.start();
    expect(r.mode).toBe("direct"); expect(r.pid).toBe(999);
    expect(launch).toHaveBeenCalledWith("direct", ctx);
  });
  it("start runs cascade when no cache and caches winner", async () => {
    const { store, ctx } = mk();
    const launch = vi.fn(async () => ({ pid: 5 }));
    const preflight = vi.fn(async () => ({ ok: true } as any));
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { launchCore: launch, runPreflight: preflight } as any);
    const r = await lc.start();
    expect(r.mode).toBe("direct");
    expect(store.getCachedMode()).toBe("direct");
  });
  it("stop kills running pid and clears pid file", () => {
    const { store, ctx } = mk();
    fs.mkdirSync(path.dirname(ctx.pidFile), { recursive: true });
    fs.writeFileSync(ctx.pidFile, "12345");
    const kill = vi.fn();
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { killTree: kill } as any);
    lc.stop();
    expect(kill).toHaveBeenCalledWith(12345);
    expect(fs.existsSync(ctx.pidFile)).toBe(false);
  });
  it("installExitHook registers siyuan-save-close and stops", () => {
    const { store, ctx } = mk();
    const lc = new CoreLifecycle({ store, ctx, setting: "auto", platform: "darwin" }, { killTree: vi.fn() } as any);
    let cb: () => void = () => {};
    const ipc = { on: (ch: string, f: () => void) => { if (ch === "siyuan-save-close") cb = f; } };
    const stopSpy = vi.spyOn(lc, "stop");
    lc.installExitHook(ipc);
    cb();
    expect(stopSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/core/lifecycle.test.ts`
Expected: FAIL — cannot resolve `./lifecycle`.

- [ ] **Step 3: Implement `src/core/lifecycle.ts`**

```ts
import fs from "fs";
import type { LaunchMode, LaunchSetting, ProbeResult } from "../types";
import { CoreStore } from "./store";
import { selectMode, launchCore as realLaunch, preflightCmd, type LaunchCtx } from "./launcher";
import { runPreflight as realPreflight } from "./preflight";
import { resolveModes } from "../settings";
import { readPid, killTree as realKill } from "./process";

interface Deps {
  launchCore?: typeof realLaunch;
  runPreflight?: (cmd: string, args: string[], resultFile: string, timeoutMs: number) => Promise<ProbeResult>;
  killTree?: typeof realKill;
}

export class CoreLifecycle {
  private launch: typeof realLaunch;
  private preflight: NonNullable<Deps["runPreflight"]>;
  private kill: typeof realKill;
  constructor(
    private cfg: { store: CoreStore; ctx: LaunchCtx; setting: LaunchSetting; platform: string },
    deps: Deps = {},
  ) {
    this.launch = deps.launchCore ?? realLaunch;
    this.preflight = deps.runPreflight ?? realPreflight;
    this.kill = deps.killTree ?? realKill;
  }

  runningPid(): number | null { return readPid(this.cfg.store.paths.pidFile); }

  async start(): Promise<{ mode: LaunchMode; pid: number }> {
    const { store, ctx, setting, platform } = this.cfg;
    let mode = store.getCachedMode();
    if (!mode) {
      const modes = resolveModes(setting, platform);
      const sel = await selectMode(modes, async (m) => {
        const resultFile = `${store.paths.runDir}/preflight-${m}.json`;
        const c = preflightCmd(m, ctx, resultFile);
        return this.preflight(c.cmd, c.args, resultFile, 20000);
      });
      if (!sel.mode) throw new Error("三种启动方式均不可用（BLE 预检全失败），请检查蓝牙权限/配对");
      mode = sel.mode;
      store.setCachedMode(mode);
    }
    const { pid } = await this.launch(mode, ctx);
    return { mode, pid };
  }

  stop(): void {
    const pid = this.runningPid();
    if (pid) this.kill(pid);
    try { fs.unlinkSync(this.cfg.store.paths.pidFile); } catch {}
  }

  detectStale(): number | null {
    const pid = this.runningPid();
    if (!pid) return null;
    try { process.kill(pid, 0); return pid; } catch { return null; }
  }

  installExitHook(ipc: { on: (ch: string, cb: () => void) => void }): void {
    ipc.on("siyuan-save-close", () => this.stop());
  }
}
```

Note: terminal-mode preflight in `start()` currently uses `preflightCmd("terminal")` which is the direct-probe placeholder (Task 7 note). For a correct ④ preflight, add `terminalProbeCommand(ctx, resultFile)` to launcher.ts (renders a probe `.command` via `renderTerminalCommand`-style substitution) and, when `m === "terminal"`, spawn `open -a Terminal` + poll the result file instead of `this.preflight`. Implement that branch here; unit tests above use injected preflight so they stay green. Add a manual verification step in Task 12 for forced ④.

- [ ] **Step 4: Add `terminalProbeCommand` to launcher.ts and the terminal preflight branch**

In `launcher.ts`:

```ts
export function terminalProbeCommand(ctx: LaunchCtx, resultFile: string): string {
  return `#!/bin/bash\ncd "${ctx.einkDir}" || exit 1\n"${ctx.python}" "${ctx.probePy}" "${resultFile}" preflight-terminal\nsleep 3\n`;
}
```

In `lifecycle.ts` `start()` cascade probe callback, special-case terminal:

```ts
import { terminalProbeCommand } from "./launcher";
import { spawn } from "child_process";
// inside selectMode probe callback:
if (m === "terminal") {
  const cmdFile = `${store.paths.runDir}/probe-terminal.command`;
  fs.writeFileSync(cmdFile, terminalProbeCommand(ctx, resultFile));
  fs.chmodSync(cmdFile, 0o755);
  try { fs.unlinkSync(resultFile); } catch {}
  spawn("open", ["-a", "Terminal", cmdFile], { detached: true, stdio: "ignore" }).unref();
  const start = Date.now();
  while (Date.now() - start < 40000) {
    await new Promise((r) => setTimeout(r, 1000));
    try { return JSON.parse(fs.readFileSync(resultFile, "utf8")).ok === true
      ? { ok: true, exitCode: 0, signal: null, timedOut: false, authorization: null, devices_count: null, is_self: null, responsible_comm: "Terminal", responsible_app: "Terminal.app", error: null }
      : { ok: false, exitCode: null, signal: null, timedOut: false, authorization: null, devices_count: null, is_self: null, responsible_comm: null, responsible_app: null, error: "probe not ok" }; } catch {}
  }
  return { ok: false, exitCode: null, signal: null, timedOut: true, authorization: null, devices_count: null, is_self: null, responsible_comm: null, responsible_app: null, error: "terminal probe timeout" };
}
```

(Refactor the callback into a helper method `probeMode(m, resultFile)` to keep `start()` readable.)

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/core/lifecycle.test.ts`
Expected: PASS (all 4).

- [ ] **Step 6: Commit**

```bash
git add src/core/lifecycle.ts src/core/lifecycle.test.ts src/core/launcher.ts
git commit -m "feat: CoreLifecycle start/stop/stale/exit-hook with cascade and terminal preflight"
```

---

## Task 10: Control panel UI + custom tab Web UI + plugin wiring

**Files:**
- Create: `src/ui/ControlPanel.svelte`
- Modify: `src/index.ts` (full wiring: settings load, modules, topbar dialog, custom tab, exit hook, stale prompt)

**Interfaces:**
- Consumes: all core modules; `siyuan` `{ Plugin, Dialog, showMessage }`; `window.require("electron").ipcRenderer`; `window.siyuan.config.system.dataDir`.
- Produces: a working plugin: topbar opens control panel; panel installs/starts/stops/changes mode/path; "打开传图界面" opens a custom tab embedding `http://127.0.0.1:<port>`.

- [ ] **Step 1: Implement `src/ui/ControlPanel.svelte`**

```svelte
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  export let status: string = "not-installed";
  export let running: boolean = false;
  export let mode: string = "";
  export let launch: string = "auto";
  export let coreDir: string = "";
  export let log: string = "";
  export let isDarwin: boolean = true;
  const dispatch = createEventDispatcher();
</script>

<div class="tc-panel">
  <div class="tc-row">状态：{running ? `运行中（${mode}）` : status}</div>
  <div class="tc-row">
    <button class="b3-button b3-button--outline" on:click={() => dispatch("install")}>安装/更新</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("start")} disabled={running}>启动</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("stop")} disabled={!running}>停止</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("recheck")}>重新检测</button>
    <button class="b3-button b3-button--outline" on:click={() => dispatch("openweb")} disabled={!running}>打开传图界面</button>
  </div>
  <div class="tc-row">
    启动方式：
    <select bind:value={launch} on:change={() => dispatch("launch", launch)}>
      <option value="auto">自动 ①→②→④</option>
      <option value="direct">仅 ① 直接</option>
      {#if isDarwin}<option value="disclaim">仅 ② disclaim</option>{/if}
      {#if isDarwin}<option value="terminal">仅 ④ Terminal</option>{/if}
    </select>
  </div>
  <div class="tc-row">核心目录：<code>{coreDir}</code>
    <button class="b3-button b3-button--text" on:click={() => dispatch("opendir")}>打开</button>
    <button class="b3-button b3-button--text" on:click={() => dispatch("changedir")}>更改</button>
  </div>
  <pre class="tc-log">{log}</pre>
</div>

<style>
  .tc-panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .tc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; }
  .tc-log { max-height: 220px; overflow: auto; background: var(--b3-theme-background); border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 8px; font-size: 12px; white-space: pre-wrap; }
</style>
```

- [ ] **Step 2: Implement full `src/index.ts`**

```ts
import { Plugin, Dialog, showMessage } from "siyuan";
import { mount, unmount } from "svelte";
import ControlPanel from "./ui/ControlPanel.svelte";
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
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.settings.launch = normalizeLaunch(this.settings.launch);
    this.rebuild();
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
    const coreDir = this.settings.coreDir || defaultCoreDir(dataDir);
    this.store = new CoreStore(coreDir);
    const platform = process.platform;
    const ctx: LaunchCtx = {
      python: pythonExe(coreDir, platform), serverPy: this.store.paths.serverPy,
      einkDir: this.store.paths.eink, coreDir, port: this.settings.port, platform,
      pidFile: this.store.paths.pidFile, logFile: this.store.paths.logFile,
      probePy: path.join(this.path, "probe", "probe.py"),
      disclaimPy: path.join(this.path, "probe", "disclaim_spawn.py"),
      terminalTpl: path.join(this.path, "probe", "terminal.command.tpl"),
    };
    this.lifecycle = new CoreLifecycle({ store: this.store, ctx, setting: this.settings.launch, platform });
  }

  private log(msg: string) { this.logText += `[${new Date().toLocaleTimeString()}] ${msg}\n`; this.panel?.$set({ log: this.logText }); }

  private openPanel() {
    this.dialog = new Dialog({ title: "土豆片控制台", width: "720px", height: "560px", content: `<div id="tcMount"></div>` });
    const target = this.dialog.element.querySelector("#tcMount") as HTMLElement;
    this.panel = mount(ControlPanel, { target, props: this.panelProps() });
    this.panel.$on("install", () => this.doInstall());
    this.panel.$on("start", () => this.doStart());
    this.panel.$on("stop", () => this.doStop());
    this.panel.$on("recheck", () => { this.store.setCachedMode(null as any); this.log("已清除模式缓存，下次启动重新预检"); });
    this.panel.$on("openweb", () => this.openWeb());
    this.panel.$on("opendir", () => window.require?.("child_process").spawn("open", [this.store.coreDir]));
    this.panel.$on("launch", (e: CustomEvent) => this.saveLaunch(e.detail));
    this.refresh();
  }

  private panelProps() {
    return { status: this.store.detect(), running: this.running, mode: this.currentMode, launch: this.settings.launch, coreDir: this.store.coreDir, log: this.logText, isDarwin: process.platform === "darwin" };
  }
  private refresh() { this.panel?.$set(this.panelProps()); }

  private async saveLaunch(v: string) { this.settings.launch = normalizeLaunch(v); await this.saveData(this.settings); this.rebuild(); this.refresh(); }

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
    (this as any).openTab({ custom: { id: "todoocard-web", title: "土豆片传图", icon: "iconImage", data: { url } } });
  }

  onunload() { this.lifecycle?.stop(); this.panel && unmount(this.panel); this.dialog?.destroy(); }
}
```

Note: `this.path` is the plugin's installed directory (SiYuan Plugin provides it); probe files are copied to `dist/probe` by vite static-copy (Task 1). `openTab` custom-tab rendering of `data.url` requires a custom-tab renderer — SiYuan custom tabs render via the plugin's `openTab` callback; if the installed SiYuan version needs an explicit webview, Task 12 verifies and, if needed, registers a custom tab type that mounts an `<iframe src=url>`. Verify against `plugin-pptgo`'s webview approach (`src/libs/pptgo-webview.svelte`) and reuse it. Adjust `openWeb` to match the proven pptgo pattern during this task.

- [ ] **Step 3: Build + load verification (manual)**

Run: `npm run build`
Then: `npm run make-link` (with SiYuan running) → enable plugin in 设置→集市→已下载→插件.
Expected: topbar 蓝牙图标出现；点击打开控制台；状态显示「未安装」；启动方式下拉在非 macOS 隐藏 ②④。

- [ ] **Step 4: Commit**

```bash
git add src/ui/ControlPanel.svelte src/index.ts
git commit -m "feat: control panel UI, custom-tab web UI and full plugin wiring"
```

---

## Task 11: macOS pure-Python fork patch + pairing docs

**Files:**
- Create (in the eink FORK repo, prepared locally from the research clone): `fork-patch/force-python.patch`, `docs/macos-pairing.md` (in plugin repo)
- Reference: `/tmp/todoocard-research/eink/card.py:1221-1223,1274-1276`

**Interfaces:**
- Produces: a patched `card.py` where macOS honors `TODOOCARD_FORCE_PYTHON=1`; a pairing doc; a hosted fork release (maintainer action).

- [ ] **Step 1: Create the patch**

`fork-patch/force-python.patch` (apply to eink fork `card.py`):

```diff
--- a/card.py
+++ b/card.py
@@
     def _build_payload(self, image_path: Path) -> dict:
-        if sys.platform != "darwin":
+        if sys.platform != "darwin" or os.environ.get("TODOOCARD_FORCE_PYTHON") == "1":
             return self._build_payload_python(image_path)
@@
     def _send_blocking(self, image_path: Path, wait_sec: float | None = None) -> dict:
-        if sys.platform != "darwin":
+        if sys.platform != "darwin" or os.environ.get("TODOOCARD_FORCE_PYTHON") == "1":
             return self._send_python(image_path, wait_sec)
         return self._send_macos(image_path, wait_sec)
```

Ensure `import os` exists at top of `card.py` (add if missing).

- [ ] **Step 2: Verify patch applies + branch flips (local, no BLE)**

Run:
```bash
cp -r /tmp/todoocard-research/eink /tmp/eink-fork-test
cd /tmp/eink-fork-test && git apply <repo>/fork-patch/force-python.patch
TODOOCARD_FORCE_PYTHON=1 python3 -c "import ast,os; src=open('card.py').read(); assert 'TODOOCARD_FORCE_PYTHON' in src; print('patch present')"
```
Expected: patch applies; assertion prints `patch present`. (Full send verification is Task 12 real-machine.)

- [ ] **Step 3: Write `docs/macos-pairing.md`**

Content: 先在「系统设置 → 蓝牙」里配对土豆片（OS 级配对）；纯 Python 模式不使用 Swift 配对助手；配对后在核心 Web UI 点「扫描设备」选中设备再发送；若 bleak 连接失败，确认设备已配对且蓝牙授权已允许。

- [ ] **Step 4: Maintainer hosting checklist (document in README)**

Add to README: 维护者需 (1) 在 eink fork 应用本补丁并打 Release；(2) 准备各平台便携 Python 包 + sha256；(3) 托管 manifest JSON；(4) 在插件设置填 manifest URL。

- [ ] **Step 5: Commit**

```bash
git add fork-patch/force-python.patch docs/macos-pairing.md README.md
git commit -m "feat: macOS pure-Python fork patch and pairing/hosting docs"
```

---

## Task 12: End-to-end real-machine validation + release prep

**Files:**
- Modify: `src/probe/terminal.command.tpl` / `installer.ts` (only if per-OS verification reveals fixes)
- Create: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above + a hosted manifest (or local `file://` manifest pointing at `/tmp` research clone for dev).

- [ ] **Step 1: Prepare a local dev manifest**

Create `/tmp/todoocard-dev/manifest.json` with `darwin-arm64` entry pointing at a local portable Python tarball + a zipped patched eink fork (from Task 11). Compute sha256 with `shasum -a 256`. Set plugin `manifestUrl` to `file:///tmp/todoocard-dev/manifest.json`.

- [ ] **Step 2: Install via control panel**

In SiYuan: 控制台 → 安装/更新.
Expected: 日志显示下载→校验→解压→pip→原子替换→完成；状态变「已安装」；`core.json` 写入。

- [ ] **Step 3: Default auto start (① preflight)**

控制台 → 启动（launch=auto）.
Expected: BLE 预检①通过（本机带声明）→ 核心起于 :8199 → 状态「运行中（direct）」；若弹蓝牙授权点允许。

- [ ] **Step 4: Open Web UI + pair + scan + send**

控制台 → 打开传图界面（页签内嵌 :8199）；按 `docs/macos-pairing.md` 系统配对；核心 UI 扫描设备 → 选 TodooCard → 发送一张测试图。
Expected: 传图成功（纯 Python 路径，`TODOOCARD_FORCE_PYTHON=1`）。若连接/发送失败，记录 bleak 错误并修复（这是 spec §13 标注的待验证风险）。

- [ ] **Step 5: Forced ② and ④**

设置 launch=disclaim → 重新检测 → 启动；确认 `is_self=true`、核心运行、可传图。
设置 launch=terminal → 重新检测 → 启动；确认 Terminal 窗口出现、核心运行、可传图。
Expected: 两种兜底模式均能起核心并传图。

- [ ] **Step 6: Exit cleanup + stale detection**

运行中直接退出思源 → 确认核心进程被关（`ps` 无 server.py）。
模拟残留：手动起核心后重思源 → 加载提示残留 → 控制台停止。
Expected: 退出同步关核心；残留可检测/停止。

- [ ] **Step 7: Windows/Linux smoke (if available)**

On Windows/Linux: auto=direct，安装→启动→开 Web UI→传图。修正 `installer.ts` 解压/`pythonExe`/`killTree` 的平台差异（如 PowerShell `Expand-Archive`）。

- [ ] **Step 8: Release prep**

Bump `plugin.json` version；写 `CHANGELOG.md`；`npm run build` 生成 `package.zip`；按维护者习惯打 tag/Release/集市 PR（需用户确认后执行）。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: Phase 1 end-to-end validation fixes and release prep"
```

---

## Self-Review

**1. Spec coverage:**
- §4 CoreStore → Task 2. §5 Installer/manifest → Tasks 3, 8. §6 cascade/modes/preflight/PID → Tasks 5, 6, 7, 9. §7 lifecycle/exit/stale → Task 9. §8 macOS pure-Python fork → Task 11. §9 UI/webview → Task 10. §11 error handling → installer/lifecycle throw + UI showMessage (Tasks 8, 9, 10). §12 testing → unit tests each task + Task 12 e2e. §14 acceptance 1–7 → Tasks 2/8 (1,2), 6/7/9 (3), 9/10 (4), 9 (5), 10 (6), 11 (7). All covered.
- Gap noted: spec §7 watchdog (optional) is not a dedicated task — it is optional/Phase-1-end; left out intentionally (YAGNI), can add later.

**2. Placeholder scan:** Task 8 had a deliberate stray double-extract line — Step 4 explicitly removes it (not a placeholder, a flagged correction). Task 7/9 terminal-preflight placeholder is explicitly resolved in Task 9 Step 4 with real code. Task 10 `openWeb` custom-tab rendering is flagged to verify against pptgo's proven webview pattern (concrete reference given). No "TBD/add error handling" left.

**3. Type consistency:** `LaunchMode/LaunchSetting/CoreStatus/CoreJson/PlatformEntry/Manifest/ProbeResult/Settings` defined once in Task 1 and reused. `CoreStore.paths` keys consistent across Tasks 2/7/8/9/10. `LaunchCtx` fields defined Task 7, used Tasks 9/10. `selectMode`/`launchCore`/`preflightCmd`/`runPreflight`/`resolveModes` signatures consistent. `SpawnResult` (Task 4) consumed by `judgeProbe` (Task 5). `installCore` opts match Task 10 call. `CoreLifecycle` constructor deps match Task 9 tests and Task 10 usage.

Fixes applied inline during writing (double-extract removal step; terminal preflight real implementation step).