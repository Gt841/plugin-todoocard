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
单元测试（57/57）已覆盖逻辑，但 **BLE 扫描/发送是 spec §13 标注的「待验证风险」**——纯 Python
路径结构上已自包含，真机能否成功传图必须实测。发版（步骤 8）请在验证通过后再做。

> 平台：默认 macOS arm64（Apple Silicon）。Windows/Linux 见步骤 7。
> 所有 `/tmp/todoocard-dev` 路径均为 `scripts/dev-kit.sh` 的默认输出目录，可用环境变量覆盖。

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

### 0.2 生成本地 dev 核心包

```bash
bash scripts/dev-kit.sh
# 复用已有 eink 克隆（可选，免联网克隆）：
# EINK_SRC=/tmp/todoocard-research/eink bash scripts/dev-kit.sh
```

产物在 `/tmp/todoocard-dev/`：
- `eink-patched.zip` —— 应用了 `force-python.patch` + `localhost-bind.patch` 的 eink fork（文件在压缩包根）。
- `python-darwin-arm64.tar.gz` —— 可重定位便携 Python 3.11（已重打包为扁平结构，解压即 `bin/python3`）。
- `manifest.json` —— 指向上面两个包，**资产走本地 HTTP**（安装器的下载用 Node http/https，不支持 `file://`）。

脚本已自动校验：两包 sha256 写入 manifest；便携 Python 解压后 `bin/python3 --version` 可运行。

### 0.3 起本地 HTTP 服务并保持运行

```bash
cd /tmp/todoocard-dev && python3 -m http.server 8000
```

**验证期间这个终端要一直开着**（安装器从 `http://127.0.0.1:8000/` 下载核心包）。

### 0.4 在插件设置里填 Manifest URL

思源「设置 → 集市 → 已下载 → plugin-todoocard → 设置」，**Manifest URL** 填：

```
file:///tmp/todoocard-dev/manifest.json
```

（manifest 本身可走 `file://`；也可填 `http://127.0.0.1:8000/manifest.json`。）保存。

---

## 1. 安装核心（控制台 → 安装/更新）

**操作**：控制台点「安装/更新」。
**预期**：日志依次出现 `拉取 manifest… → 下载便携 Python… → 下载核心源码… → 解压 Python… → 解压核心… → 安装依赖… → 原子替换核心目录… → 安装完成`；状态变「已安装」；核心目录写入 `core.json`。
**核心目录**：默认 `<思源dataDir>/todoocard-core`，控制台可见/可改。
**失败排查**：
- `下载…` 卡住/报错 → 确认 0.3 的 http.server 在跑、端口 8000 未被占。
- `python sha256 mismatch` / `eink sha256 mismatch` → 重新跑 `dev-kit.sh`（包与 manifest 必须同批生成）。
- `pip install failed` → 需要联网访问 PyPI；看日志末尾 stderr。bleak 会拉 pyobjc（macOS 后端），属正常。
- `解压失败 (… exit …)` → 看日志里的命令与 stderr。

## 2. 默认 auto 启动（① 预检）

**操作**：启动方式保持「自动 ①→②→④」，点「启动」。
**预期**：日志 `启动中（含 BLE 预检，若弹蓝牙授权请点允许）…` → BLE 预检①通过 → 核心起于 :8199 → 状态「运行中（direct）」，日志显示 `已启动，模式=direct PID=…`。
**若弹蓝牙授权**：点「允许」（这是 macOS TCC，① 直接模式由思源负责进程持有授权）。
**验证只绑本机**（localhost-bind 补丁生效）：

```bash
lsof -nP -iTCP:8199 -sTCP:LISTEN
# 预期 NAME 列是 127.0.0.1:8199（不是 *:8199）
```

**失败排查**：① 预检失败会自动降 ②（disclaim）再降 ④（Terminal）；日志会显示最终模式。若三种都失败，看日志 bleak 错误（卡片需唤醒/已系统配对，见步骤 3）。

## 3. 打开传图界面 + 系统配对 + 扫描 + 发送（核心风险点）

**操作**：
1. 控制台点「打开传图界面」→ 思源页签内嵌 `http://127.0.0.1:8199` 的核心 Web UI。
2. 按 [docs/macos-pairing.md](macos-pairing.md)：先在**系统设置 → 蓝牙**里配对 TodooCard。纯 Python 模式下 Web UI「开始配对」不编译 Swift，只显示系统配对引导（修复前会报 `build_sender.sh` exit 127）；配对以系统设置为准。
3. **唤醒卡片**（上电/长按按键——卡片平时不广播，扫描前必须唤醒）。
4. Web UI 点「扫描附近设备」→ 列表出现 TodooCard → 点「用这台」绑定。
5. 选一张测试图 → 发送。

**预期**：扫描列出设备（纯 Python bleak 路径，`TODOOCARD_FORCE_PYTHON=1`）；绑定成功；**传图成功**，卡片刷新显示测试图。
**这是 spec §13 的待验证风险**：若扫描/连接/发送失败，**记录完整 bleak 错误**（控制台日志 + 核心日志 `<核心目录>/run/core.log`），据此修复 fork 补丁或发送逻辑。常见原因：
- 扫描空列表 → 卡片没唤醒 / 没系统配对 / 蓝牙授权没点允许。
- `编译发送工具失败` → fork 没带 `force-python.patch`（不应发生，dev-kit 已应用）；确认 `TODOOCARD_FORCE_PYTHON=1` 在核心环境里。
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
**已知限制**：Win/Linux 的 Web UI「扫描附近设备」依赖 macOS Swift 工具，**不可用**；但**发送仍可用**——`sender.py` 未绑定设备时按名字自动发现卡片。dev-kit 默认只产 macOS arm64 包；其他平台需按 README「维护者托管」准备对应便携 Python（Win 用 `.zip`）+ eink 包并改 manifest 平台键（`windows-x64`/`linux-x64`，Windows 键用 `windows`）。

---

## 8. 发版准备（验证通过后再做，需维护者授权）

1. **bump 版本**：改 `plugin.json` 的 `version`（当前 `0.0.1`）。
2. **写 `CHANGELOG.md`**：记录 Phase 1 功能与已知限制。
3. **补 `autoTag.js`**：`package.json` 的 `npm run tag` 引用了 `./autoTag.js`，**当前仓库还没有这个文件**——按维护者其他插件（博思白板/PPTGo/墨刀）的 autoTag.js 模板补上，再打 tag/Release。
4. **构建产物**：`npm run build` 生成 `package.zip`。
5. **核心资产托管**：**已完成**（2026-11-12）——`Gt841/todoocard-core-dist` 的 Release `v1.0.11`（`extension-1.0.11.zip`）与 Pages（v2 `manifest.json`）；上游源码 tarball 按 commit sha 钉死、便携 Python 引用 astral-sh 官方包，均不由我们托管。上游发新版时只改 dist 仓库并 push manifest，插件仓库不动。
6. **发布**：打 tag / GitHub Release / 思源集市 PR（**工作树外副作用，需你确认后执行**）。当前插件仓库**没有 git remote**，且 `Gt841/plugin-todoocard` 尚未创建，推送前需先建远端。

> 安全默认：核心 Web UI 无鉴权，fork 已默认只绑 `127.0.0.1`。要局域网/手机访问设 `HOST=0.0.0.0`（见 README「安全」），仅在可信网络下使用。

---

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