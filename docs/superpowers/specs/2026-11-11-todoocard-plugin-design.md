# plugin-todoocard · Phase 1 设计文档

- 日期：2026-11-11
- 作者：Gt841（维护者）＋ Qoder
- 状态：已批准设计，待写实现计划
- 项目路径：`/Users/guantao/workSpace/siyuan/plugin-todoocard`
- 模板：复用 `plugin-pptgo`（Svelte + TypeScript + Vite，`siyuan` 0.9.2 API，`siyuan-kit-svelte`，`scripts/make_dev_link.js`，`vite-plugin-zip-pack`）

## 1. 背景与目标

土豆片（TodooCard）是一块 528×792 六色墨水屏卡片，通过 BLE 传图。上游有两个仓库：

- `todoocard-eink`：本地核心，aiohttp Web 服务（默认端口 **8199**），自带完整传图 Web UI（模板/扫描/配对/发送/预览等路由），发送底层用 bleak。
- `todoocard-web`：纯 JS 传图管线参考（六色抖动→4bit 打包→面板校准→QuickLZ L3 压缩）。

目标：做一个思源笔记桌面插件，把 eink 核心作为「本地子进程」管理起来，并在思源里承载核心的传图 Web UI。整体核心管理思路参考 `OpenClash`（检测核心→下载安装→启停→看门狗）。

### Phase 1 范围（本 spec）

1. 核心存储与检测（路径可自定义）。
2. 首次运行联网下载并安装核心（便携 Python + eink fork + 依赖），原子安装 + 校验。
3. **①→②→④ 级联启动**，默认 ①，②④ 兜底；三种调用方式可在设置里强制选择。
4. 启动/停止控制；**退出思源时同步关闭核心**；残留检测。
5. 控制台 UI（状态/安装/启停/模式/路径/日志）＋ 自定义页签内嵌核心 Web UI（:8199）。
6. macOS 走核心的**纯 Python 发送路径**（fork + env 开关），避开无授权 Swift 依赖。

### 非目标（Phase 2 及以后）

- 思源侧深度集成：从笔记拉取待办/模板数据推给卡片、笔记内嵌卡片预览等。
- 在插件里重写传图管线（核心已自带）。
- 移动端/后端（本插件仅桌面端）。

## 2. 关键事实与已验证结论

- 思源桌面插件运行于 Electron renderer，`nodeIntegration:true`、`contextIsolation:false`，插件经 `require("siyuan")` 拿到 `{Plugin, Dialog, …}`，经 `window.require` 拿到完整 Node（`child_process`/`fs`/`path`/`electron.ipcRenderer`）。→ 子进程管理可行。
- 思源桌面 **Web Bluetooth 不可用**（无 `select-bluetooth-device` 处理器），所以传图必须走本地核心进程，而非插件内 Web BLE。
- 思源协作退出：主进程 `before-quit` → IPC 频道 **`siyuan-save-close`** → 前端保存 → 退出（15s 超时恢复）。插件可钩该 IPC 信号关核心。
- **TCC 级联已在真实 SiYuan 宿主实测**（macOS 27.2.1，安装版 SiYuan 3.8.10）：

  | 路径 | responsible | is_self | 授权 | 扫描 |
  | --- | --- | --- | --- | --- |
  | ① direct | SiYuan | false | notDetermined | ✅ 31 设备 |
  | ② ctypes disclaim | python 自身 | **true** | allowedAlways | ✅ 31 设备 |
  | ④ Terminal | Terminal.app | false | allowedAlways | ✅ 29 设备 |

- 核心 `_send_python` / `_build_payload_python` **完全自包含**（仅 `payload.py`/`quicklz_payload.py`/`sender.py`，bleak），产物与 Swift 工具**逐字节 md5 对齐**。macOS 被 `sys.platform != "darwin"` 分支强制走 Swift（依赖无授权 `skill_dir = ../todoocard/scripts`）。
- eink 上游 Release 仅源码 ZIP（无二进制）；macOS Swift 发送/配对依赖 `Sunbelife/TodooCard_Skills`，**无授权、不可再分发**。

## 3. 总体架构

插件 = 核心管理器（OpenClash 式）＋ 核心 Web UI 承载壳。

