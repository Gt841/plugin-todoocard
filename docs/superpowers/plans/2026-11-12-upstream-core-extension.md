# 上游核心自动采用 + 版本匹配扩展包 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。步骤用 `- [ ]` 复选框跟踪。本轮由主代理一次性在本地实现；**任何 push / 建远端仓库 / 发 Release / 开 Pages 均为 USER GATE，未获授权不得执行**。

**Goal:** 把 plugin-todoocard 的分发模型从「维护者托管 eink fork 全量 zip」改为「核心源码与便携 Python 直接引用上游 + 我们只托管版本匹配的薄扩展包」；上游更新时只动独立 dist 仓库，插件仓库零改动。

**Architecture:** 插件读 v2 manifest → 三资产下载 + 逐个 sha256 → 归一化解压 → 便携 Python 跑 pip → 便携 Python 跑 `apply.py` 注入必要改动 → 原子替换 → 写 v2 `core.json`。扩展包 = Python 文本补丁器（锚点断言 + 幂等 + py_compile + 失败兜底）。

**Tech Stack:** TypeScript / vitest 0.34（插件）；Python 3 标准库 unittest + py_compile（扩展包，无第三方依赖）；bash（构建脚本）；GitHub Pages + Releases（**托管方式，本轮不执行**）。

**Spec:** `docs/superpowers/specs/2026-11-12-upstream-core-extension-design.md`（已批准设计）
**Phase 1 plan:** `docs/superpowers/plans/2026-11-11-todoocard-plugin-phase1.md`（本计划替换其分发/安装/fork 部分；核心管理/级联/控制台不变）

---

## Global Constraints

- 插件仓库：`/Users/guantao/workSpace/siyuan/plugin-todoocard`；dist 仓库本地路径：`/Users/guantao/workSpace/siyuan/todoocard-core-dist`（**本轮只建本地内容，不建 GitHub 仓库**）。
- 目标上游核心版本：`1.0.11`。
- **钉 sha（用户裁定）**：源码资产按 **commit sha** 钉死，不用 tag 下载。
  - `coreCommit = 3642b4b25e42e38776f3227db601474173f915b1`（`v1.0.11-macos` 指向的 commit）。
  - `coreTag = "v1.0.11-macos"` — **仅作展示/追溯**，不参与下载与校验。
  - `sourceUrl = https://github.com/shidaifufen/todoocard-eink/archive/<coreCommit>.tar.gz`
  - `sourceSha256 = 6afea74358af29ed3fe160560b9b409f030ab3aae25d485166617e8ed076cdd9`（2026-11-12 实测）
  - 顶层目录 `todoocard-eink-<40 位 sha>/` → `normalizeSourceDir` 按 **commit sha** 核对，不再按 `coreVersion` 核对。
- **已核实事实修正 spec**：上游**不存在** `v1.0.11` tag，只有 `v1.0.11-macos` / `v1.0.11-windows`（spec §4 的 `tags/v1.0.11.tar.gz` 会 404）。两个 tag 的 `card.py`/`server.py`/`sender.py`/`requirements.txt` blob **完全相同**，故锚点只需一套。
- 便携 Python：astral-sh `20261110` / `cpython-3.11.18+20261110-aarch64-apple-darwin-install_only.tar.gz`，官方原包（顶层 `python/`），`pythonSha256 = 73f1ed14486aa278d331e95f7d6d452f5cfb69d90b418e26e62fd4846d53557d`。**不再重打包成 flat**，由 `normalizePythonDir` 剥一层。
- 补丁器契约：`python apply.py <eink_dir> --core-version <ver> --core-commit <sha>`；退出码 0 = 成功（含幂等无操作），非 0 = 失败（安装器据此中止）。
- **不改**：launcher / lifecycle / preflight / probe / UI / `TODOOCARD_FORCE_PYTHON` env 传播（Phase 1 已验证）；`pick_folders` 的 `sys.platform` 分支（文件夹选择器，非 BLE/TCC 路径）。
- **不注入**：sender 的 `find_device_by_address` 修复、`_send_python` 的 `output` 键修复（上游已修）、`_scan_python`（上游 `_scan_card` 与 `_scan` 的 bleak 分支已自包含）。
- **不提交旧式补丁**：工作树中未提交的 `fork-patch/force-python.patch` 改动作废，其有用逻辑重基进 dist 的 `apply.py`。

