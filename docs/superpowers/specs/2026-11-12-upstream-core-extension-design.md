# plugin-todoocard · 上游核心自动采用 + 版本匹配扩展包 设计文档

- 日期：2026-11-12
- 作者：Gt841（维护者）＋ Qoder
- 状态：已批准设计，待写实现计划
- 项目路径：`/Users/guantao/workSpace/siyuan/plugin-todoocard`
- 关联 spec：`docs/superpowers/specs/2026-11-11-todoocard-plugin-design.md`（Phase 1，本 spec 替换其「分发/安装/fork」部分，其余核心管理/级联/控制台不变）
- 新增独立仓库：`Gt841/todoocard-core-dist`（扩展包 + manifest 托管；上游更新只动这个仓库）

## 1. 背景与目标

Phase 1 的分发模型是「维护者把 eink fork（git-diff 补丁打在固定 base `b0f2673` 上）+ 便携 Python 打成 zip，manifest 指向这两个资产」。真机验证暴露三个问题：

1. **上游已远远领先**：`shidaifufen/todoocard-eink` HEAD（v1.0.11）已自行修复我们 fork 修过的两个 bug（`_send_python` 缺 `output` 键、sender 用不存在的 `find_device_by_id`），并把 sender 重写为真机调优版（MTU 247 / PHY 2M / blockPayload 240 / 719 块 / 6.46s）。我们钉死在旧 base 的 fork 已经过时。
2. **补丁随版本漂移**：我们的 git-diff 补丁在上游 HEAD 上 `git apply` 失败（`card.py:329`、`sender.py:40`、`server.py:18` 上下文已变）。补丁是版本特定的，不能盲打。
3. **上游便携包不可打补丁**：上游 Release 的便携包是 **PyInstaller 冻结二进制**（`TodooCardEink` 可执行 + `_internal/libpython3.12.dylib` + `base_library.zip` + 编译 `.so`，零散 `.py` 为 0），无法注入我们的 force-python / localhost-bind 改动。但**按 tag 的 GitHub 源码 tarball 是松散 `.py`，可打补丁**。

目标：把分发模型改为 **A 模型——核心自动采用上游源码 + 我们只托管一个「版本匹配的小扩展包」**：

- 核心源码与便携 Python **直接指向上游**（GitHub 源码 tarball / astral-sh python-build-standalone），我们不托管、不再分发 fork 全量。
- 我们只托管一个**薄扩展包**（一个 Python 文本补丁器 `apply.py` + 元数据），安装时用便携 Python 跑它，把「macOS 纯 Python 发送/配对 + 默认本机绑定」这几处必要改动注入上游源码。
- 扩展包**按上游版本号匹配**：manifest 钉死 `coreVersion` + 源码 sha256；`apply.py` 用锚点断言确保只在它认识的那一版源码上生效，上游漂移则**失败兜底**（绝不静默打错补丁）。
- **扩展包 + manifest 放在独立 GitHub 仓库 `Gt841/todoocard-core-dist`**。上游有更新时，维护者只动这个 dist 仓库（重做扩展、更新 manifest），**插件仓库一行不改**。

### 本 spec 范围

