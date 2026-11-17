# plugin-todoocard · 上游核心自动采用 + 版本匹配扩展包 设计文档

- 日期：2026-11-12
- 作者：Gt841（维护者）＋ Qoder
- 状态：**已实现并上线**（插件 `4342dfb` / dist `ae3b180`；dist Release `v1.0.11` + Pages manifest 已发布）
- 项目路径：`<repo>`
- 关联 spec：`docs/superpowers/specs/2026-11-11-todoocard-plugin-design.md`（Phase 1，本 spec 替换其「分发/安装/fork」部分，其余核心管理/级联/控制台不变）
- 独立仓库：`Gt841/todoocard-core-dist`（扩展包 + manifest 托管；上游更新只动这个仓库）

> **As-built 说明（实现期对本 spec 的两处细化，已落地并验证）**
>
> 1. **源码按 commit sha 钉死，而非 tag**：上游**不存在裸 `v1.0.11` tag**（只有 `v1.0.11-macos` / `v1.0.11-windows`，两者核心文件 blob 完全相同）。故 `sourceUrl` 改用 `…/archive/<commit-sha>.tar.gz`，manifest 新增 `coreCommit`（钉死 `3642b4b25e42e38776f3227db601474173f915b1`）+ `coreTag`（仅展示/追溯）。版本守卫第 2 重由「tag 目录名核对」改为「**commit-sha 目录名核对**」（解压顶层 `todoocard-eink-<sha>/`）。
> 2. **`_pair_python` 复用上游 `_pair_bleak`**：上游 v1.0.11 已把配对重构为 bleak（`_scan_card(self)->dict|None` 返回 `{addr, pairing}`；`async _pair_bleak(self, device_id)->bool` 负责连接/bonding）。我们注入的 `_pair_python` **不再自带连接逻辑**，只做「检测配对窗口 → 取地址 → 委托 `self._pair_bleak(addr)`」，避免与上游重复实现。`_scan_python` **不注入**（上游 `_scan_card` / `_scan` 的 bleak 分支已自包含）。
>
> 下文各节均已按 as-built 更新；与初版设计的差异以这两条为准。

## 1. 背景与目标

Phase 1 的分发模型是「维护者把 eink fork（git-diff 补丁打在固定 base `b0f2673` 上）+ 便携 Python 打成 zip，manifest 指向这两个资产」。真机验证暴露三个问题：

1. **上游已远远领先**：`shidaifufen/todoocard-eink` HEAD（v1.0.11）已自行修复我们 fork 修过的两个 bug（`_send_python` 缺 `output` 键、sender 用不存在的 `find_device_by_id`），并把 sender 重写为真机调优版（MTU 247 / PHY 2M / blockPayload 240 / 719 块 / 6.46s）。我们钉死在旧 base 的 fork 已经过时。
2. **补丁随版本漂移**：我们的 git-diff 补丁在上游 HEAD 上 `git apply` 失败（`card.py:329`、`sender.py:40`、`server.py:18` 上下文已变）。补丁是版本特定的，不能盲打。
3. **上游便携包不可打补丁**：上游 Release 的便携包是 **PyInstaller 冻结二进制**（`TodooCardEink` 可执行 + `_internal/libpython3.12.dylib` + `base_library.zip` + 编译 `.so`，零散 `.py` 为 0），无法注入我们的 force-python / localhost-bind 改动。但**按 commit 的 GitHub 源码 tarball 是松散 `.py`，可打补丁**。

目标：把分发模型改为 **A 模型——核心自动采用上游源码 + 我们只托管一个「版本匹配的小扩展包」**：

- 核心源码与便携 Python **直接指向上游**（GitHub 源码 tarball / astral-sh python-build-standalone），我们不托管、不再分发 fork 全量。
- 我们只托管一个**薄扩展包**（一个 Python 文本补丁器 `apply.py` + 元数据），安装时用便携 Python 跑它，把「macOS 纯 Python 发送/配对 + 默认本机绑定」这几处必要改动注入上游源码。
- 扩展包**按上游版本号 + commit 匹配**：manifest 钉死 `coreVersion` + `coreCommit` + 源码 sha256；`apply.py` 用锚点断言确保只在它认识的那一版源码上生效，上游漂移则**失败兜底**（绝不静默打错补丁）。
- **扩展包 + manifest 放在独立 GitHub 仓库 `Gt841/todoocard-core-dist`**。上游有更新时，维护者只动这个 dist 仓库（重做扩展、更新 manifest），**插件仓库一行不改**。

### 本 spec 范围

1. 新 Manifest schema（v2，含 `coreVersion` + `coreCommit` + 三资产）。
2. 安装器改造：三下载 → 解压归一化 → pip → 跑补丁器 → 原子替换 → 写 core.json；全程失败兜底。
3. 扩展包内容（把 force-python + localhost-bind + `_pair_python` 重基到 v1.0.11）与 `apply.py` 契约。
4. 独立 dist 仓库结构、托管方式（Pages 托 manifest + Releases 托扩展 zip）、维护者工作流。
5. 插件仓库瘦身（fork-patch / dev-kit 逻辑迁出，旧物保留为 DEPRECATED 墓碑）。
6. core.json 迁移与版本判定。
7. 测试策略（vitest + 补丁器 Python 测试 + 迁移 + 维护者工作流）。