```
思源插件 (Svelte+TS)
├─ CoreStore      核心目录/版本检测（路径可自定义）
├─ CoreInstaller  首次联网下载：便携Python + eink fork + 依赖（原子安装+sha256校验+锁）
├─ CoreLauncher   ①→②→④ 级联启动（默认①）+ BLE 预检 + PID 跟踪 + 模式缓存
├─ CoreLifecycle  启停 / 退出思源同步关核心 / 残留检测
└─ UI             顶栏按钮→控制台 Dialog；自定义页签内嵌 :8199 Web UI；状态栏图标(可选)
        │ child_process / fs / electron.ipcRenderer
        ▼
本地 eink 核心 (便携Python server.py, aiohttp :8199, 纯Python发送)
        ▼ BLE (bleak)
     土豆片设备
```

平台策略：Windows/Linux 无 TCC，① 直接通；macOS 才需要 ②④ 兜底。

### 模块边界

每个模块单一职责、可独立测试：

- `CoreStore`：纯文件/配置读写，无网络无进程。输入核心目录，输出安装状态。
- `CoreInstaller`：网络下载 + 解压 + pip + 原子替换。依赖 `CoreStore` 写状态。
- `CoreLauncher`：进程 spawn + BLE 预检 + 模式选择。依赖 `CoreStore` 读路径/缓存。
- `CoreLifecycle`：启停编排 + 退出钩子 + 残留检测。组合 `CoreLauncher`/`CoreStore`。
- `UI`：Svelte 组件，调用上述模块，不直接碰进程/网络细节。

## 4. 核心存储与检测（CoreStore）

- 核心目录可自定义。默认 `<思源dataDir>/todoocard-core`（macOS 即 `~/Library/Application Support/SiYuan/todoocard-core`）。`dataDir` 取自 `window.siyuan.config.system.dataDir`。
- 目录结构：

  ```
  todoocard-core/
  ├─ python/        便携解释器（python-build-standalone / Windows embeddable）
  ├─ eink/          核心源码（fork）
  ├─ deps/          依赖（wheels 或 site-packages）
  ├─ core.json      已装版本/来源/sha256/启动模式缓存
  └─ run/
     ├─ core.pid    运行中核心 PID
     └─ core.log    核心 stdout/stderr 日志
  ```

- 检测逻辑：读 `core.json` ＋ 校验 `python` 可执行 ＋ `eink/server.py` 存在 → 状态 `not-installed | installed | update-available`。
- `core.json` schema：

  ```json
  {
    "version": "1.0.3",
    "installedAt": 1794377260,
    "source": { "manifestUrl": "...", "pythonSha256": "...", "einkSha256": "..." },
    "launchMode": "direct",
    "platform": "darwin",
    "arch": "arm64"
  }
  ```

  `launchMode` 缓存预检选中的模式（`direct|disclaim|terminal`），后续启动跳过预检。

## 5. 下载与安装（CoreInstaller，OpenClash 模型）

### manifest（维护者托管）

GitHub Release 上一个 JSON，按 OS/架构列出下载项。schema：

```json
{
  "version": "1.0.3",
  "platforms": {
    "darwin-arm64": {
      "pythonUrl": "https://.../python-3.11-arm64.tar.gz",
      "pythonSha256": "...",
      "einkUrl": "https://.../eink-fork-1.0.3.zip",
      "einkSha256": "...",
      "depsUrl": "https://.../wheels-darwin-arm64.zip",
      "depsSha256": "..."
    },
    "darwin-x64": { "...": "..." },
    "windows-x64": { "...": "..." },
    "linux-x64": { "...": "..." }
  }
}
```

- 插件经思源 `forwardProxy`（绕 CORS）或 Node `https` 拉取 manifest。
- `depsUrl` 可选：提供 wheels 包做离线安装；缺省时回退在线 `pip install -r requirements.txt`（aiohttp/bleak/Pillow/qrcode）。

### 安装流程

1. 拉 manifest，比对 `core.json.version`。
2. 下载到临时文件（`run/tmp/`）。
3. **sha256 校验**，不符则丢弃重试。
4. 解压便携 Python 到临时目录；解压 eink fork；准备 deps。
5. 用便携 Python `pip install` 依赖（优先本地 wheels，回退在线）。
6. **原子替换**入核心目录（先写临时目录再 rename），写 `core.json`。
7. 加锁（lock 文件）防并发安装。

- 失败可重试；manifest/下载 URL 支持镜像/CDN 配置（参考 OpenClash GitHub 代理选项）。
- 本地开发期：manifest 可指向本地 `file://` 或 `/tmp/todoocard-research` 克隆，先跑通流程。