1. 新 Manifest schema（v2，含 `coreVersion` + 三资产）。
2. 安装器改造：三下载 → 解压归一化 → pip → 跑补丁器 → 原子替换 → 写 core.json；全程失败兜底。
3. 扩展包内容（把 force-python + localhost-bind + `_scan_python` + `_pair_python` 重基到 v1.0.11）与 `apply.py` 契约。
4. 独立 dist 仓库结构、托管方式（Pages 托 manifest + Releases 托扩展 zip）、维护者工作流。
5. 插件仓库瘦身（fork-patch / dev-kit 逻辑迁出）。
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
| 上游 macOS 仍走 Swift | `_send_blocking`：`if sys.platform != "darwin": return _send_python(...)` 否则 `_send_macos(...)`（probe/retry/地址轮换，依赖无授权 Swift 工具）。**force-python 门控仍需我们注入**。 |
| 上游绑定仍是 0.0.0.0 | `server.py` `web.TCPSite(runner, "0.0.0.0", PORT)`。**localhost-bind 仍需我们注入**（默认 127.0.0.1 + HOST 可选，已获用户授权的安全改动）。 |
| 上游无版本常量 | `card.py` 无 `__version__`/`VERSION`。**版本匹配不能靠源码里的版本字符串**，只能靠：manifest 钉 sha256 + tag 目录名 + `apply.py` 锚点断言。 |
| 上游便携包 = 冻结二进制 | PyInstaller，零散 `.py` 为 0 → 不可打补丁。**必须用 GitHub 源码 tarball**（`https://github.com/shidaifufen/todoocard-eink/archive/refs/tags/v<ver>.tar.gz`，解压顶层 `todoocard-eink-<tag>/`）。 |
| 便携 Python 来源 | astral-sh/python-build-standalone `install_only` tarball，解压顶层 `python/`（`python/bin/python3`）。需**剥一层归一化**或安装器兼容。 |
| bleak 3.1.0 API | 无 `find_device_by_id`；按地址/UUID 直连用 `find_device_by_address`，按广播过滤用 `find_device_by_filter`，扫描用 `discover`。`bleak.__version__` 不存在（用 `importlib.metadata.version`）。 |
| 上游配对契约 | `_scan_card()` 纯 Python bleak 检测配对窗口：厂商 `0x5053`，screen=`data[0]|data[4]<<8 == 0x134C`，flags=`data[1]`，pairing=`bool(flags&0x02)`；Swift `--pair` 做「加密系统配对」（窗口内 CoreBluetooth connect 触发 macOS bonding）。我们的 `_pair_python` 复刻：检测窗口→连接→系统配对。 |
| 安装器已具备跑便携 Python 的能力 | 现 `installCore` 已 `runSpawn(python, ["-m","pip","install","-r",req])`。**加跑一次 `apply.py` 近乎零成本**。 |
| 旧 base fork 修复现状 | `/tmp/eink-fixwork`（base `b0f2673`）上 Fix A（sender）+ Fix B（async `_pair_python`）已 GREEN；`fork-patch/force-python.patch` 已重生成但**未提交**。其中 `_pair_python` / force-python 概念**带入 dist 仓库 apply.py 重基到 v1.0.11**；sender / output-key 修复**丢弃**（上游已修）。 |

## 3. 总体架构

```
┌─ 插件仓库 plugin-todoocard（上游更新时不动）────────────────┐
│ src/core/installer.ts   三下载→归一化→pip→跑 apply.py→原子替换 │
│ src/core/manifest.ts    v2 schema 解析 + 平台选择 + 版本比较    │
│ src/core/store.ts       core.json（含 coreVersion）读写/检测    │
│ src/types.ts            Manifest/PlatformEntry/CoreJson v2     │
│ src/index.ts            手动「安装/更新」触发 + 版本判定         │
│ launcher/lifecycle/UI   不变（Phase 1）                        │
└──────────────────────────────────────────────────────────────┘
        │ 读 manifest（Pages）          │ 下载三资产
        ▼                               ▼
┌─ dist 仓库 Gt841/todoocard-core-dist（上游更新只动这里）─┐   ┌─ 上游（我们不托管）──────────┐
│ manifest.json  → GitHub Pages                          │   │ 源码 tarball（GitHub archive）│
│ extension/apply.py + extension.json + tests/           │   │ 便携 Python（astral-sh）      │
│   → 打成 zip 发 GitHub Releases                         │   └──────────────────────────────┘
│ scripts/（build-extension / build-manifest / verify）  │
│ .github/workflows/（可选 CI）                           │
└────────────────────────────────────────────────────────┘
```

数据流（一次安装/更新）：

