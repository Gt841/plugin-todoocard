# plugin-todoocard

思源笔记（SiYuan）桌面插件：在思源里扫描、配对、筛选 TodooCard 墨水屏卡片，并把图片/截图发送到卡片。

发送与图像转换全部复用上游 [Sunbelife/TodooCard_Skills](https://github.com/Sunbelife/TodooCard_Skills)，本插件只负责：

- 下载并校验上游 Skill（默认钉死 commit，需手动点一次下载）
- 把 Skill 的文本命令包装成思源内的操作面板
- 设备扫描、多设备筛选、备注名与配对状态记录
- 图片选择 / Finder 拖入 / 剪贴板截图粘贴
- 生成 `.bin` 并预览卡片六色效果
- 调用上游完成配对、探测与发送

> 仅支持 macOS 桌面端（上游 Swift CLI 依赖 CoreBluetooth 与 `swiftc`）。Windows / Linux 暂不支持；待上游提供可用的 Windows 核心后再评估。
>
> 插件代码以 MIT 许可证开源；上游 Skill 不随本仓库或 `package.zip` 分发，只在用户本机按需下载。

## 功能

- **设备**：扫描附近 BLE 设备；默认只显示 TodooCard 兼容设备（manufacturer `0x5053` + screen `0x134C`），可关闭「仅兼容」查看全部；支持按信号/名称排序、搜索、配对窗口筛选、已配对筛选。
- **配对**：按设备 UUID 记录备注名和配对时间；配对前提示长按卡片背面按钮（新固件 5 秒 / 旧固件 10 秒），配对窗口最长 60 秒；可自动探测验证加密连接并读取电量。
- **图片**：选择 JPG/PNG/HEIC/TIFF/BMP/WebP；拖入图片；直接粘贴截图（⌘V 或「粘贴截图」）；可向右旋转 90°。
- **生成与预览**：调用上游转换，展示 v157+ / legacy payload 大小，并把 528×792 的 4bit 位图解码为六色预览。
- **发送**：目标设备、图片、校验结果分步确认；只有收到卡片的 `0x05/0x08` 刷新确认才视为发送成功。

## 环境要求

- macOS（Apple Silicon / Intel）
- SiYuan ≥ 3.0.1，桌面端
- Xcode Command Line Tools（提供 `swiftc`）：`xcode-select --install`
- `python3` 与系统 `/usr/bin/sips`
- 首次扫描时允许思源使用蓝牙（系统设置 → 隐私与安全性 → 蓝牙）

## 使用

1. 安装并启用插件，点击顶部栏「土豆片 · TodooCard」图标。
2. 首次使用在引导页点击 **下载核心**。插件会从默认钉死的 commit 下载上游源码 tarball，校验 SHA-256 后解压到数据目录。
3. 切到 **设备**，点击 **扫描设备**，等待约 30 秒；在设备列表里选中卡片。
4. 首次连接：点 **配对**，按提示长按卡片背面按钮，等 macOS 弹出蓝牙配对提示时允许。已配对设备即使当前未被扫描到，也可以直接 **探测** 或按 UUID 发送。
5. 切到 **图片**：选择/拖入图片，或直接粘贴截图；调整 2:3 取景框，点 **生成预览**，确认六色效果。
6. 在图片页下方勾选目标卡片（支持多选），点 **发送到卡片** / **发送到 N 台卡片**，核对清单后确认发送。

配对与发送都需要卡片在附近并保持唤醒。扫描只列出兼容设备；配对窗口关闭时，需先长按卡片按钮进入配对模式。

## 数据目录（不参与思源同步）

默认：

```text
~/Library/Application Support/SiYuan/todoocard/
├── state.json        # 设置、设备备注、配对记录、上次选择
├── skill/            # 上游 Skill 副本（可重新下载覆盖）
├── skill-meta.json   # 来源、commit、SHA-256、安装时间
├── tmp/              # 下载/解压临时目录
├── cache/            # HEIC 等预览缓存
└── legacy/           # 旧版插件设备备注备份（如有）
```

该目录位于思源工作区 `data/` 的上一级，不在思源同步范围内；插件不使用 `saveData` / petal 存储，因此插件信息与配对信息不会被云端旧副本覆盖。

调试时可用环境变量 `SIYUAN_TODOCARD_HOME` 覆盖数据目录（测试用）。

## 上游版本策略

- 默认来源：`https://github.com/Sunbelife/TodooCard_Skills/commit/81f61e10c60ff0e7199749c67d090bb74252fd66`
- **不会自动跟随 `main`**，也不会自动下载；必须点一次「下载 / 更新核心」。
- 更新上游：在「设置 → 核心来源」把地址改成新的 commit 或 `main`，保存后点「下载 / 更新核心」。
- 上游仓库没有 LICENSE，本插件**不重新分发**上游源码；只在用户本机按需下载。
- 下载后记录 tarball SHA-256 和解压出来的目录名（如 `TodooCard_Skills-<sha>`），便于追溯。

## 开发

```bash
npm install
npm test          # vitest：解析、状态存储、路径、Skill 安装、图片校验、payload 预览
npm run build     # 生成 dist/ 与 package.zip
npm run make-link # 把开发构建软链到思源插件目录
npm run dev       # watch 构建到思源插件目录
```

构建后手动安装：

```bash
unzip -o package.zip -d "$HOME/Library/Application Support/SiYuan/data/plugins/plugin-todoocard"
```

## 已完成的真机验证

- 单元测试 51/51 通过；生产构建通过。
- 在 SiYuan 3.8.10（macOS）中安装并加载，顶部栏入口、引导页与 **图片 / 设备 / 设置** 三页签正常；默认打开图片页。
- 首次点击下载：从钉死 commit 下载成功，`skill-meta.json` 记录的 ref 与 SHA-256 正确，数据目录为 `~/Library/Application Support/SiYuan/todoocard`，不参与思源同步。
- 真实 BLE 扫描：一次扫描发现 36 台设备，其中 2 台 TodooCard 兼容设备（`519D2FA1…` / `C3B1E61E…`）；备注名持久化、多设备切换正常。
- 剪贴板截图粘贴、2:3 取景、上游转换与 528×792 六色 payload 预览正常；模拟 10 台已配对设备时，图片页高度不随列表增长，发送按钮始终可见。
- 提示统一为面板内浮层（toast）：未选图片、未生成预览、未选目标时不会拉长页面。
- 已配对但当前未扫描到的设备可直接 **探测**；配对仍要求设备处于扫描/配对窗口内。
- 未配对时探测/发送会返回上游的明确错误（`The secure bond is unavailable` / `Disconnected`），不会被误报为成功。

完整配对与发送仍需在卡片上长按物理按钮并允许 macOS 蓝牙配对提示；这是上游协议要求，插件不会绕过。