### 维护者前置动作（实现前需就绪）

- 建 eink **fork**（见 §8），打 Release。
- 准备各平台便携 Python 包并计算 sha256。
- 托管 manifest JSON。

## 6. ①→②→④ 级联启动（CoreLauncher）

### 三种调用方式

| 模式 | 机制 | 进程归属 | 适用 |
| --- | --- | --- | --- |
| ① `direct`（默认） | 插件直接 spawn `python server.py` | 继承思源 TCC | 宿主带蓝牙声明时最省事 |
| ② `disclaim` | 经 disclaim 助手 spawn，核心 `is_self=true` | 核心自身身份 | macOS 通用兜底（私有 API） |
| ④ `terminal` | `open -a Terminal` 跑 `.command` | Terminal 承担 | 最稳兜底（公开 API，有可见窗口） |

- 设置项「启动方式」：`auto`（①→②→④，默认）/ `direct` / `disclaim` / `terminal`。
- `auto`：从 ① 起，预检失败逐级降级；强制模式则只用该模式（失败直接报错，不降级）。

### 降级触发：BLE 预检（关键）

TCC 崩溃发生在**首次 BLE 访问**而非服务启动——只查 :8199 健康会误判 ① 可用。因此：

1. 「启动」时，先在候选模式跑一个**短 BLE 扫描探针**（`probe.py`，扫描 ~6s）。
2. 探针成功（扫描完成）→ 用该模式起核心。
3. 探针崩溃（SIGABRT / exit 134）或授权拒绝 → 降下一级（仅 `auto`）。
4. 选中的模式写入 `core.json.launchMode` 缓存；后续启动跳过预检直接起核心。
5. 控制台提供「重新检测」按钮清缓存重跑预检。

- 探针由插件内置（`probe.py`），用核心便携 Python 运行；不依赖 fork 是否包含探针。
- 预检判定口径：`result.ok === true`（扫描完成）为成功；记录 `authorization/devices_count/is_self/responsible/退出码`。

### 各模式启动与 PID 跟踪

- ① `direct`：`child_process.spawn(python, [server.py], {env, cwd})`，直接拿子进程 PID。
- ② `disclaim`：macOS 专用。disclaim 助手（纯 Python ctypes 版 `responsibility_spawnattrs_setdisclaim` + `posix_spawn`）spawn 核心并**回传核心 PID**（助手打印 PID 后退出，核心已脱离责任）。插件记录核心 PID。
- ④ `terminal`：插件生成 `.command`（启动核心并把 PID 写入 `run/core.pid`），`open -a Terminal` 执行；插件轮询 PID 文件拿 PID。
- 统一记录 `run/core.pid`，供停止/退出清理。
- 启动核心时设 env：macOS 设 `TODOOCARD_FORCE_PYTHON=1`（见 §8）；统一设核心工作目录/端口。

### 平台差异

- Windows/Linux：无 TCC，`auto` 等价于 ①；②④ 仅 macOS 提供（设置里非 macOS 隐藏/禁用 ②④）。

## 7. 生命周期（CoreLifecycle）

- 启动/停止：控制台按钮。停止 = 按 `run/core.pid` kill 进程树（含子进程）。
- **退出思源同步关核心**：插件 `require("electron").ipcRenderer.on("siyuan-save-close", () => killCore())`；`window.addEventListener("beforeunload", …)` 兜底。
- 残留检测：思源异常退出可能留下核心。下次插件加载读 PID 文件 + 探 :8199，发现残留 → 提示「接管 / 关闭」。
- 增强（① 模式）：spawn 时建父进程管道 watch，思源进程死则核心自退（降低残留概率）。
- 看门狗（可选，Phase 1 末尾）：运行中定期探 :8199，核心意外退出 → 状态置「已停止」并提示。

## 8. macOS 纯 Python 补丁（fork）

- 在 eink fork 中给 `_send_blocking` 与 `_build_payload` 的平台分支加 env 开关：

  ```python
  if sys.platform != "darwin" or os.environ.get("TODOOCARD_FORCE_PYTHON") == "1":
      return self._send_python(image_path, wait_sec)   # / _build_payload_python
  return self._send_macos(image_path, wait_sec)
  ```