---

## 关键决策与已固化锚点

| 项 | 值 |
| --- | --- |
| Manifest schema | `version: "2.0.0"`, `coreVersion: "1.0.11"`, `coreCommit`, `coreTag`, `platforms` |
| 版本判定主键 | `core.json.coreVersion` vs `manifest.coreVersion`；旧 core.json 缺字段 → `0.0.0` → 必更新 |
| 三重版本守卫 | ① sourceSha256 ② archive 顶层目录 == `todoocard-eink-<coreCommit>` ③ apply.py 锚点断言 + coreVersion/coreCommit 双核对 |
| 扩展 zip | `extension-1.0.11.zip`（`apply.py` + `extension.json` + `tests/`），本地构建后算 `extensionSha256` |
| 平台键 | `platformKey()` 沿用：`darwin-arm64` / `darwin-x64` / `windows-x64` / `linux-x64` |

`extension.json` 声明 `targetCoreVersion` / `targetCoreCommit` / `sourceTag` 与 11 条锚点（每条 `id` + `file` + `lines` 数组，`"\n".join(lines)` 即精确锚点字符串）。**JSON 是锚点文本的唯一来源**；`apply.py` 只持有 `replacement` / `marker`，启动时校验两者的 id 集合一致。任何锚点在目标文件中不是「恰好 1 次」即 `AnchorError` → 非 0。

锚点（对照 v1.0.11 实测源码，不锁行号）：

| id | 文件 | 作用 |
| --- | --- | --- |
| `card-import-os` | card.py | 注入 `import os`（`import logging` / `import random` 之间） |
| `card-force-helper` | card.py | 在 `_LOGGER = ...` 后注入 `_todoocard_force_python()` |
| `card-pair-python` | card.py | 在 `_scan_card` 定义前注入 `CardService._pair_python`（检测窗口 → `_pair_bleak` 完成连接/系统配对） |
| `card-gate-build-payload` | card.py | force 门控 |
| `card-gate-send-blocking` | card.py | force 门控 |
| `card-gate-scan` | card.py | force 门控（Web UI 扫描走 bleak） |
| `card-gate-pair-session` | card.py | force 时 `await self._pair_python(dev)` |
| `card-gate-run-pair` | card.py | force 时 `return await self._pair_python(device_id)` |
| `card-gate-pair-api` | card.py | force 时 `await svc._pair_python(...)` |
| `server-host-bind` | server.py | 注入 `HOST = os.environ.get("HOST", "127.0.0.1")` |
| `server-tcpsite` | server.py | `web.TCPSite(runner, "0.0.0.0", PORT)` → `web.TCPSite(runner, HOST, PORT)` |

---

## File Structure

```
todoocard-core-dist/                    ← 新建本地仓库（不 push）
├─ extension/
│  ├─ apply.py                         文本补丁器
│  ├─ extension.json                  版本 + 11 条锚点清单
│  └─ tests/
│     ├─ test_apply.py                unittest：真实/漂移/幂等/版本不符/pick_folders
│     └─ fixtures/v1.0.11/            真实上游 card.py + server.py（MIT）
├─ scripts/
│  ├─ build-extension.sh              打 zip + sha256
│  ├─ build-manifest.sh               拉三资产算 sha → 生成 manifest.json
│  └─ verify.sh                       无 BLE 全链路：下载→归一化→pip→apply.py→py_compile
├─ manifest.json                      v2（本地，待 Pages 托管）
├─ README.md / docs/maintainer.md     维护者工作流
└─ .gitignore

plugin-todoocard/                      ← 改造 5 个模块 + 测试
├─ src/types.ts                       Manifest/PlatformEntry/CoreJson v2
├─ src/core/manifest.ts               v2 解析 + 平台选择 + 版本比较
├─ src/core/installer.ts              normalizeSourceDir / normalizePythonDir / installCore 重写
├─ src/core/store.ts                  CoreJson v2 读写（detect 不变）
├─ src/index.ts                       doInstall 版本判定 + 传 coreVersion/coreCommit
├─ src/core/installer.test.ts         归一化 / 三下载 / apply.py / 兜底 / v2 写入
├─ src/core/manifest.test.ts          v2 schema
├─ src/core/store.test.ts             v2 core.json
├─ README.md                          托管章节重写
└─ fork-patch/ + scripts/dev-kit.sh   作废/迁出说明
```

