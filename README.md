# plugin-todoocard

SiYuan desktop plugin that manages a local TodooCard e-ink core.

## Phase 1 scope

- Core management: install / update the local TodooCard core from a maintainer-provided manifest (SHA-256 verified).
- Launch cascade: ① direct → ② disclaim → ④ Terminal, with automatic fallback when a mode fails.
- Control console inside SiYuan: core status, launch mode selection, port and core directory settings.
- Image transfer is done via the core's own Web UI (default port `8199`); this plugin does not implement a transfer UI in Phase 1.

Supported: Windows, Linux, macOS (desktop frontends only, SiYuan ≥ 3.0.1).

## macOS pairing note

Pair the TodooCard device in **System Settings → Bluetooth** first, before launching the core from this plugin.

详细步骤（中文）见 [docs/macos-pairing.md](docs/macos-pairing.md)：macOS 纯 Python 模式的配对、扫描发送与 bleak 排障。

## 维护者托管 / Maintainer hosting

普通用户无需执行本节；这是维护者发布土豆片核心（eink fork）时的操作清单。

1. **在 eink fork 应用补丁并打 Release**：把本仓库的 `fork-patch/force-python.patch` 复制到你的 eink fork 仓库根目录，执行 `git apply force-python.patch`。补丁共 4 处改动：`card.py` 顶部新增 `import os`；`_build_payload` 与 `_send_blocking` 两个 BLE 分支改为 `if sys.platform != "darwin" or os.environ.get("TODOOCARD_FORCE_PYTHON") == "1":`；新增自包含的 `_scan_python`（bleak）方法，并让 Web UI 扫描端点 `_scan` 在 macOS 纯 Python 模式下改走它（不再调用依赖无授权 Swift 的 `_ensure_bins`）。`pick_folders` 文件夹选择器不受影响。应用后建议 `python3 -m py_compile card.py` 自检，然后打 tag 并发布 Release，产物作为 manifest 里的 `einkUrl` 包。
2. **准备各平台便携 Python 包 + sha256**：为每个目标平台（`darwin-arm64`、`darwin-x64`、`windows-x64`、`linux-x64`）准备便携 Python 运行时包（`pythonUrl`）与 eink 源码包（`einkUrl`，可选依赖包 `depsUrl`），并分别计算 SHA-256。插件安装时会逐一校验，不匹配即拒绝安装。便携 Python 包解压后须直接得到 `python/bin/python3`（macOS/Linux）或 `python/python.exe`（Windows），不要多套一层目录；eink 包解压后须直接得到 `server.py`/`card.py`/`requirements.txt`（位于压缩包根）。Windows 的 Python 包用 `.zip`（插件用 `Expand-Archive` 解压），其余平台用 `.tar.gz`。
3. **托管 manifest JSON**：把版本号与各平台包的 URL/sha256 写成 manifest JSON，托管到可公开访问的 HTTPS 地址（如 GitHub Pages 或 Release 附件）。格式与插件 `src/types.ts` 的 `Manifest` 一致，平台键为 `平台-架构`（Windows 用 `windows`）：

   ```json
   {
     "version": "1.0.0",
     "platforms": {
       "darwin-arm64": {
         "pythonUrl": "https://example.com/python-darwin-arm64.tar.gz",
         "pythonSha256": "<sha256>",
         "einkUrl": "https://example.com/eink-1.0.0.zip",
         "einkSha256": "<sha256>"
       }
     }
   }
   ```

   每个平台条目至少要有 `pythonUrl`/`pythonSha256` 与 `einkUrl`/`einkSha256`（URL 与对应 SHA-256 均必填）；`depsUrl`/`depsSha256` 可选。`depsUrl`/`depsSha256` 为可选离线 wheels 包；缺省时插件回退在线 `pip install -r requirements.txt`。
4. **在插件设置里填 manifest URL**：在思源「设置 → 集市 → 已下载 → 本插件」的设置项 **Manifest URL** 中填入托管地址（本地开发可用 `file://` 指向本地 manifest），之后控制台「安装/更新」即可检测、下载并校验核心。

macOS 上插件启动核心时会自动设置 `TODOOCARD_FORCE_PYTHON=1`（纯 Python 模式），因此 fork 必须带上本补丁，macOS 的扫描/发送才会走 Python（bleak）路径。

## 平台说明 / Platform notes

Windows/Linux：核心 Web UI 的「扫描附近设备」按钮依赖 macOS Swift 工具，在这两个平台不可用；但发送仍可用——`sender.py` 在未绑定设备时按名字自动发现卡片。macOS 纯 Python 模式扫描/发送均可用（见 [docs/macos-pairing.md](docs/macos-pairing.md)）。控制台「端口」可改核心 Web UI 端口（默认 8199）。

## Development

```bash
npm install
npm test          # vitest
npm run build     # emits dist/ and package.zip
npm run make-link # symlink dev build into your SiYuan plugins dir
npm run dev       # watch build into the SiYuan plugins dir
```