### 非目标

- 不改核心管理 / ①→②→④ 级联 / 控制台 UI / 退出同步关核心（Phase 1 已实现并验证，保持不变）。
- 不在插件里重写传图管线（核心自带）。
- 不托管 / 不再分发上游核心源码或便携 Python 本体（只引用上游 URL）。
- 不依赖、不再分发 `Sunbelife/TodooCard_Skills`（无授权）；macOS 走纯 Python + 系统配对。
- 自动更新不做后台轮询：**手动触发**（控制台「安装/更新」按钮），自动选最新兼容版。

## 2. 关键事实与已验证结论

| 事实 | 结论 / 证据 |
| --- | --- |
| 上游 HEAD sender 已重写 | `async def send(payload_path, device_id=None, log=print, timeout=180.0)`，内部 `_connect(bleak, device_id, timeout, log)`，返回 `{'ok','seconds','message','acked','blocks'}`；**无 `find_device_by_id` bug**，bleak 实现，macOS 兼容。我们的 sender 修复**作废**。 |
| 上游 `_send_python` 已修 output 键 | HEAD `card.py` `_send_python` 返回含 `output`，docstring 明确解释 KeyError 成因。我们的 output-key 修复**作废**。 |
| 上游 macOS 发送仍走 Swift | `_send_blocking`：`if sys.platform != "darwin": return _send_python(...)` 否则 `_send_macos(...)`（probe/retry/地址轮换，依赖无授权 Swift 工具）。**force-python 门控仍需我们注入**。 |
| 上游 macOS 配对仍走 Swift | 三个 pair 门控（`pair_session._run` / `_run_pair` / `_pair` 路由）在 darwin 分支调 Swift `--pair`；非 darwin 才 `await self._pair_bleak(...)`。**force-python 配对门控仍需我们注入**（darwin + force 时改走 `_pair_python`）。 |
| 上游绑定仍是 0.0.0.0 | `server.py` `web.TCPSite(runner, "0.0.0.0", PORT)`。**localhost-bind 仍需我们注入**（默认 127.0.0.1 + HOST 可选，已获用户授权的安全改动）。 |
| 上游无版本常量、无裸 tag | `card.py` 无 `__version__`/`VERSION`；GitHub 无裸 `v1.0.11` tag（只有 `v1.0.11-macos`/`-windows`，核心 blob 相同）。**版本匹配靠：manifest 钉 `coreCommit` + sha256 + commit-sha 目录名 + `apply.py` 锚点断言**，不靠源码版本字符串或 tag。 |
| 上游便携包 = 冻结二进制 | PyInstaller，零散 `.py` 为 0 → 不可打补丁。**必须用 GitHub 源码 tarball**（`https://github.com/shidaifufen/todoocard-eink/archive/<commit-sha>.tar.gz`，解压顶层 `todoocard-eink-<sha>/`）。 |
| 便携 Python 来源 | astral-sh/python-build-standalone `install_only` tarball，解压顶层 `python/`（`python/bin/python3`）。需**剥一层归一化**或安装器兼容。已发布版本：`cpython-3.11.18+20261110-aarch64-apple-darwin-install_only.tar.gz`。 |
| bleak 3.1.0 API | 无 `find_device_by_id`；按地址/UUID 直连用 `find_device_by_address`，按广播过滤用 `find_device_by_filter`，扫描用 `discover`。`bleak.__version__` 不存在（用 `importlib.metadata.version`）。 |
| 上游配对已重构为 bleak | `_scan_card(self)->dict\|None` 检测配对窗口（厂商 `0x5053`，screen=`data[0]\|data[4]<<8 == 0x134C`，flags=`data[1]`，pairing=`bool(flags&0x02)`），返回 `{addr, pairing}`；`async _pair_bleak(self, device_id)->bool` 做连接/bonding。**我们的 `_pair_python` 复用二者**（检测窗口→委托 `_pair_bleak`），不再自带连接逻辑。 |
| 安装器已具备跑便携 Python 的能力 | 现 `installCore` 已 `runSpawn(python, ["-m","pip","install","-r",req])`。**加跑一次 `apply.py` 近乎零成本**。 |
| 旧 base fork 修复现状（历史） | `/tmp/eink-fixwork`（base `b0f2673`）上 Fix A（sender）+ Fix B（async `_pair_python`）曾 GREEN；最终 bleak 配对补丁已作为存档提交（插件 `1cd2726`）后**整体作废**。其中 `_pair_python` / force-python 概念**带入 dist 仓库 apply.py 重基到 v1.0.11**；sender / output-key 修复**丢弃**（上游已修）。 |

## 3. 总体架构