---

## Task 1: dist 仓库骨架 + extension.json 锚点清单

**Files:** Create `todoocard-core-dist/.gitignore`, `extension/extension.json`, `extension/tests/fixtures/v1.0.11/{card.py,server.py}`

- [ ] **Step 1** 从已校验的 `source.tar.gz` 解出 `card.py` / `server.py` 作为 fixture（与 `git rev-parse HEAD:card.py` blob 一致），保留 MIT LICENSE 说明。
- [ ] **Step 2** 写 `extension.json`：`targetCoreVersion: "1.0.11"`、`targetCoreCommit`、`sourceTag: "v1.0.11-macos"`、`anchors` 数组（每条 `id` / `file` / `lines`，join 后为精确锚点字符串）。
- [ ] **Step 3** 校验脚本：逐条断言 fixture 里锚点出现次数 == 1（此时应全绿）。

**Interfaces:** `apply.py` 读取 `extension.json`；插件安装器读取 `manifest.json`。二者通过 `coreVersion` + `coreCommit` 对齐。

---

## Task 2: apply.py（TDD，先红后绿）

**Files:** Create `extension/tests/test_apply.py`, `extension/apply.py`

- [ ] **Step 1 写测试（红）** `unittest` 5 例：
  1. `test_real_source` — 复制 fixture 到临时目录，子进程跑 `apply.py <dir> --core-version 1.0.11 --core-commit <sha>` → 0；断言 6 处 gate、`_todoocard_force_python`、`_pair_python`、`HOST`、`web.TCPSite(runner, HOST, PORT)` 存在；`py_compile` 通过；`pick_folders` 的分支文本未被改。
  2. `test_drift_fails` — 把 `card-gate-send-blocking` 的锚点改掉 → 非 0 且 stderr 含「锚点」/「漂移」。
  3. `test_idempotent` — 连跑两次，两次退出码 0，第二次输出含「跳过」，文件字节与第一次完全一致。
  4. `test_version_mismatch` — `--core-version 9.9.9` 与 `--core-commit deadbeef` 各跑一次 → 非 0，目标文件未被写入。
  5. `test_tampered_anchor_json` — 篡改 `extension.json` 里的锚点文本 → 锚点断言失败、非 0（漂移守卫）。
- [ ] **Step 2 跑测试确认红**：`python3 -m unittest discover -s extension/tests -v`。
- [ ] **Step 3 实现 `apply.py`**：
  - `apply_extension(eink_dir, core_version, core_commit) -> list[str]`（纯函数式，返回日志）；CLI wrapper `main()` 捕获 `PatchError` → stderr 中文 + `sys.exit(1)`。
  - 读同目录 `extension.json`；校验 `--core-version == targetCoreVersion`、`--core-commit == targetCoreCommit`；校验 JSON anchors 的 id 集合与代码内 `PATCHES` 一致（锚点文本只在 JSON 里）。
  - 每条改动：`marker in text` → 跳过（幂等）；否则 `assert count(anchor) == 1` → `text.replace(anchor, replacement, 1)`。
  - 全部改完后对所有改过的 `.py` 跑 `py_compile.compile(doraise=True)`；**先写内存、编译通过后再落盘**（避免半成品写入），任一失败则不落盘。