1. 插件读 `manifestUrl`（默认指向 dist 仓库 Pages）→ 解析 v2 manifest → 按 `platformKey` 选条目。
2. 版本判定：本地 `core.json.coreVersion` vs `manifest.coreVersion`（手动触发；`>=` 则「已是最新」）。
3. 下载三资产（源码 tarball / 便携 Python / 扩展 zip），**逐个 sha256 校验**。
4. 解压 + **归一化布局**（剥 GitHub `todoocard-eink-<tag>/` 与 astral-sh `python/` 顶层）。
5. 便携 Python 跑 `pip install -r eink/requirements.txt`。
6. 便携 Python 跑 `python extension/apply.py <eink_dir>`：**锚点断言 + 幂等 + py_compile**；任何断言失败 → 抛错中止。
7. `atomicReplaceDir` 替换 python + eink（旧核心保留到成功）→ 写 `core.json`（含 `coreVersion`）。
8. 任一步失败：中止，旧核心完好，控制台给出清晰中文错误。

组件职责：

| 组件 | 位置 | 职责 | 变化 |
| --- | --- | --- | --- |
| `types.ts` | 插件 | Manifest/PlatformEntry/CoreJson v2 类型 | 改 schema |
| `manifest.ts` | 插件 | 解析 v2、平台选择、版本比较 | 加 `coreVersion` 校验 |
| `installer.ts` | 插件 | 三下载/归一化/pip/补丁器/原子替换 | 重写 `installCore` 主体 |
| `store.ts` | 插件 | core.json 读写、detect、模式缓存 | CoreJson 加 `coreVersion` + 迁移 |
| `index.ts` | 插件 | 手动安装/更新触发、版本判定 | 改用 `coreVersion` 比较 |
| `extension/apply.py` | **dist 仓库** | 文本补丁器（锚点断言+幂等+py_compile） | 新建 |
| `extension/extension.json` | **dist 仓库** | 声明 `targetCoreVersion` + 锚点清单 | 新建 |
| `manifest.json` | **dist 仓库** | 钉版本 + 三资产 URL/sha | 新建（v2） |
| `scripts/` | **dist 仓库** | 构建扩展/manifest、校验 | 新建（吸收 dev-kit 逻辑） |
| launcher/lifecycle/UI | 插件 | 级联/启停/控制台 | **不变** |

## 4. Manifest schema（v2）

```json
{
  "version": "2.0.0",
  "coreVersion": "1.0.11",
  "platforms": {
    "darwin-arm64": {
      "sourceUrl": "https://github.com/shidaifufen/todoocard-eink/archive/refs/tags/v1.0.11.tar.gz",
      "sourceSha256": "<上游源码 tarball 的 sha256>",
      "pythonUrl": "https://github.com/astral-sh/python-build-standalone/releases/download/<rel>/cpython-<ver>+<rel>-aarch64-apple-darwin-install_only.tar.gz",
      "pythonSha256": "<便携 Python 的 sha256>",
      "extensionUrl": "https://github.com/Gt841/todoocard-core-dist/releases/download/v1.0.11/extension-1.0.11.zip",
      "extensionSha256": "<扩展 zip 的 sha256>",
      "depsUrl": "<可选：离线依赖 wheel 包>",
      "depsSha256": "<可选>"
    }
  }
}
```

字段语义：

| 字段 | 含义 | 托管方 |
| --- | --- | --- |
| `version` | manifest 自身版本（schema/发布版），用于「已是最新」判定的辅助 | dist 仓库 Pages |
| `coreVersion` | **钉死的目标上游核心版本**（如 `1.0.11`），扩展按它匹配 | dist 仓库 Pages |
| `sourceUrl` / `sourceSha256` | 上游**源码** tarball（GitHub archive tag），松散 `.py` 可打补丁 | 上游 GitHub（我们不托管） |
| `pythonUrl` / `pythonSha256` | astral-sh 便携 Python `install_only` | 上游 astral-sh（我们不托管） |
| `extensionUrl` / `extensionSha256` | 我们的**扩展 zip**（apply.py + extension.json + tests） | dist 仓库 Releases |
| `depsUrl` / `depsSha256` | 可选离线依赖（无网/弱网兜底，沿用 Phase 1 可选语义） | dist 仓库 Releases（可选） |

