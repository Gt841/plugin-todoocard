# 真机端到端验证清单（Phase 1）

> **2026-11-12 更新**：分发模型已改为 v2（上游源码 tarball + 版本匹配扩展包）。
> 本清单的**步骤 0–1（dev-kit 打补丁、本地 http 服务、旧版 manifest）已作废**，
> 资产准备改走 `../todoocard-core-dist/scripts/{build-extension,build-manifest,verify}.sh`，
> manifest 用 v2（`coreVersion` / `coreCommit` / 三资产）。
> **步骤 2–7 的真机 BLE / 启动级联 / 退出清理检查仍然适用**，只是安装来源换成正式 manifest。
> **dist 侧发布已于 2026-11-12 完成**（`Gt841/todoocard-core-dist` 仓库 / Release `v1.0.11` / Pages manifest），
> 插件默认 `manifestUrl` 已指向 `https://gt841.github.io/todoocard-core-dist/manifest.json`。
> 尚未完成：真机 BLE 验证、插件发版 / 思源集市 PR（仍需维护者授权）。

本清单对应实现计划 Task 12 的步骤 1–7，供维护者在**真实硬件 + 真实思源**上验证插件。
单元测试（插件 vitest 80/80 + dist 补丁器 7/7）已覆盖逻辑，但 **BLE 扫描/发送是 spec §12 标注的「待验证风险」**——纯 Python
路径结构上已自包含，真机能否成功传图必须实测。发版（步骤 8）请在验证通过后再做。

> 平台：默认 macOS arm64（Apple Silicon）。**当前 manifest 仅发布 `darwin-arm64`**；Windows/Linux 见步骤 7（需维护者先托管对应资产）。
> v2 安装直接从上游 GitHub / astral-sh / dist Releases 下载，**无需本地 dev-kit 或 http 服务**。

---

## 0. 准备

### 0.1 构建并安装插件到思源

```bash
cd /Users/guantao/workSpace/siyuan/plugin-todoocard
npm install
npm run build          # 生成 dist/ 与 package.zip
```

二选一安装：
- **开发软链**：`npm run make-link`（把 dist 软链到思源插件目录），然后在思源「设置 → 集市 → 已下载」启用 `plugin-todoocard`。
- **手动安装**：把 `package.zip` 拖入思源「集市 → 已下载 → 手动安装」，启用。

启用后顶栏右侧出现「土豆片」图标，点击打开控制台。

### 0.2 确认 Manifest URL（默认已指向正式 dist）

v2 无需本地打包：插件默认 `manifestUrl` 已是
`https://gt841.github.io/todoocard-core-dist/manifest.json`（dist 仓库 Pages，已发布）。
思源「设置 → 集市 → 已下载 → plugin-todoocard → 设置」里确认 **Manifest URL** 为该地址即可，保存。

安装时插件按 manifest 自动下载三资产（均不由我们托管本体）：
- **上游核心源码** tarball（GitHub archive，按 commit sha 钉死）；
- **便携 Python**（astral-sh python-build-standalone `install_only`）；
- **版本匹配扩展包** `extension-1.0.11.zip`（dist Releases，含 `apply.py`）。

> 可选（仅维护者本地调试）：若要测未发布的 manifest，可把它放本地并在设置里填 `file:///…/manifest.json`；
> 但 manifest 引用的**资产 URL 仍须是 http(s)**（安装器下载用 Node http/https，不支持 `file://` 资产）。
> 资产准备/校验走 `../todoocard-core-dist/scripts/{build-extension,build-manifest,verify}.sh`，不再用已作废的 `scripts/dev-kit.sh`。

---

## 1. 安装核心（控制台 → 安装/更新）

**操作**：控制台点「安装/更新」。
**预期**：日志依次出现 `下载上游核心源码… → 下载便携 Python… → 下载版本匹配扩展包… → 解压 + 归一化布局… → 安装依赖… → 应用版本匹配扩展… → 原子替换核心目录… → 安装完成`；状态变「已安装」；核心目录写入 `core.json`（含 `coreVersion` + `coreCommit`）。
**核心目录**：默认 `<思源dataDir>/todoocard-core`，控制台可见/可改。
**失败排查**：
- `下载…` 卡住/报错 → 确认能访问 GitHub / astral-sh（需联网）；公司代理/弱网可能导致超时。
- `source/python/extension sha256 mismatch` → manifest 与资产不同批；维护者重跑 dist `build-manifest.sh` + `build-extension.sh` 并重新发布。
- `源码顶层目录名与 coreCommit 不符` → 上游 tarball 布局/commit 漂移；核对 manifest `coreCommit` 与上游一致。
- `扩展补丁失败（上游版本可能已漂移）` → `apply.py` 锚点断言/版本核对失败；看日志末尾 stderr，维护者重基扩展包。
- `pip install failed` → 需要联网访问 PyPI；看日志末尾 stderr。bleak 会拉 pyobjc（macOS 后端），属正常。
- `解压失败 (… exit …)` → 看日志里的命令与 stderr。