```
┌─ 插件仓库 plugin-todoocard（上游更新时不动）────────────────┐
│ src/core/installer.ts   三下载→归一化→pip→跑 apply.py→原子替换 │
│ src/core/manifest.ts    v2 schema 解析 + 平台选择 + 版本比较    │
│ src/core/store.ts       core.json（coreVersion+coreCommit）读写/检测│
│ src/types.ts            Manifest/PlatformEntry/CoreJson v2        │
│ src/index.ts            手动「安装/更新」触发 + 版本判定            │
│ launcher/lifecycle/UI   不变（Phase 1）                           │
└──────────────────────────────────────────────────────────────────┘
        │ 读 manifest（Pages）          │ 下载三资产
        ▼                               ▼
┌─ dist 仓库 Gt841/todoocard-core-dist（上游更新只动这里）─┐   ┌─ 上游（我们不托管）──────────┐
│ manifest.json  → GitHub Pages                          │   │ 源码 tarball（GitHub archive）│
│ extension/apply.py + extension.json + tests/           │   │ 便携 Python（astral-sh）      │
│   → 打成 zip 发 GitHub Releases                         │   └──────────────────────────────┘
│ scripts/（build-extension / build-manifest / verify）  │
│ docs/maintainer.md（维护者工作流）                      │
└────────────────────────────────────────────────────────┘
```

数据流（一次安装/更新）：

1. 插件读 `manifestUrl`（默认指向 dist 仓库 Pages）→ 解析 v2 manifest → 按 `platformKey` 选条目。
2. 版本判定：本地 `core.json.coreVersion` vs `manifest.coreVersion`（手动触发；`>=` 则「已是最新」）。
3. 下载三资产（源码 tarball / 便携 Python / 扩展 zip），**逐个 sha256 校验**。
4. 解压 + **归一化布局**（剥 GitHub `todoocard-eink-<sha>/` 与 astral-sh `python/` 顶层；核对 commit-sha 目录名）。
5. 便携 Python 跑 `pip install -r eink/requirements.txt`。
6. 便携 Python 跑 `python extension/apply.py <eink_dir> --core-version <ver> --core-commit <sha>`：**版本/commit 核对 + 锚点断言 + 幂等 + compile 预检 + py_compile 复核**；任何失败 → 抛错中止（原子替换之前，旧核心完好）。
7. `atomicReplaceDir` 替换 python + eink（旧核心保留到成功）→ 写 `core.json`（含 `coreVersion` + `coreCommit`）。
8. 任一步失败：中止，旧核心完好，控制台给出清晰中文错误。

组件职责：

| 组件 | 位置 | 职责 | 变化 |
| --- | --- | --- | --- |
| `types.ts` | 插件 | Manifest/PlatformEntry/CoreJson v2 类型 | 改 schema（加 `coreCommit`/`coreTag`） |
| `manifest.ts` | 插件 | 解析 v2、平台选择、版本比较 | 加 `coreVersion` + `coreCommit` 校验 |
| `installer.ts` | 插件 | 三下载/归一化/pip/补丁器/原子替换 | 重写 `installCore` 主体 + 两个归一化助手 |
| `store.ts` | 插件 | core.json 读写、detect、模式缓存 | CoreJson 加 `coreVersion`+`coreCommit` + `coreVersionOf` 迁移助手 |
| `index.ts` | 插件 | 手动安装/更新触发、版本判定 | 改用 `coreVersionOf(cur)` 比较 |
| `extension/apply.py` | **dist 仓库** | 文本补丁器（版本核对+锚点断言+幂等+编译校验） | 新建（11 处改动） |
| `extension/extension.json` | **dist 仓库** | 声明 `targetCoreVersion`+`targetCoreCommit` + 11 锚点清单 | 新建 |
| `manifest.json` | **dist 仓库** | 钉版本/commit + 三资产 URL/sha | 新建（v2） |
| `scripts/` | **dist 仓库** | 构建扩展/manifest、校验 | 新建（吸收 dev-kit 逻辑） |
| launcher/lifecycle/UI | 插件 | 级联/启停/控制台 | **不变** |

## 4. Manifest schema（v2，as-built）

```json
{
  "version": "2.0.0",
  "coreVersion": "1.0.11",
  "coreCommit": "3642b4b25e42e38776f3227db601474173f915b1",
  "coreTag": "v1.0.11-macos",
  "platforms": {
    "darwin-arm64": {
      "sourceUrl": "https://github.com/shidaifufen/todoocard-eink/archive/3642b4b25e42e38776f3227db601474173f915b1.tar.gz",
      "sourceSha256": "6afea74358af29ed3fe160560b9b409f030ab3aae25d485166617e8ed076cdd9",
      "pythonUrl": "https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.11.18%2B20261110-aarch64-apple-darwin-install_only.tar.gz",
      "pythonSha256": "73f1ed14486aa278d331e95f7d6d452f5cfb69d90b418e26e62fd4846d53557d",
      "extensionUrl": "https://github.com/Gt841/todoocard-core-dist/releases/download/v1.0.11/extension-1.0.11.zip",
      "extensionSha256": "64c0522d3ff690553306e9ed1a014b441d96475e3b3b293be14cec44e1b2abd7"
    }
  }
}
```

> **当前仅发布 `darwin-arm64`**（Apple Silicon）。其他平台键（`darwin-x64`/`windows-x64`/`linux-x64`）schema 已支持但**尚未托管对应资产**；非 arm64 用户安装时 `selectPlatform` 会抛「manifest has no platform entry: <key>」。多平台托管是后续可选工作（见 §12）。

字段语义：