平台键沿用 `platformKey(platform, arch)`：`darwin-arm64` / `darwin-x64` / `windows-x64` / `linux-x64`（`win32`→`windows`）。

**版本匹配机制（三重，因上游无版本常量）**：

1. **sha256 钉死**：manifest 的 `sourceSha256` 锁定确切源码字节；下载后校验不符即中止。
2. **tag 目录名核对**：GitHub archive 解压顶层为 `todoocard-eink-<tag>/`；归一化前核对该目录名与 `coreVersion` 一致（`v1.0.11` ↔ `1.0.11`），不符即中止。
3. **锚点断言**：`apply.py` 对每处改动断言「上游原文锚点字符串存在且唯一」；上游漂移（锚点消失/变形/多处）→ 断言失败 → 抛错中止。这是真正的「只在我认识的那一版上生效」守卫。

`extension.json`（扩展 zip 内）声明 `targetCoreVersion` 与锚点清单；`apply.py` 启动时核对 `targetCoreVersion == 传入 coreVersion`（由安装器从 manifest 传入），不符即中止。

**更新触发**：手动（控制台「安装/更新」）。插件比较 `core.json.coreVersion` 与 `manifest.coreVersion`，`compareVersion(cur, manifest) >= 0` → 「已是最新」；否则安装。manifest 只发布「最新兼容版」（维护者保证扩展与 coreVersion 匹配），插件无需在多版本间挑选。

## 5. 安装器流程（installer.ts 改造）

`installCore(opts)` 主体重写（保留 `withLock` / `atomicReplaceDir` / `defaultDownload` / `verifySha256` / `extractArchive` 等已验证助手）：

| 步 | 动作 | 失败兜底 |
| --- | --- | --- |
| 0 | `withLock(install.lock)`（沿用 stale-lock 恢复） | 已有安装进行 → 抛「install already in progress」 |
| 1 | 下载 `sourceUrl`→`tmp/source.tar.gz`，`verifySha256` | sha 不符 → 抛「source sha256 mismatch」，旧核心不动 |
| 2 | 下载 `pythonUrl`→`tmp/python.tar.gz`（或 `.zip`），`verifySha256` | 同上「python sha256 mismatch」 |
| 3 | 下载 `extensionUrl`→`tmp/extension.zip`，`verifySha256` | 同上「extension sha256 mismatch」 |
| 4 | 解压源码到 `tmp/src_raw`；**归一化**：剥顶层 `todoocard-eink-<tag>/` → `stage/eink`（根含 `server.py`/`requirements.txt`）；核对 tag 目录名 == coreVersion | 目录名不符/缺 server.py → 抛错中止 |
| 5 | 解压 Python 到 `tmp/py_raw`；**归一化**：剥顶层 `python/` → `stage/python`（含 `bin/python3` 或 `python.exe`） | 缺 python 可执行 → 抛错中止 |
| 6 | 解压扩展到 `stage/extension`（根含 `apply.py`/`extension.json`） | 缺 apply.py → 抛错中止 |
| 7 | `runSpawn(python, ["-m","pip","install","-r", stage/eink/requirements.txt])`（可选 `depsUrl` 离线兜底） | pip 非 0 → 抛「pip install failed: …」 |
| 8 | `runSpawn(python, [stage/extension/apply.py, stage/eink, "--core-version", coreVersion])` | apply.py 非 0 → 抛「扩展补丁失败（上游版本可能已漂移）: …」 |
| 9 | `atomicReplaceDir(stage/python, coreDir/python)`；`atomicReplaceDir(stage/eink, coreDir/eink)` | 替换失败 → 回滚旧核心（沿用 `.old` 恢复） |
| 10 | `writeCoreJson({version, coreVersion, installedAt, source:{manifestUrl, sourceSha256, pythonSha256, extensionSha256}, launchMode:null, platform, arch})` | — |
| 11 | 清 `tmpDir`，log「安装完成」 | — |