- 插件 macOS 启动核心时设 `TODOOCARD_FORCE_PYTHON=1`，使发送/产物构建走自包含纯 Python 路径。**不依赖、不分发无授权 Swift 仓库。**
- 配对：纯 Python 模式不用 Swift 配对助手；改走**系统蓝牙 OS 级配对**（系统设置→蓝牙里配对土豆片），bleak 直连已配对设备。控制台/README 给出配对引导。
- 实现期待验证风险：bleak 在 macOS 连已配对设备并完整传图（探针只证明扫描；连接+发送需真机实测）。

## 9. 控制台 UI

- 顶栏蓝牙图标 → 控制台 Dialog（复用 pptgo 交互习惯）：
  - 核心状态：未安装 / 已停止 / 运行中（显示当前模式）。
  - 操作：安装/更新、启动、停止、重新检测、打开日志、打开核心目录。
  - 设置：启动方式（auto/direct/disclaim/terminal）、核心路径、manifest/镜像 URL。
- 「打开传图界面」→ 思源自定义页签（`openTab({custom})`）内嵌 `http://127.0.0.1:8199`。
- 状态栏小图标显示运行态（可选）。
- 设置持久化用插件 `this.data` / `Setting`。

## 10. 数据流

- 安装：UI→CoreInstaller（拉 manifest→下载→校验→pip→原子替换）→CoreStore 写 core.json→UI 刷新状态。
- 启动：UI→CoreLifecycle→CoreLauncher（读缓存模式 / 预检选模式）→spawn 核心→写 PID→探 :8199 就绪→UI 显示运行中。
- 传图：UI 打开 :8199 页签→用户在核心 Web UI 操作→核心 bleak 发送→设备。
- 退出：思源 `siyuan-save-close`→CoreLifecycle.killCore→核心退出。

## 11. 错误处理

| 场景 | 处理 |
| --- | --- |
| 下载/校验失败 | 丢弃临时文件，可重试，提示镜像 |
| pip 失败 | 回退在线/本地 wheels，报日志 |
| 预检三模式全失败 | 明确报「三模式均不可用」+ 日志 + 配对/权限引导 |
| 端口 8199 占用 | 提示占用，允许改端口或关占用进程 |
| 残留核心 | 加载时检测，提示接管/关闭 |
| 核心运行中崩溃 | 看门狗置已停止并提示 |

## 12. 测试策略

- 单元：CoreStore/Installer 用本地 manifest + 假核心；Launcher 级联用桩探针验证「①失败→②→④」分支与模式缓存；Lifecycle 验证退出钩子 kill。
- 集成：本地 file:// manifest 跑通下载→安装→检测。
- 真机端到端（macOS）：安装→①预检→起核心→开 Web UI→系统配对→扫描/传图→退出清理；并强制 ②/④ 各跑一遍确认兜底。
- 回归：Windows/Linux ① 路径（无 TCC）。

## 13. 风险与诚实边界

- ② 的宿主无关性由机制保证（`is_self=true` 已实测），但本机只有带声明的思源，**官方构建上 ① 被杀未直接复现**（由缺声明推断）。
- ② 用私有 API `responsibility_spawnattrs_setdisclaim`，未来 macOS 理论上有变动风险 → ④ 兜底。
- 下载源/fork/便携 Python 需维护者托管；首次运行需联网。
- macOS 配对与端到端传图需实现期真机实测。
- 便携 Python 体积较大（每平台数十 MB），首次下载耗时；提供进度与镜像。

## 14. 验收标准（Phase 1）

1. 设置里可自定义核心目录；未安装时控制台显示「未安装」并能一键安装。
2. 安装走 manifest→下载→sha256 校验→pip→原子替换，写 core.json。
3. 默认 `auto` 启动从 ① 起，BLE 预检失败自动降 ② 再降 ④；可强制三种模式。
4. 控制台可启动/停止；运行中显示当前模式。
5. 退出思源时核心被同步关闭；异常退出后加载能检测残留并接管/关闭。
6. 「打开传图界面」在思源页签内嵌 :8199 核心 Web UI。
7. macOS 核心走纯 Python 发送（`TODOOCARD_FORCE_PYTHON=1`），不依赖无授权 Swift。

## 15. 实现期待决（留给 writing-plans）

- disclaim 助手的具体形态（纯 Python ctypes 脚本 vs 编译 C 助手）与 PID 回传协议。
- ④ 的 .command 模板与 PID 文件写入时机。
- 内嵌 Web UI 用 iframe 还是 webview 标签（思源自定义页签的承载方式）。
- 看门狗与父进程管道 watch 是否纳入 Phase 1 首批。
- wheels 离线包是否首批提供。