| 字段 | 含义 | 托管方 |
| --- | --- | --- |
| `version` | manifest 自身版本（schema/发布版），辅助 | dist 仓库 Pages |
| `coreVersion` | **钉死的目标上游核心版本**（如 `1.0.11`），版本判定主键，扩展按它匹配 | dist 仓库 Pages |
| `coreCommit` | **钉死的上游 commit sha**，源码 tarball 按它取、目录名按它核对、apply.py 按它校验 | dist 仓库 Pages |
| `coreTag` | 仅展示/追溯（如 `v1.0.11-macos`），**不参与下载与校验**（可选字段） | dist 仓库 Pages |
| `sourceUrl` / `sourceSha256` | 上游**源码** tarball（GitHub archive **commit-sha**），松散 `.py` 可打补丁 | 上游 GitHub（我们不托管） |
| `pythonUrl` / `pythonSha256` | astral-sh 便携 Python `install_only` | 上游 astral-sh（我们不托管） |
| `extensionUrl` / `extensionSha256` | 我们的**扩展 zip**（apply.py + extension.json + tests） | dist 仓库 Releases |
| `depsUrl` / `depsSha256` | 可选离线依赖（无网/弱网兜底，沿用 Phase 1 可选语义；当前未发布） | dist 仓库 Releases（可选） |

平台键沿用 `platformKey(platform, arch)`：`darwin-arm64` / `darwin-x64` / `windows-x64` / `linux-x64`（`win32`→`windows`）。

**版本匹配机制（三重，因上游无版本常量、无裸 tag）**：

1. **sha256 + commit 钉死**：manifest 的 `sourceSha256` 锁定确切源码字节、`coreCommit` 锁定确切提交；下载后 sha 校验不符即中止。
2. **commit-sha 目录名核对**：GitHub archive 解压顶层为 `todoocard-eink-<sha>/`；`normalizeSourceDir` 核对该目录名与 `coreCommit` 一致（恰有一个非隐藏顶层目录且名字 == `todoocard-eink-${coreCommit}`），不符即中止。
3. **锚点断言**：`apply.py` 对每处改动断言「上游原文锚点字符串存在且唯一」；上游漂移（锚点消失/变形/多处）→ 断言失败 → 抛错中止。这是真正的「只在我认识的那一版上生效」守卫。

`extension.json`（扩展 zip 内）声明 `targetCoreVersion` + `targetCoreCommit` 与 11 条锚点清单；`apply.py` 启动时核对 `--core-version == targetCoreVersion` **且** `--core-commit == targetCoreCommit`（均由安装器从 manifest 传入），任一不符即中止；并核对锚点 id 集合与 `PATCHES` 一致。

**更新触发**：手动（控制台「安装/更新」）。插件比较 `coreVersionOf(core.json)` 与 `manifest.coreVersion`，`compareVersion(cur, manifest) >= 0` → 「已是最新」；否则安装。manifest 只发布「最新兼容版」（维护者保证扩展与 coreVersion/coreCommit 匹配），插件无需在多版本间挑选。

**更新时的进程处理**：替换 `eink/`、`python/` 前若核心在运行，必须先停掉并等进程真正退出（`stopAndWait`：SIGTERM → 轮询 → 超时 SIGKILL 兜底），安装结束（无论成败）再自动拉起。原因：进程已 import 的模块不会随文件更新，会继续用内存里的旧代码（真机故障：更新后发送仍走旧 sender）；Windows 下运行中的 `python.exe` 还会锁住文件使替换失败。实现见 `core/installFlow.ts`（停→装→启编排，单测锁定顺序）与 `core/lifecycle.ts#stopAndWait`。

## 5. 安装器流程（installer.ts，as-built）

`installCore(opts)` 主体重写（保留 `withLock` / `atomicReplaceDir` / `defaultDownload` / `verifySha256` / `extractArchive` 等已验证助手）。`opts` 含 `store, entry, version, coreVersion, coreCommit, manifestUrl, platform, arch` 及可注入的 `download/extract/spawn/onProgress`：

| 步 | 动作 | 失败兜底 |
| --- | --- | --- |
| 0 | `withLock(install.lock)`（沿用 stale-lock 恢复） | 已有安装进行 → 抛「install already in progress」 |
| 1 | 下载 `sourceUrl`→`tmp/source.tar.gz`，`verifySha256` | sha 不符 → 抛「source sha256 mismatch」，旧核心不动 |
| 2 | 下载 `pythonUrl`→`tmp/python.tar.gz`（或 `.zip`），`verifySha256` | 同上「python sha256 mismatch」 |
| 3 | 下载 `extensionUrl`→`tmp/extension.zip`，`verifySha256` | 同上「extension sha256 mismatch」 |
| 4 | 解压源码到 `stage/src_raw`；`normalizeSourceDir(srcRaw, coreCommit, stage/eink)`：剥顶层 `todoocard-eink-<sha>/`，核对 commit-sha 目录名 | 目录名不符/缺 server.py → 抛错中止 |
| 5 | 解压 Python 到 `stage/py_raw`；`normalizePythonDir(pyRaw, stage/python, platform)`：剥顶层 `python/` | 缺 python 可执行 → 抛错中止 |
| 6 | 解压扩展到 `stage/extension`（根含 `apply.py`/`extension.json`） | 缺 apply.py → 抛「扩展包缺少 apply.py」 |
| 7 | `runSpawn(python, ["-m","pip","install","-r", stage/eink/requirements.txt])`（可选 `depsUrl` 离线兜底） | pip 非 0 → 抛「pip install failed: …」 |
| 8 | `runSpawn(python, [apply.py, stage/eink, "--core-version", coreVersion, "--core-commit", coreCommit])` | apply.py 非 0 → 抛「扩展补丁失败（上游版本可能已漂移）: …」 |
| 9 | `atomicReplaceDir(stage/python, coreDir/python)`；`atomicReplaceDir(stage/eink, coreDir/eink)` | 替换失败 → 回滚旧核心（沿用 `.old` 恢复） |
| 10 | `writeCoreJson({version, coreVersion, coreCommit, installedAt, source:{manifestUrl, sourceSha256, pythonSha256, extensionSha256}, launchMode:null, platform, arch})` | — |
| 11 | 清 `tmpDir`，log「安装完成」 | — |