归一化助手（新增，可单测）：

- `normalizeSourceDir(rawDir, coreVersion) → einkDir`：要求 `rawDir` 下**恰有一个**顶层目录且名字匹配 `todoocard-eink-v?<coreVersion>`（否则抛错），把其**内容**移到 `stage/eink`（使 `server.py` 在根）；移后断言 `server.py` 存在。
- `normalizePythonDir(rawDir) → pythonDir`：若顶层是单一 `python/` 则剥一层，使 `bin/python3`（或 `python.exe`）落在 `stage/python` 下；若已扁平则原样。
- 二者均「剥一层 or 原样」幂等，兼容上游布局变化。

补丁器调用契约：`apply.py <eink_dir> --core-version <ver>`，退出码 0=成功（含幂等无操作），非 0=失败（安装器据此中止）。`apply.py` 内部对每个改动文件做 `py_compile`，编译失败也返回非 0。

## 6. 扩展包内容（重基到 v1.0.11）

扩展 = 一个**Python 文本补丁器** `apply.py` + `extension.json` + `tests/`。它把以下必要改动注入上游 v1.0.11 源码（**只注入上游没有的**）：

| 改动 | 上游 v1.0.11 现状 | 扩展是否注入 | 说明 |
| --- | --- | --- | --- |
| force-python 门控（`_send_blocking`/`_build_payload`/`_scan`/pair 路径） | macOS 仍强制 Swift | **注入** | `TODOOCARD_FORCE_PYTHON=1` 时走纯 Python；门控锚点需按 HEAD 行号重定位 |
| `_scan_python`（bleak 扫描，自包含） | 上游 `_scan_card` 已是 bleak | **核对后按需注入** | 若 HEAD 已自包含则跳过；否则注入我们的纯 Python 扫描 |
| `_pair_python`（async：检测窗口→连接→系统配对） | 上游 macOS 配对走 Swift `--pair` | **注入** | 由 `/tmp/eink-fixwork` 的 Fix B 重基；三个 pair 门控（`pair_session._run` / `_run_pair` / `_pair` 路由）改为 `await self._pair_python(...)` |
| localhost-bind（`server.py` `TCPSite` `0.0.0.0`→`HOST` 默认 `127.0.0.1`） | 仍 `0.0.0.0` | **注入** | 已获用户授权的安全改动；`HOST` env 由 `buildCoreEnv` 传播 |
| sender `find_device_by_address` 修复 | 上游已重写 sender，无此 bug | **丢弃** | 上游已修 |
| `_send_python` output 键修复 | 上游已修 | **丢弃** | 上游已修 |

`apply.py` 契约（**断言 + 幂等 + 编译校验**）：

1. **读 `extension.json`**：取 `targetCoreVersion` 与锚点清单；核对 `--core-version` 传入值 == `targetCoreVersion`，不符抛错。
2. **每处改动先断言锚点**：在目标文件里断言「上游原文锚点字符串存在且唯一」。锚点缺失/多处 → 抛 `AnchorError`（上游漂移守卫）。
3. **幂等**：若目标文件已含「注入后标记」（如 `# TODOOCARD-FORCE-PYTHON` 注释或已改好的绑定行），跳过该处，不重复注入。重复跑 `apply.py` 结果一致。
4. **文本替换注入**：用精确字符串替换（非行号、非 git-diff），把门控/函数/绑定改动写入。插入的函数（`_scan_python`/`_pair_python`）作为完整代码块注入到锚点位置。
5. **py_compile 校验**：对每个改过的 `.py` 跑 `py_compile.compile(..., doraise=True)`；编译失败抛错。
6. **退出码**：全成功（含幂等无操作）→ 0；任何断言/编译失败 → 非 0 + 清晰中文 stderr。

