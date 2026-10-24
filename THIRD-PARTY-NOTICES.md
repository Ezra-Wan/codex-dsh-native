# Third-party source reuse

## DeepSeek WorkerTunnel

- Upstream: https://github.com/deepseek-ai/deepseek-harness
- Commit: `687f282e8625c6b8d11ff58211a90524be2e4317` (`0.2.1-rc.2`).
- Copyright (c) 2026 DeepSeek. MIT license, reproduced in `vendor/deepseek-worker-tunnel/LICENSE`.
- Exact original files and SHA-256 hashes: `vendor/deepseek-worker-tunnel/UPSTREAM.json`.
- `client.mjs` is generated from those unmodified TypeScript sources by `scripts/build-native-vendor.mjs`.
- The project supplies a separate MCP carrier port; no worker host privilege fallback is copied.

Installed dependencies retain their own licenses and notices. This file records source copied into this repository and does not replace their notices.

## DSH-for-Vscode session navigation

- Upstream: https://github.com/k2124732496-lab/DSH-for-Vscode
- Asset: Marketplace `KAZUHA.dsh-for-vscode@0.2.0`; exact VSIX digest and source digests in `vendor/dsh-for-vscode/UPSTREAM.json`.
- Copyright (c) 2026 dsh-vscode contributors. MIT license, reproduced in `vendor/dsh-for-vscode/LICENSE`.
- Original client source preserved in `vendor/dsh-for-vscode/workspace-sync-client.js`.
- Adaptation: `ui/native-session-target.mjs` retains the loader/injected native navigation approach, selects an existing precise SessionTarget, and removes workspace/session creation and HTTP polling.

CodexHost's execution flow informed the design; no CodexHost source or diagram asset is copied. The current LGPL release is not included in the distribution.