## 2. 默认 auto 启动（① 预检）

**操作**：启动方式保持「自动 ①→②→④」，点「启动」。
**预期**：日志 `启动中（含 BLE 预检，若弹蓝牙授权请点允许）…` → BLE 预检①通过 → 核心起于 :8199 → 状态「运行中（direct）」，日志显示 `已启动，模式=direct PID=…`。
**若弹蓝牙授权**：点「允许」（这是 macOS TCC，① 直接模式由思源负责进程持有授权）。
**验证只绑本机**（localhost-bind 扩展生效）：

```bash
lsof -nP -iTCP:8199 -sTCP:LISTEN
# 预期 NAME 列是 127.0.0.1:8199（不是 *:8199）
```

**失败排查**：① 预检失败会自动降 ②（disclaim）再降 ④（Terminal）；日志会显示最终模式。若三种都失败，看日志 bleak 错误（卡片需唤醒/已系统配对，见步骤 3）。

## 3. 打开传图界面 + 系统配对 + 扫描 + 发送（核心风险点）

**操作**：
1. 控制台点「打开传图界面」→ 思源页签内嵌 `http://127.0.0.1:8199` 的核心 Web UI。
2. **配对**（v2 纯 Python 路径）：**长按卡片按钮约 5 秒进入配对窗口** → Web UI 点「开始配对」。扩展注入的 `_pair_python` 会用 bleak 检测配对窗口（`_scan_card`）→ 连接卡片（复用上游 `_pair_bleak`）→ 触发 **macOS 系统配对/bonding**（系统弹确认时点「配对」）。不再编译 Swift（修复前会报 `build_sender.sh` exit 127）。若 bleak 配对不顺，可按 [docs/macos-pairing.md](macos-pairing.md) 先在**系统设置 → 蓝牙**里手动配对作为兜底。
3. **唤醒卡片**（上电/长按按键——卡片平时不广播，扫描前必须唤醒）。
4. Web UI 点「扫描附近设备」→ 列表出现 TodooCard → 点「用这台」绑定。
5. 选一张测试图 → 发送。

**预期**：扫描列出设备（纯 Python bleak 路径，`TODOOCARD_FORCE_PYTHON=1`）；配对/绑定成功；**传图成功**，卡片刷新显示测试图。
**这是 spec §12 的待验证风险**：若扫描/连接/发送失败，**记录完整 bleak 错误**（控制台日志 + 核心日志 `<核心目录>/run/core.log`），据此修复 dist 扩展包或发送逻辑。常见原因：
- 扫描空列表 → 卡片没唤醒 / 没系统配对 / 蓝牙授权没点允许。
- `编译发送工具失败` → 扩展没生效（不应发生，`apply.py` 已注入 force-python 门控）；确认 `TODOOCARD_FORCE_PYTHON=1` 在核心环境里、`core.json.coreCommit` 与 manifest 一致。
- 配对失败 → 卡片没进配对窗口（长按不够久）/ 已被系统其他设备占用；看 `_pair_python` 的 `[ble]` 日志行。
- 连接超时 → 卡片离得太远 / 已被其他设备占用 / 电量低。

## 4. 强制 ② disclaim 与 ④ Terminal

**操作 A（②）**：启动方式选「仅 ② disclaim」→ 点「重新检测」（清模式缓存）→「启动」。
**预期**：核心运行（disclaim 模式，子进程脱离思源的 TCC 责任归属），状态「运行中（disclaim）」，可传图。
**操作 B（④）**：启动方式选「仅 ④ Terminal」→「重新检测」→「启动」。
**预期**：弹出 Terminal 窗口跑核心，状态「运行中（terminal）」，可传图。
**说明**：②④ 仅 macOS 可选（Windows/Linux 只有 ①）。每次切换模式后先「重新检测」再「启动」。

## 5. 退出清理 + 残留检测

**操作 A（退出同步关核心）**：核心运行中直接退出思源。
**预期**：核心进程被关：

```bash
ps aux | grep '[s]erver.py'    # 预期无输出（核心已关）
```

**操作 B（残留检测）**：手动起一个核心（或模拟残留 pid 文件）后重启思源。
**预期**：加载时提示「检测到残留土豆片核心进程 (PID …)，可在控制台停止或接管」；控制台点「停止」可关掉。
**说明**：退出钩子有两条——IPC `siyuan-save-close`（主）与 `beforeunload`（兜底），均为动态命名处理器，改核心目录后仍指向当前核心。

## 6. 更改核心目录（顺带验证）

**操作**：控制台「核心目录 → 更改」选一个新目录。
**预期**：若运行中先自动停止核心，再切换目录并重建；新目录下可重新「安装/更新」。退出钩子仍生效（动态处理器）。

## 7. Windows / Linux 冒烟（如有机器）

