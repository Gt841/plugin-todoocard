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

## Development

```bash
npm install
npm test          # vitest
npm run build     # emits dist/ and package.zip
npm run make-link # symlink dev build into your SiYuan plugins dir
npm run dev       # watch build into the SiYuan plugins dir
```