归一化助手（新增，已单测）：

- `normalizeSourceDir(rawDir, coreCommit, stageEink) → void`：若 `rawDir/server.py` 已存在（扁平）则原样提升；否则要求 `rawDir` 下**恰有一个**非隐藏顶层目录且名字 == `todoocard-eink-${coreCommit}`（否则抛错），把该目录提升为 `stageEink`；移后断言 `server.py` 存在。
- `normalizePythonDir(rawDir, stagePython, platform) → void`：若顶层是单一 `python/` 目录则剥一层，否则原样；提升后断言可执行存在（`win32`→`python.exe`，其余→`bin/python3`）。
- 二者均「剥一层 or 原样」幂等，兼容上游布局变化。

补丁器调用契约：`apply.py <eink_dir> --core-version <ver> --core-commit <sha> [--extension-json <path>]`，退出码 0=成功（含幂等无操作），非 0=失败（安装器据此中止）。`apply.py` 内部**落盘前 `compile()` 预检 + 落盘后 `py_compile` 复核**，任一编译失败都不写入半成品。

## 6. 扩展包内容（重基到 v1.0.11，as-built）

扩展 = 一个**Python 文本补丁器** `apply.py` + `extension.json` + `tests/`。它把以下必要改动注入上游 v1.0.11 源码（**只注入上游没有的**），共 **11 处**：

| 改动 | 上游 v1.0.11 现状 | 扩展是否注入 | 说明 |
| --- | --- | --- | --- |
| `import os` + `_todoocard_force_python()` 门控助手 | 无 | **注入**（2 处锚点） | `TODOOCARD_FORCE_PYTHON=1` 时返回 True；供下面 6 个门控调用 |
| force-python 发送/构建/扫描门控（`_build_payload`/`_send_blocking`/`_scan`） | macOS 仍强制 Swift | **注入**（3 处 `or _todoocard_force_python():`） | darwin + force 时走纯 Python bleak 路径 |
| `_pair_python`（async：检测窗口→委托 `_pair_bleak`） | 上游 macOS 配对走 Swift `--pair` | **注入**（1 处函数 + 3 处 pair 门控） | 复用上游 `_scan_card`（窗口检测）+ `_pair_bleak`（连接/bonding）；三个 pair 门控（`pair_session._run` / `_run_pair` / `_pair` 路由）在 darwin+force 时改走 `await …_pair_python(...)` |
| localhost-bind（`server.py` `HOST` 默认 `127.0.0.1` + `TCPSite(runner, HOST, PORT)`） | 仍 `0.0.0.0` | **注入**（2 处锚点） | 已获用户授权的安全改动；`HOST` env 由 `buildCoreEnv` 传播 |
| `_scan_python`（bleak 扫描） | 上游 `_scan_card`/`_scan` bleak 分支已自包含 | **不注入** | 无需重复实现 |
| sender `find_device_by_address` 修复 | 上游已重写 sender，无此 bug | **丢弃** | 上游已修 |
| `_send_python` output 键修复 | 上游已修 | **丢弃** | 上游已修 |
| `pick_folders` 平台分支 | 原样 | **不动** | 非本次目标 |

`apply.py` 契约（**版本核对 + 锚点断言 + 幂等 + 双重编译校验 + 失败兜底**，7 点）：

1. **读 `extension.json`**：取 `targetCoreVersion`/`targetCoreCommit` 与锚点清单；核对 `--core-version`/`--core-commit` 传入值，任一不符抛 `VersionError`。
2. **锚点清单一致性**：`extension.json` 的锚点 id 集合必须与 `apply.py` 的 `PATCHES` 完全一致（缺/多即抛 `PatchError`），每条锚点的 `file` 声明与 `lines` 列表也校验。
3. **每处改动先断言锚点**：把锚点 `lines` 以 `\n` 连接成精确字符串，断言它在目标文件里**恰好出现 1 次**；缺失/多处 → 抛 `AnchorError`（上游漂移守卫）。
4. **幂等**：若目标文件已含该 patch 的「注入后标记」（`marker`，如 `# TODOOCARD-FORCE-PYTHON` 注释或已改好的门控/绑定行），跳过该处，不重复注入。重复跑 `apply.py` 字节一致。
5. **文本替换注入**：用精确字符串替换（非行号、非 git-diff）把门控/函数/绑定改动写入；插入的 `_pair_python` 作为完整代码块注入到 `_scan_card` 定义前。
6. **落盘前 `compile()` 预检**：对所有改过的文件内容做 `compile(text, …, "exec")`；任一 `SyntaxError` → 抛 `CompileError`，**不写入任何文件**（避免半成品核心）。
7. **落盘后 `py_compile` 复核 + 退出码**：写入后对每个改过的 `.py` 跑 `py_compile.compile(..., doraise=True)`；全成功（含幂等无操作）→ 0；任何版本/锚点/编译失败 → 非 0 + 清晰中文 stderr。