锚点清单（`extension.json`，按 v1.0.11 HEAD 定位；实现时以实际 HEAD 文本为准）：

- `card.py` `_send_blocking` 的 `if sys.platform != "darwin":` 分支（force-python 门控）。
- `card.py` `_build_payload` / `_scan` 的 macOS 分支锚点。
- `card.py` 三个 pair 门控（`pair_session._run`、`_run_pair`、`_pair` 路由）调用 Swift `--pair` 处。
- `card.py` 插入 `_pair_python` / `_scan_python` 的锚点（如 `_send_macos` 定义前）。
- `server.py` `web.TCPSite(runner, "0.0.0.0", PORT)`（localhost-bind）。

> 实现注：锚点的确切字符串在 writing-plans 阶段对照上游 v1.0.11 源码逐一固化进 `extension.json` 与 `apply.py`，并配 Python 测试（见 §10）。本 spec 锁定「锚点断言 + 幂等 + py_compile + 失败兜底」契约，不锁死行号（行号会漂移）。

## 7. 独立 dist 仓库 `Gt841/todoocard-core-dist`

**为什么独立**：用户明确要求「托管扩展+manifest 需要单独一个 github 项目，后续如果上游有更新，只动单独的项目即可」。独立后：上游更新 → 只在 dist 仓库重做扩展 + 更新 manifest + 发 Release/Pages；**插件仓库零改动**（插件只认 manifestUrl）。

仓库布局：

```
todoocard-core-dist/
├─ extension/
│  ├─ apply.py            文本补丁器（断言+幂等+py_compile）
│  ├─ extension.json      targetCoreVersion + 锚点清单
│  └─ tests/              补丁器 Python 测试（v1.0.11 fixture / 漂移 fixture / 幂等）
├─ manifest.json          v2 manifest（→ GitHub Pages）
├─ scripts/
│  ├─ build-extension.sh  把 extension/ 打成 extension-<ver>.zip + 算 sha256
│  ├─ build-manifest.sh   拉上游源码/便携 Python 算 sha256，生成 manifest.json
│  └─ verify.sh           本地端到端：下载→归一化→pip→apply.py→py_compile（不启 BLE）
├─ .github/workflows/     可选 CI：跑 extension/tests + verify
├─ docs/                  维护者工作流 / 上游更新手册
└─ README.md
```

托管方式（用户选定 **Pages(manifest) + Releases(扩展)**）：

| 资产 | 托管 | URL 形态 |
| --- | --- | --- |
| `manifest.json` | GitHub Pages | `https://gt841.github.io/todoocard-core-dist/manifest.json` |
| `extension-<ver>.zip` | GitHub Releases | `https://github.com/Gt841/todoocard-core-dist/releases/download/v<ver>/extension-<ver>.zip` |
| 源码 tarball | 上游 GitHub（引用，不托管） | `https://github.com/shidaifufen/todoocard-eink/archive/refs/tags/v<ver>.tar.gz` |
| 便携 Python | 上游 astral-sh（引用，不托管） | python-build-standalone release URL |

插件默认 `manifestUrl` 指向 dist 仓库 Pages；本地开发可 `file://` 指向本地 manifest（沿用 Phase 1）。

**上游更新工作流（只动 dist 仓库）**：

1. 上游发新 tag（如 v1.0.12）→ 维护者在 dist 仓库 `git fetch` 上游源码对照。
2. 重基 `apply.py` 锚点到新版（跑 `extension/tests` 的漂移 fixture 确认旧锚点失效、新锚点生效）。
3. `scripts/build-manifest.sh` 算新源码/Python sha256，更新 `manifest.json` 的 `coreVersion` + 三资产。
4. `scripts/build-extension.sh` 打 `extension-1.0.12.zip`，发 Release `v1.0.12`。
5. 推 `manifest.json` 到 Pages。
6. **插件仓库不动**；用户下次手动「安装/更新」即自动采用新核心 + 匹配扩展。