**操作**：在 Windows/Linux 上装插件 + 核心（auto=direct），安装 → 启动 → 开 Web UI → 传图。
**预期**：安装走 `Expand-Archive`（Win zip）/`tar`（其余）；`pythonExe` 用 `python/python.exe`（Win）或 `python/bin/python3`（Linux）；启动/停止/退出清理正常。
**已知限制**：Win/Linux 的 Web UI「扫描附近设备」依赖 macOS Swift 工具，**不可用**；但**发送仍可用**——`sender.py` 未绑定设备时按名字自动发现卡片。**当前 manifest 仅发布 `darwin-arm64`**（dev-kit 已作废）；其他平台需维护者在 dist 仓库托管对应便携 Python（Win 用 `.zip`）+ 版本匹配扩展资产，并补 manifest 平台键（`windows-x64`/`linux-x64`，Windows 键用 `windows`）。资产准备/校验走 `../todoocard-core-dist/scripts/{build-extension,build-manifest,verify}.sh`。

---

## 8. 发版准备（验证通过后再做，需维护者授权）

1. **bump 版本**：改 `plugin.json` 的 `version`（当前 `0.0.1`）。
2. **写 `CHANGELOG.md`**：记录 Phase 1 功能与已知限制。
3. **补 `autoTag.js`**：`package.json` 的 `npm run tag` 引用了 `./autoTag.js`，**当前仓库还没有这个文件**——按维护者其他插件（博思白板/PPTGo/墨刀）的 autoTag.js 模板补上，再打 tag/Release。
4. **构建产物**：`npm run build` 生成 `package.zip`。
5. **核心资产托管**：**已完成**（2026-11-12）——`Gt841/todoocard-core-dist` 的 Release `v1.0.11`（`extension-1.0.11.zip`）与 Pages（v2 `manifest.json`）；上游源码 tarball 按 commit sha 钉死、便携 Python 引用 astral-sh 官方包，均不由我们托管。上游发新版时只改 dist 仓库并 push manifest，插件仓库不动。
6. **发布**：打 tag / GitHub Release / 思源集市 PR（**工作树外副作用，需你确认后执行**）。当前插件仓库**没有 git remote**，且 `Gt841/plugin-todoocard` 尚未创建，推送前需先建远端。

> 安全默认：核心 Web UI 无鉴权，扩展已默认只绑 `127.0.0.1`。要局域网/手机访问设 `HOST=0.0.0.0`（见 README「安全」），仅在可信网络下使用。

---

## 2026-11-12 首次真机故障记录

| 项 | 内容 |
| --- | --- |
| 现象 | 点「发送」后无任何反应，卡片不刷新；再点也没反应 |
| 环境 | SiYuan 3.8.10 macOS arm64；插件 v2 构建（`index.js` 与仓库 `dist/index.js` sha 一致）；核心 `core.json` 为 v2、`launchMode: direct`、监听 `127.0.0.1:8199` |
| 日志 | `~/Library/Application Support/SiYuan/todoocard-core/run/core.log`：18:38:15 `POST /api/card/send 200` → 18:38:24 `[sender] 请求 block size` 后**再无任何日志**；`/api/card` 的 `busy` 持续为 true，后续 send 全 409 |
| 根因 | `sender.py` 的 `write_gatt_char(control, 0x01, response=True)` 无超时；macOS CoreBluetooth 在设备不回 ATT Write Response 时 future 永久挂起 → `card.py:send()` 的 `finally: self._busy = False` 不执行 → busy 锁死。系统蓝牙显示卡片仍 Connected 但无控制点通知 |
| 触发条件 | 插件 `launcher.ts` 在 darwin 强制 `TODOOCARD_FORCE_PYTHON=1`，macOS 走了原本面向 Win/Linux 的 bleak 纯 Python 发送路径（正是 spec §13 标注的待验证风险） |
| 修复 | dist 的 `extension/hotfixes/v1.0.11.json`（6 条，仅 1.0.11 + 指定 commit 生效）：所有 BLE await 套 `asyncio.wait_for(..., WRITE_TIMEOUT=8s)`；顺带修 `R.FS["title"]` 导致的 preview 500 |
| 恢复 | 停掉挂死的核心进程 → 在插件控制台点**「强制重装」**（会自动停核心、下载、打补丁、原子替换、重启） |
| 仍待验证 | 卡片实际能否刷出图像、显影确认 0x05/0x08；下次发送前长按卡片背面按钮 5 秒进入接收窗口 |

> 附带发现：18:26–18:28 曾多次重复启动导致 `Errno 48 address already in use`；`card_render.FS` 是 float 但 `card.py` 当字典用，照片文件夹为空时 `/api/card/preview?kind=photo` 报 500（已随 hotfix 修复）。

## 验证结果记录（实测时填写）

| 步骤 | 结果（通过/失败） | 备注 / bleak 错误 |
|------|------------------|-------------------|
| 1 安装 | | |
| 2 auto① 启动 | | |
| 3 扫描+传图 | | |
| 4 ② disclaim | | |
| 4 ④ Terminal | | |
| 5 退出清理 | | |
| 5 残留检测 | | |
| 6 改目录 | | |
| 7 Win/Linux | | |