- [ ] **Step 4 跑测试确认绿**；`python3 -m unittest discover -s extension/tests -v` 全通过。

---

## Task 3: dist 脚本 / manifest / 文档 / 扩展 zip

**Files:** Create `scripts/build-extension.sh`, `scripts/build-manifest.sh`, `scripts/verify.sh`, `manifest.json`, `README.md`, `docs/maintainer.md`

- [ ] **Step 1** `build-extension.sh`：把 `extension/apply.py` + `extension.json` + `tests/` 打成 `dist/extension-1.0.11.zip`（zip 根即这三个条目），输出 sha256；可重复执行。
- [ ] **Step 2** `build-manifest.sh`：下载源码 tarball（按 `coreCommit`）与官方便携 Python，逐个算 sha256；读 `dist/extension-*.zip` 的 sha；生成 `manifest.json`（`version 2.0.0` / `coreVersion` / `coreCommit` / `coreTag` / `platforms.darwin-arm64`）。离线时支持 `--offline` 用已缓存资产。
- [ ] **Step 3** `verify.sh`：本地端到端（**不启 BLE**）— 校验三资产 sha → 解压 → 归一化（模拟插件的两个 normalize 助手，剥 `todoocard-eink-<sha>/` 与 `python/`）→ 用便携 Python 跑 `pip install -r requirements.txt`（可 `--skip-pip`）→ 跑 `apply.py` → `py_compile` 全量源码 → 打印结果。
- [ ] **Step 4** 文档：README（架构/资产表/本地验证）、`docs/maintainer.md`（上游更新 6 步工作流、锚点重基、发布前核对清单、**用户 gate 清单**）。
- [ ] **Step 5** 实际构建扩展 zip，把 `extensionSha256` 写回 `manifest.json`。

**注意**：manifest 里的 URL 目前指向上游 + 未来 Pages/Releases 地址；`extensionUrl` 是 **待发布** 的占位 URL，本地 `verify.sh` 直接用本地 zip，不依赖该 URL 可访问。文档必须显式标注「本地阶段 extensionUrl 尚不可下载」。

---

## Task 4: 插件 v2 schema（types / manifest）

**Files:** Modify `src/types.ts`, `src/core/manifest.ts`, `src/core/manifest.test.ts`

- [ ] **Step 1（红）** 新测试：v2 manifest 缺 `coreVersion` / 缺 `coreCommit` 抛错；平台条目缺 `sourceUrl`/`pythonUrl`/`extensionUrl` 抛错；`compareVersion` 边界；`parseManifest` 保留 `coreVersion/coreCommit/coreTag`。
- [ ] **Step 2（绿）** `types.ts`：
  ```ts
  export interface CoreJson {
    version: string; coreVersion: string; coreCommit: string;
    installedAt: number;
    source: { manifestUrl: string; sourceSha256: string; pythonSha256: string; extensionSha256: string };
    launchMode: LaunchMode | null; platform: string; arch: string;
  }
  export interface PlatformEntry {
    sourceUrl: string; sourceSha256: string;
    pythonUrl: string; pythonSha256: string;
    extensionUrl: string; extensionSha256: string;
    depsUrl?: string; depsSha256?: string;
  }
  export interface Manifest {
    version: string; coreVersion: string; coreCommit: string; coreTag?: string;
    platforms: Record<string, PlatformEntry>;
  }
  ```
- [ ] **Step 3** `parseManifest` 校验 `version` + `coreVersion` + `coreCommit` + `platforms`；`selectPlatform` 校验三 URL 与三 sha。`coreTag` 可选（仅展示）。
- [ ] **Step 4** `npm test -- manifest.test.ts` 绿。

---

## Task 5: 安装器重写（归一化 + 三下载 + apply.py）

**Files:** Modify `src/core/installer.ts`, `src/core/installer.test.ts`