11 条锚点清单（`extension.json`，按 v1.0.11 钉死 commit 固化；id 与 `apply.py` 的 `PATCHES` 一一对应）：

| id | file | 锚点（上游原文，`lines` 以 `\n` 连接） |
| --- | --- | --- |
| `card-import-os` | card.py | `import logging` / `import random` |
| `card-force-helper` | card.py | `_LOGGER = logging.getLogger("todoocard")` |
| `card-pair-python` | card.py | `    def _scan_card(self) -> dict \| None:` |
| `card-gate-build-payload` | card.py | `    def _build_payload(self, image_path: Path) -> dict:` / `        if sys.platform != "darwin":` |
| `card-gate-send-blocking` | card.py | `    def _send_blocking(self, image_path: Path, wait_sec: float \| None = None) -> dict:` / `        if sys.platform != "darwin":` |
| `card-gate-scan` | card.py | `    async def _scan(request):` / `        svc = current()` / `        if sys.platform != "darwin":` |
| `card-gate-pair-session` | card.py | `        async def _run():` / `            try:` / `                if sys.platform != "darwin":` / `                    ok = await self._pair_bleak(dev)` |
| `card-gate-run-pair` | card.py | `    async def _run_pair(self, device_id: str) -> bool:` / `        if sys.platform != "darwin":` |
| `card-gate-pair-api` | card.py | `            if sys.platform != "darwin":` / `                ok = await svc._pair_bleak(str(dev))` |
| `server-host-bind` | server.py | `PORT = int(os.environ.get("PORT", "8199"))` |
| `server-tcpsite` | server.py | `    site = web.TCPSite(runner, "0.0.0.0", PORT)` |

> 实现注：锚点确切字符串已对照钉死 commit 的上游源码逐一固化进 `extension.json` 与 `apply.py`，并配 7 个 Python 测试（见 §10）。契约锁定「版本核对 + 锚点断言 + 幂等 + 双重编译校验 + 失败兜底」，不锁死行号（行号会漂移）。`v1.0.11-macos` 与 `v1.0.11-windows` 核心 blob 相同，故锚点只需一套。

## 7. 独立 dist 仓库 `Gt841/todoocard-core-dist`

**为什么独立**：用户明确要求「托管扩展+manifest 需要单独一个 github 项目，后续如果上游有更新，只动单独的项目即可」。独立后：上游更新 → 只在 dist 仓库重做扩展 + 更新 manifest + 发 Release/Pages；**插件仓库零改动**（插件只认 manifestUrl）。

仓库布局（已落地，commit `ae3b180`，remote `https://github.com/Gt841/todoocard-core-dist.git`）：

```
todoocard-core-dist/
├─ extension/
│  ├─ apply.py            文本补丁器（版本核对+锚点断言+幂等+双重编译校验）
│  ├─ extension.json      targetCoreVersion + targetCoreCommit + 11 锚点清单
│  └─ tests/              补丁器 Python 测试（v1.0.11 真实 fixture / 漂移 / 幂等 / 版本不符）
│     └─ fixtures/v1.0.11/  card.py（2181 行，与钉死 tarball 字节一致）/ server.py / LICENSE / README.md
├─ manifest.json          v2 manifest（→ GitHub Pages）
├─ scripts/
│  ├─ build-extension.sh  把 extension/ 打成 extension-<ver>.zip + 算 sha256
│  ├─ build-manifest.sh   拉上游源码/便携 Python 算 sha256，生成 manifest.json（REFRESH=1 强制重下）
│  └─ verify.sh           本地端到端：下载→归一化→pip→apply.py→py_compile（不启 BLE；--skip-pip 可跳依赖）
├─ docs/maintainer.md     维护者工作流 / 上游更新手册
├─ .nojekyll              让 Pages 原样伺服（不过 Jekyll）
└─ README.md
```

托管方式（用户选定 **Pages(manifest) + Releases(扩展)**，均已发布）：

| 资产 | 托管 | URL 形态 |
| --- | --- | --- |
| `manifest.json` | GitHub Pages | `https://gt841.github.io/todoocard-core-dist/manifest.json` |
| `extension-<ver>.zip` | GitHub Releases | `https://github.com/Gt841/todoocard-core-dist/releases/download/v<ver>/extension-<ver>.zip` |
| 源码 tarball | 上游 GitHub（引用，不托管） | `https://github.com/shidaifufen/todoocard-eink/archive/<commit-sha>.tar.gz` |
| 便携 Python | 上游 astral-sh（引用，不托管） | python-build-standalone release URL |

插件默认 `manifestUrl` 已指向 dist 仓库 Pages（`src/settings.ts` 的 `DIST_MANIFEST_URL`）；本地开发可 `file://` 指向本地 manifest（沿用 Phase 1）。

**上游更新工作流（只动 dist 仓库）**：

