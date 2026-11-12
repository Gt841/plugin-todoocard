# plugin-todoocard

SiYuan desktop plugin that manages a local TodooCard e-ink core.

## Phase 1 scope

- Core management: install / update the local TodooCard core from a maintainer-provided manifest (SHA-256 verified).
- Launch cascade: ① direct → ② disclaim → ④ Terminal, with automatic fallback when a mode fails.
- Control console inside SiYuan: core status, launch mode selection, port and core directory settings.
- Image transfer is done via the core's own Web UI (default port `8199`); this plugin does not implement a transfer UI in Phase 1.

Supported: Windows, Linux, macOS (desktop frontends only, SiYuan ≥ 3.0.1).

## 分发模型（v2）

核心源码与便携 Python **直接引用上游**，我们不再分发 fork 全量包：

| 资产 | 来源 |
| --- | --- |
| 上游源码 tarball（松散 `.py`） | `shidaifufen/todoocard-eink` 的 **commit sha**（`archive/<sha>.tar.gz`） |
| 便携 Python | astral-sh `python-build-standalone` 官方 `install_only` |
| 版本匹配扩展包（`apply.py` + `extension.json`） | 独立仓库 `Gt841/todoocard-core-dist` 的 GitHub Releases |
| `manifest.json`（v2） | 同一仓库的 GitHub Pages |

安装流程：读 manifest → 三资产下载 + 逐个 sha256 校验 → 解压归一化（剥 `todoocard-eink-<sha>/` 与 `python/` 顶层）→ 便携 Python 跑 `pip install -r requirements.txt` → 跑 `apply.py` 注入必要改动 → 原子替换 → 写 `core.json`（含 `coreVersion` / `coreCommit`）。任一步失败即中止，旧核心完好。

`apply.py` 用**锚点断言 + 幂等 + 编译校验**守住版本匹配：上游源码漂移（锚点消失/变形/多处）或 `coreVersion`/`coreCommit` 不符 → 非 0 退出，控制台提示「上游版本可能已漂移」，维护者重基扩展包。

> 当前状态（2026-11-12）：**dist 已上线**——仓库 `Gt841/todoocard-core-dist`、Release `v1.0.11`、Pages manifest 均已发布，插件默认 `manifestUrl` 已指向 `https://gt841.github.io/todoocard-core-dist/manifest.json`（可在设置里覆盖）。线上三资产 sha 与全链路（含 pip、apply.py、py_compile）已复核通过。**仍待人工**：真机 BLE 全流程验证、插件集市发版。

## macOS pairing note

Pair the TodooCard device in **System Settings → Bluetooth** first, before launching the core from this plugin.

详细步骤（中文）见 [docs/macos-pairing.md](docs/macos-pairing.md)：macOS 纯 Python 模式的配对、扫描发送与 bleak 排障。

## 维护者托管 / Maintainer hosting

普通用户无需执行本节。**上游更新只动 dist 仓库，本插件仓库零改动。**

1. **扩展包与 manifest 在独立仓库**：`Gt841/todoocard-core-dist`（本地路径 `../todoocard-core-dist`）。目录、脚本、锚点清单与上游更新工作流见其 [README](../todoocard-core-dist/README.md) 与 [docs/maintainer.md](../todoocard-core-dist/docs/maintainer.md)。
2. **发布资产**：`bash scripts/build-extension.sh` 生成 `dist/extension-<ver>.zip`；`REFRESH=1 bash scripts/build-manifest.sh` 复算三资产 sha256 并生成 `manifest.json`；`bash scripts/verify.sh` 做无 BLE 端到端验证。
3. **托管**：`manifest.json` → GitHub Pages（如 `https://gt841.github.io/todoocard-core-dist/manifest.json`）；扩展 zip → GitHub Release `v<ver>`。**源码 tarball 与便携 Python 只引用上游 URL，不托管、不再分发。**
4. **版本钉死**：manifest 用 `coreCommit`（40 位 sha）拼 `sourceUrl`，用 `sourceSha256` 锁字节；`coreTag`（如 `v1.0.11-macos`）**仅作展示/追溯**——上游没有裸 `v1.0.11` tag。发布前务必 `REFRESH=1` 复算 sha（GitHub archive 字节可能随服务端重新生成而变化）。
5. **插件设置**：`src/settings.ts` 的 `DEFAULT_SETTINGS.manifestUrl` 已默认指向上述 Pages 地址（`DIST_MANIFEST_URL`），**普通用户无需手填**；需要自建源时在思源「设置 → 集市 → 已下载 → 本插件」的 **Manifest URL** 覆盖（本地开发可用 `file://`）。控制台「安装/更新」是手动触发，比较 `core.json.coreVersion` 与 `manifest.coreVersion`；旧 `core.json` 缺该字段视为 `0.0.0`，会自动重装迁移到 v2。

`fork-patch/*.patch` 与 `scripts/dev-kit.sh` 是 Phase 1 的旧 fork 分发工具，**已作废**（见 `fork-patch/README.md`），其有用逻辑已重基为 dist 仓库的 `apply.py`。

## 平台说明 / Platform notes

Windows/Linux：核心 Web UI 的「扫描附近设备」按钮依赖 macOS Swift 工具，在这两个平台不可用；但发送仍可用——`sender.py` 在未绑定设备时按名字自动发现卡片。macOS 纯 Python 模式扫描/发送均可用（见 [docs/macos-pairing.md](docs/macos-pairing.md)）。控制台「端口」可改核心 Web UI 端口（默认 8199）。

## 安全 / Security

核心 Web UI（`card.html` 及 `/api/card/*`）**无鉴权**：能访问该端口的人都能向卡片发图、读取卡片状态。上游默认绑 `0.0.0.0`（所有网卡），`apply.py` 注入的改动已改为**默认仅绑 `127.0.0.1`**，因此只有本机能访问——思源内嵌的传图页签走的正是 `127.0.0.1`，功能不受影响。

如需用手机/其他设备经局域网访问传图界面，在启动思源的环境里设 `HOST=0.0.0.0`（核心继承思源进程的环境变量）。**这会重新把无鉴权界面暴露到整个局域网**，请仅在可信网络下使用。macOS 从 Finder 启动的思源不继承 shell 环境，可用 `launchctl setenv HOST 0.0.0.0` 后重启思源。端口可在控制台「端口」修改（默认 8199）。

## Development

```bash
npm install
npm test          # vitest
npm run build     # emits dist/ and package.zip
npm run make-link # symlink dev build into your SiYuan plugins dir
npm run dev       # watch build into the SiYuan plugins dir
```

设计与实现计划见 `docs/superpowers/specs/2026-11-12-upstream-core-extension-design.md` 与 `docs/superpowers/plans/2026-11-12-upstream-core-extension.md`。