- [ ] **Step 1（红）** 新测试：
  - `normalizeSourceDir`：剥 `todoocard-eink-<coreCommit>/` 顶层、目录名不符抛错、缺 `server.py` 抛错、幂等（已扁平则原样）。
  - `normalizePythonDir`：剥 `python/` 顶层、缺 `bin/python3` 抛错、幂等。
  - `installCore`（mock download/spawn/fs）：三下载 + 三 sha 校验顺序、任一 sha 不符即中止且旧核心完好、`apply.py` 被调用且参数含 `--core-version` / `--core-commit`、apply.py 非 0 时抛「扩展补丁失败」、成功后写 v2 `core.json`。
- [ ] **Step 2（绿）** 新增导出 `normalizeSourceDir(rawDir, coreCommit, stageDir)` / `normalizePythonDir(rawDir, stageDir)`（纯 fs 操作，可单测）；`installCore` 主体按 spec §5 的 0–11 步重写：
  - 下载 `source.tar.gz` / `python.tar.gz|zip` / `extension.zip`，逐个 `verifySha256`。
  - 解压到 `tmp/{src_raw,py_raw}` → 归一化到 `stage/{eink,python}`；扩展到 `stage/extension`（缺 `apply.py` 抛错）。
  - `runSpawn(python, ["-m","pip","install","-r", stage/eink/requirements.txt])`。
  - `runSpawn(python, [stage/extension/apply.py, stage/eink, "--core-version", coreVersion, "--core-commit", coreCommit])`。
  - `atomicReplaceDir` 两次 → `writeCoreJson` v2 → 清 tmp。
  - 保留 `withLock` / `atomicReplaceDir` / `defaultDownload` / `extractArchive` / `httpGetText` 原样。
- [ ] **Step 3** `npm test -- installer.test.ts` 绿；`npx tsc --noEmit` 0 错误。

---

## Task 6: core.json 迁移与版本判定

**Files:** Modify `src/core/store.ts`, `src/core/store.test.ts`, `src/index.ts`

- [ ] **Step 1（红）** 测试：旧 core.json（无 `coreVersion`、含 `source.einkSha256`）→ `detect()` 仍为 `installed`；v2 写入/读出 `coreVersion` + `coreCommit` 不丢字段。
- [ ] **Step 2（绿）** `store.ts` 类型换 v2，`detect()` 逻辑不变（只查 python + server.py）；`index.ts doInstall`：
  ```ts
  const cur = this.store.readCoreJson();
  if (cur && compareVersion(cur.coreVersion ?? "0.0.0", m.coreVersion) >= 0) {
    this.log("已是最新版本"); return;
  }
  await installCore({ store, entry, version: m.version, coreVersion: m.coreVersion,
                       coreCommit: m.coreCommit, manifestUrl, platform, arch, onProgress });
  ```
- [ ] **Step 3** 全量 `npm test`（含既有 57 例）+ `npx tsc --noEmit` + `npm run build` 三门全绿。

---

## Task 7: 插件仓库瘦身

**Files:** Modify `README.md`, `fork-patch/README.md`（新增作废说明）, `scripts/dev-kit.sh`（顶部加 DEPRECATED 注释）

- [ ] **Step 1** README「维护者托管」章节改写为 v2：manifest 由 dist 仓库 Pages 托管、扩展 zip 由 Releases 托管、插件只认 `manifestUrl`；删除「在 eink fork 上 git apply 两个补丁」的旧流程。
- [ ] **Step 2** `fork-patch/*.patch` 与 `scripts/dev-kit.sh` 标注 DEPRECATED（**本轮不删除文件**，避免影响 Phase 1 历史回溯；迁移清理列为后续可选任务）。
- [ ] **Step 3** 说明「上游更新只动 dist 仓库」+ 「安全：HOST 默认 127.0.0.1」两节保留。

---

## Task 8: 本地全链路验证（无 BLE）+ 交付