1. 上游发新 tag/commit（如 v1.0.12）→ 维护者取新源码对照，确定新 `coreCommit`。
2. 重基 `apply.py` 锚点到新版（跑 `extension/tests` 的漂移测试确认旧锚点失效、新锚点生效），更新 `extension.json` 的 `targetCoreVersion`/`targetCoreCommit` + 锚点。
3. `scripts/build-manifest.sh` 算新源码/Python sha256，更新 `manifest.json` 的 `coreVersion` + `coreCommit` + 三资产。
4. `scripts/build-extension.sh` 打 `extension-1.0.12.zip`，发 Release `v1.0.12`。
5. 推 `manifest.json` 到 Pages。
6. **插件仓库不动**；用户下次手动「安装/更新」即自动采用新核心 + 匹配扩展。

## 8. 插件仓库瘦身（as-built：旧物保留为 DEPRECATED 墓碑）

| 现插件仓库内容 | 去向 |
| --- | --- |
| `fork-patch/force-python.patch`、`fork-patch/localhost-bind.patch` | **作废**，由 dist 仓库 `apply.py` 文本补丁器取代（raw git-diff 不再应用）。最终 bleak 配对补丁已作为存档提交（`1cd2726`），`fork-patch/README.md` 标注 DEPRECATED + 概念来源，保留作历史回溯。 |
| `scripts/dev-kit.sh`（克隆 fork→打补丁→zip→便携 Python→manifest） | **作废**，头部标注 DEPRECATED 并指向 dist 仓库 `scripts/`（build-extension/build-manifest/verify）。 |
| `docs/macos-pairing.md`、`docs/real-machine-validation.md` | 保留在插件仓库（用户文档）；后者已对齐 v2 流程；dist 仓库另写 `docs/maintainer.md`。 |
| `src/`（installer/manifest/store/types/index/launcher/lifecycle/UI） | 保留，按 §4–§6/§9 改造（已完成）。 |
| 测试 fixture（vitest） | 保留在插件仓库；补丁器 Python fixture 放 dist 仓库 `extension/tests/`。 |

> 旧式补丁与 dev-kit **不删除、只作废**（墓碑式瘦身）：保留作 Phase 1 历史回溯与 `_pair_python`/force-python 概念来源。其有用逻辑已带入 dist 仓库 `apply.py` 重基到 v1.0.11。物理删除是后续可选清理（删除前确认无文档/脚本再引用）。

## 9. core.json 迁移与版本判定（as-built）

CoreJson v2（`types.ts`）：

```ts
export interface CoreJson {
  version: string;          // manifest.version（发布版，辅助）
  coreVersion: string;      // 上游核心版本（版本判定主键）
  coreCommit: string;       // 钉死的上游 commit sha
  installedAt: number;
  source: { manifestUrl: string; sourceSha256: string; pythonSha256: string; extensionSha256: string };
  launchMode: LaunchMode | null;
  platform: string;
  arch: string;
}
```

PlatformEntry v2：`sourceUrl/sourceSha256/pythonUrl/pythonSha256/extensionUrl/extensionSha256/depsUrl?/depsSha256?`（取代旧 `einkUrl/einkSha256`）。
Manifest v2：`{ version: string; coreVersion: string; coreCommit: string; coreTag?: string; platforms: Record<string, PlatformEntry> }`。

迁移与判定：

| 场景 | 处理 |
| --- | --- |
| 旧 core.json（无 `coreVersion`，`source.einkSha256`） | `detect()` 不变（python + server.py 存在 → `installed`）；版本判定在 `doInstall` 处理：`coreVersionOf(cur)` 缺 `coreVersion` 视为 `0.0.0` → 必更新。安装成功后写 v2（含 coreVersion + coreCommit）。 |
| 版本判定 | `index.ts doInstall`：`compareVersion(coreVersionOf(cur), m.coreVersion) >= 0` → 「已是最新」；否则安装。`store.ts` 导出 `coreVersionOf(cj) = cj?.coreVersion ?? "0.0.0"`。 |
| `parseManifest` v2 校验 | 需 `version` + `coreVersion` + `coreCommit` + `platforms`；`selectPlatform` 需 6 个必填字段（`sourceUrl/sourceSha256/pythonUrl/pythonSha256/extensionUrl/extensionSha256`）。缺字段抛清晰错误。 |
| `store.detect()` | 仍查 python 可执行 + `eink/server.py` 存在 → `installed`；core.json 缺失或文件缺失 → `not-installed`。**不**因缺 coreVersion 判 not-installed（迁移交给 doInstall 版本判定）。 |

## 10. 测试策略（as-built：全绿）