## 8. 插件仓库瘦身

| 现插件仓库内容 | 去向 |
| --- | --- |
| `fork-patch/force-python.patch`、`fork-patch/localhost-bind.patch` | **迁出**到 dist 仓库，由 `apply.py` 文本补丁器取代（raw git-diff 作废） |
| `scripts/dev-kit.sh`（克隆 fork→打补丁→zip→便携 Python→manifest） | **迁出/重写**为 dist 仓库 `scripts/`（build-extension/build-manifest/verify） |
| `docs/macos-pairing.md`、`docs/real-machine-validation.md` | 保留在插件仓库（用户文档）；dist 仓库另写维护者文档 |
| `src/`（installer/manifest/store/types/index/launcher/lifecycle/UI） | 保留，按 §4–§6/§9 改造 |
| 测试 fixture（vitest） | 保留在插件仓库；补丁器 Python fixture 放 dist 仓库 `extension/tests/` |

> 迁移在实现阶段执行；`fork-patch/force-python.patch` 当前是未提交工作树改动，**不提交旧式补丁**，其有用逻辑（`_pair_python`/force-python）带入 dist 仓库 `apply.py`。

## 9. core.json 迁移与版本判定

CoreJson v2（`types.ts`）：

```ts
export interface CoreJson {
  version: string;          // manifest.version（发布版，辅助）
  coreVersion: string;      // 新增：上游核心版本（版本判定主键）
  installedAt: number;
  source: { manifestUrl: string; sourceSha256: string; pythonSha256: string; extensionSha256: string };
  launchMode: LaunchMode | null;
  platform: string;
  arch: string;
}
```

PlatformEntry v2：`sourceUrl/sourceSha256/pythonUrl/pythonSha256/extensionUrl/extensionSha256/depsUrl?/depsSha256?`（取代旧 `einkUrl/einkSha256`）。
Manifest v2：`{ version: string; coreVersion: string; platforms: Record<string, PlatformEntry> }`。

迁移与判定：

| 场景 | 处理 |
| --- | --- |
| 旧 core.json（无 `coreVersion`，`source.einkSha256`） | `detect()` 不变（python + server.py 存在 → `installed`）；版本判定在 `doInstall` 处理：缺 `coreVersion` 视为 `0.0.0` → 必更新。安装成功后写 v2（含 coreVersion）。 |
| 版本判定 | `index.ts doInstall`：`compareVersion(cur.coreVersion ?? "0.0.0", m.coreVersion) >= 0` → 「已是最新」；否则安装。旧 core.json 缺 coreVersion → `0.0.0` → 必更新。 |
| `parseManifest` v2 校验 | 需 `version` + `coreVersion` + `platforms`；`selectPlatform` 需 `sourceUrl`+`pythonUrl`+`extensionUrl`。缺字段抛清晰错误。 |
| `store.detect()` | 仍查 python 可执行 + `eink/server.py` 存在 → `installed`；core.json 缺失或文件缺失 → `not-installed`。**不**因缺 coreVersion 判 not-installed（迁移交给 doInstall 版本判定）。 |

## 10. 测试策略

| 层 | 工具 | 覆盖 |
| --- | --- | --- |
| schema/解析 | vitest | v2 manifest 解析（缺 coreVersion/字段抛错）、平台选择、`compareVersion` |
| 归一化 | vitest | `normalizeSourceDir`（剥 tag 顶层、tag 名核对、缺 server.py 抛错）、`normalizePythonDir`（剥 python/ 或原样、幂等） |
| 安装器 | vitest（mock download/spawn/fs） | 三下载 sha 校验、归一化、pip、跑 apply.py、原子替换、失败中止旧核心完好、core.json v2 写入 |
| 迁移 | vitest | 旧 core.json（无 coreVersion）→ 触发重装；版本判定用 coreVersion |
| 补丁器 | **Python 测试**（dist 仓库 `extension/tests/`） | ① v1.0.11 fixture → apply.py 后断言门控/绑定/`_pair_python` 存在 + py_compile 通过；② 漂移 fixture（锚点改/删）→ apply.py 抛错非 0；③ 幂等（跑两次结果一致）；④ coreVersion 不符 → 抛错 |
| 端到端（无 BLE） | dist 仓库 `scripts/verify.sh` | 下载→归一化→pip→apply.py→py_compile 全链路（不启蓝牙） |
| 真机 | 用户手动（Task 12） | ①→②→④ 级联 + 纯 Python 发送/配对（需用户点「允许」） |