- [ ] **Step 1** `python3 -m unittest discover -s todoocard-core-dist/extension/tests -v` 全绿。
- [ ] **Step 2** `bash todoocard-core-dist/scripts/build-extension.sh` → 扩展 zip + sha256。
- [ ] **Step 3** `bash todoocard-core-dist/scripts/verify.sh --skip-pip`（或带 pip，视网络）→ 归一化 / apply.py / py_compile 全通过。
- [ ] **Step 4** 插件三门：`npm test` / `npx tsc --noEmit` / `npm run build`。
- [ ] **Step 5** `manifest.json` 的三资产 sha256 与本地实际资产逐一复核。
- [ ] **Step 6** 汇总交付说明：改了哪些文件、验证结果、**仍需用户点头的事项**（建 `Gt841/todoocard-core-dist`、发 Release `v1.0.11`、开 Pages、推插件改动、真机 BLE 验证、插件发版/集市 PR）。
- [ ] **Step 7（USER GATE，本轮不执行）** 以上对外操作与 git commit/push；`docs/real-machine-validation.md` 的 Task 12 真机清单。

---

## Self-Review

**Spec 覆盖**：§4 schema → Task 4；§5 安装器 → Task 5；§6 扩展内容/契约 → Task 1–2；§7 dist 仓库/托管/工作流 → Task 3（托管部分为 USER GATE）；§8 瘦身 → Task 7；§9 迁移与判定 → Task 6；§10 测试 → Task 2/4/5/6/8；§12 风险兜底 → 三重守卫 + 失败中止 + 原子替换。非目标（launcher/lifecycle/UI/级联）未触碰。

**偏差说明（相对 spec）**：
1. `sourceUrl` 按 commit sha 而非 `tags/v1.0.11`（上游无此 tag）——用户裁定，spec §4/§5 的 tag 目录名核对改为 commit sha 目录核对。
2. 新增 manifest 字段 `coreCommit`（必需）与 `coreTag`（可选展示）；`extension.json` 同步 `targetCoreCommit`。
3. 不注入 `_scan_python`：上游 `_scan_card` 与 `_scan` 的 bleak 分支已自包含（spec §6 允许「核对后按需注入」）。
4. `_pair_python` 实现为「`_scan_card` 检测窗口 → 复用上游 `_pair_bleak` 连接/系统配对」，不复制旧 fork 代码。
5. `fork-patch/` 与 `dev-kit.sh` 本轮只标 DEPRECATED 不删除（可回溯）。

**风险**：GitHub archive tarball 的字节可能随服务端重新生成而变化 → `build-manifest.sh` 在发布前必须重新下载并复算 `sourceSha256`；`verify.sh` 也会拦截不符。便携 Python 同理。

---

## 发布执行记录（2026-11-12 追加）

用户已授权执行 Step 7 的对外部分，以下为实际结果（本记录覆盖上方「USER GATE 本轮不执行」的时点表述）：

| 动作 | 结果 |
| --- | --- |
| `REFRESH=1 bash scripts/build-manifest.sh` 复算 sha | 三项 sha 与首轮一致，无漂移 |
| Python unittest / `verify.sh`（含 pip） | 7/7；8 条注入断言全绿 |
| 建 `Gt841/todoocard-core-dist`（public）+ push `main` | 已完成，首个 commit `ae3b180`，15 个追踪文件含 `.nojekyll` |
| Release `v1.0.11` | 已发布 `extension-1.0.11.zip` + `.sha256`；线上下载 sha = manifest `extensionSha256` |
| GitHub Pages | 已启用（`main` / `/`），`https://gt841.github.io/todoocard-core-dist/manifest.json` 与仓库内 manifest 逐字节一致，状态 `built` |
| 线上三资产验收 | 按线上 manifest 的 URL 下载 source / python / extension，三项 sha 全匹配；用该资产跑 `verify.sh` 全链路 PASS |
| 插件默认 manifestUrl | `src/settings.ts` 已指向 `DIST_MANIFEST_URL`，`settings.test.ts` 加回归断言 |

**未完成（需人工）**：真机 BLE 全流程验证；插件 tag / Release / 思源集市 PR。插件仓库当前无 git remote，`Gt841/plugin-todoocard` 尚未创建，故仅做本地提交、未推送。
