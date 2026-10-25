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

## Optional Codex Whale desktop companion

- Upstream: https://github.com/Yang-huai406/Codex-Whale-Public
- Pinned revision: `4a7ec1240de82527f2222b4af5202fa7b2ad731b`, package `0.4.1`.
- MIT, copyright (c) 2026 MeteorNOX. The explicit preparation script copies the original LICENSE, PROVENANCE.md and THIRD_PARTY_NOTICES.md alongside the upstream runtime into the selected isolated local directory; upstream code is not vendored in this repository.
- Adaptations: the Windows selector requires one explicit Codex root PID. The original native balance bubble opens automatically and remains available; its existing scene controller and data refresh are retained. No extra balance strip is rendered. No upstream desktop autostart, Codex plugin registration or model call is performed by preparation. Electron retains its own packaged licenses/notices.