| 层 | 工具 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| schema/解析 | vitest | v2 manifest 解析（缺 coreVersion/coreCommit/字段抛错）、平台选择、`compareVersion` | manifest 13 ✓ |
| 归一化 | vitest | `normalizeSourceDir`（剥 commit-sha 顶层、目录名核对、缺 server.py 抛错、扁平兼容）、`normalizePythonDir`（剥 python/ 或原样、缺可执行抛错） | 含于 installer 25 ✓ |
| 安装器 | vitest（mock download/spawn/fs） | 三下载 sha 校验、归一化、pip、跑 apply.py（带 --core-commit）、原子替换、失败中止旧核心完好、core.json v2 写入 | installer 25 ✓ |
| 迁移 | vitest | 旧 core.json（无 coreVersion）→ `coreVersionOf` 触发重装；版本判定用 coreVersion | store 12 / settings 7 ✓ |
| 其余 Phase 1 | vitest | launcher 11 / preflight 4 / lifecycle 4 / process 4 | ✓ |
| 补丁器 | **Python unittest**（dist `extension/tests/test_apply.py`） | ① 锚点唯一性自检；② 真实 v1.0.11 fixture → 11 改动注入 + 编译通过；③ 漂移 → 非 0 且不落盘；④ 幂等（跑两次字节一致）；⑤ coreVersion/coreCommit 不符 → 非 0；⑥ 篡改锚点 json → 非 0；⑦ 缺 server.py → 非 0 | **7/7 ✓** |
| 端到端（无 BLE） | dist `scripts/verify.sh` | 下载→归一化→pip→apply.py→py_compile 全链路（不启蓝牙；`--skip-pip` 用真实便携 Python 验过） | **PASS** |
| 真机 | 用户手动（Task 12） | ①→②→④ 级联 + 纯 Python 发送/配对（需用户点「允许」） | **待用户实测** |

**插件 vitest 合计 80/80 全绿；dist 补丁器 7/7 全绿；verify.sh PASS。** TDD：每个 vitest/Python 测试先红后绿。补丁器测试用**真实上游 v1.0.11 源码 fixture**（松散 `.py`，与钉死 tarball 字节一致），不 mock 被测文本逻辑。

## 11. 锁定的设计决策

| # | 决策 | 选定 | 理由 |
| --- | --- | --- | --- |
| 1 | 分发模型 | **A：上游源码自动采用 + 版本匹配扩展**（便携 Python 取 astral-sh） | 自动采用上游、我们只托管薄扩展；上游已修我们的 bug。eink 用**源码 tarball**（冻结便携包不可打补丁） |
| 2 | 版本/资产驱动 | **Manifest 驱动** | 一处钉版本+三资产，插件只认 manifestUrl |
| 3 | 便携 Python 来源 | **自动取 python-build-standalone** | 官方 relocatable，免自维护 |
| 4 | 扩展形态 | **Python 文本补丁器** | 版本核对+锚点断言+幂等+双重编译校验，比 git-diff 抗漂移、可失败兜底 |
| 5 | 更新触发 | **手动触发** | 控制台按钮，自动选最新兼容版；不做后台轮询 |
| 6 | 托管 | **Pages(manifest)+Releases(扩展)** | 免服务器；源码/Python 引用上游不托管 |
| 7 | 仓库划分 | **独立 `Gt841/todoocard-core-dist`** | 上游更新只动 dist 仓库，插件仓库零改动（用户明确要求） |
| 8 | 源码钉死粒度 | **commit sha（非 tag）** | 上游无裸 `v1.0.11` tag；commit-sha 唯一确定字节，目录名/apply.py 双重核对（as-built 细化） |

## 12. 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| 上游漂移导致锚点失效 | apply.py 锚点断言失败 → 非 0 中止，旧核心完好，控制台提示「上游版本可能已漂移」；维护者重基扩展 |
| 上游源码 tarball 布局变化 | 归一化「剥一层 or 原样」幂等 + commit-sha 目录名核对 + 缺 server.py 抛错 |
| 便携 Python 布局变化 | `normalizePythonDir` 兼容 python/ 顶层或扁平 |
| 下载/sha 不符 | 逐个 sha256 校验，不符即中止（沿用 Phase 1） |
| pip/补丁失败 | 非 0 即中止，原子替换前失败 → 旧核心不动 |
| 无网/弱网 | 可选 `depsUrl` 离线依赖兜底（沿用 Phase 1 可选语义；当前未发布） |
| 旧 core.json 不兼容 | 缺 coreVersion → `coreVersionOf` 视为 0.0.0 触发重装，安装后写 v2 |
| 无授权 Swift 依赖 | force-python + `_pair_python`（复用 `_pair_bleak`）纯 Python + 系统配对，不依赖 `Sunbelife/TodooCard_Skills` |
| 非 arm64 平台无资产 | manifest 当前仅 `darwin-arm64`；其他平台 `selectPlatform` 抛清晰「no platform entry」，需维护者后续托管对应资产 |

## 13. 维护者工作流（速查）

- **首次建 dist 仓库**：**已完成**（`ae3b180`）——建 `Gt841/todoocard-core-dist` → `extension/apply.py`（重基 v1.0.11，11 处改动）+ `extension.json` + 7 tests → `scripts/build-extension.sh` 打 zip 发 Release `v1.0.11` → `scripts/build-manifest.sh` 生成 manifest → 推 Pages → 插件默认 manifestUrl 指向它。
- **上游更新**：见 §7 工作流（只动 dist 仓库）。
- **本地验证**：dist 仓库 `scripts/verify.sh`（无 BLE 全链路）；插件 vitest（80/80）；真机走 Task 12 清单（用户点「允许」）。
- **插件发版**：插件仓库改动（installer/manifest/store/types/index）走正常 build/Release/集市 PR（**需用户授权**）。当前插件仓库**无 git remote**，`Gt841/plugin-todoocard` 尚未创建；发版前需先建远端、bump `plugin.json` 版本、写 CHANGELOG、补 `autoTag.js`（`package.json` 的 `npm run tag` 引用了它但仓库尚无此文件）。