TDD：每个 vitest/Python 测试先红后绿。补丁器测试用**真实上游 v1.0.11 源码 fixture**（松散 `.py`），不 mock 被测文本逻辑。

## 11. 锁定的设计决策

| # | 决策 | 选定 | 理由 |
| --- | --- | --- | --- |
| 1 | 分发模型 | **A：上游源码自动采用 + 版本匹配扩展**（便携 Python 取 astral-sh） | 自动采用上游、我们只托管薄扩展；上游已修我们的 bug。eink 用**源码 tarball**（冻结便携包不可打补丁） |
| 2 | 版本/资产驱动 | **Manifest 驱动** | 一处钉版本+三资产，插件只认 manifestUrl |
| 3 | 便携 Python 来源 | **自动取 python-build-standalone** | 官方 relocatable，免自维护 |
| 4 | 扩展形态 | **Python 文本补丁器** | 锚点断言+幂等+py_compile，比 git-diff 抗漂移、可失败兜底 |
| 5 | 更新触发 | **手动触发** | 控制台按钮，自动选最新兼容版；不做后台轮询 |
| 6 | 托管 | **Pages(manifest)+Releases(扩展)** | 免服务器；源码/Python 引用上游不托管 |
| 7 | 仓库划分 | **独立 `Gt841/todoocard-core-dist`** | 上游更新只动 dist 仓库，插件仓库零改动（用户明确要求） |

## 12. 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| 上游漂移导致锚点失效 | apply.py 锚点断言失败 → 非 0 中止，旧核心完好，控制台提示「上游版本可能已漂移」；维护者重基扩展 |
| 上游源码 tarball 布局变化 | 归一化「剥一层 or 原样」幂等 + tag 名核对 + 缺 server.py 抛错 |
| 便携 Python 布局变化 | `normalizePythonDir` 兼容 python/ 顶层或扁平 |
| 下载/sha 不符 | 逐个 sha256 校验，不符即中止（沿用 Phase 1） |
| pip/补丁失败 | 非 0 即中止，原子替换前失败 → 旧核心不动 |
| 无网/弱网 | 可选 `depsUrl` 离线依赖兜底（沿用 Phase 1 可选语义） |
| 旧 core.json 不兼容 | 缺 coreVersion → 触发重装，安装后写 v2 |
| 无授权 Swift 依赖 | force-python + `_pair_python` 纯 Python + 系统配对，不依赖 `Sunbelife/TodooCard_Skills` |

## 13. 维护者工作流（速查）

- **首次建 dist 仓库**：建 `Gt841/todoocard-core-dist` → 写 `extension/apply.py`（重基 v1.0.11）+ `extension.json` + tests → `scripts/build-extension.sh` 打 zip 发 Release `v1.0.11` → `scripts/build-manifest.sh` 生成 manifest → 推 Pages → 插件默认 manifestUrl 指向它。
- **上游更新**：见 §7 工作流（只动 dist 仓库）。
- **本地验证**：dist 仓库 `scripts/verify.sh`（无 BLE 全链路）；插件 vitest；真机走 Task 12 清单（用户点「允许」）。
- **插件发版**：插件仓库改动（installer/manifest/store/types/index）走正常 build/Release/集市 PR（需用户授权）。