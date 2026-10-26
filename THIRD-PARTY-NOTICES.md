# Third-party source reuse

## DeepSeek WorkerTunnel

- Upstream: https://github.com/deepseek-ai/deepseek-harness
- Commit: `687f282e8625c6b8d11ff58211a90524be2e4317` (`0.2.1-rc.2`).
- Copyright (c) 2026 DeepSeek. MIT license, reproduced in `vendor/deepseek-worker-tunnel/LICENSE`.
- Exact original files and SHA-256 hashes: `vendor/deepseek-worker-tunnel/UPSTREAM.json`.
- `client.mjs` is generated from those unmodified TypeScript sources by `scripts/build-native-vendor.mjs`.
- The project supplies a separate MCP carrier port; no worker host privilege fallback is copied.

Installed dependencies retain their own licenses and notices. This file records source copied into this repository and does not replace their notices.

The same DeepSeek upstream revision also supplies the MIT contract-test sources under `test/vendor/session-controller/` (each file retains its source header) and the native theme tokens extracted into `ui/theme.css`. The upstream MIT text above applies to those reused sources; our root LICENSE does not replace DeepSeek's copyright. Bundled UI produced locally from npm dependencies retains those dependencies' respective licenses. This preview distributes source, not a prebuilt third-party UI or native binary bundle.

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
- Adaptation: the Windows selector requires one explicit Codex root PID. Original presentation and click-to-show balance interaction remain unchanged, as confirmed by the user; no extra balance strip is rendered. No upstream desktop autostart, Codex plugin registration or model call is performed by preparation. Electron retains its own packaged licenses/notices.

## DeepSeek native conversation binding

- Upstream package: `@deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.2`, same DeepSeek revision as above.
- Copied `BoundConversation` from the published `lib/client.js`; only export form and external store identifier are adapted. Exact installed source bundle SHA256 and extraction details: `vendor/deepseek-bound-conversation/SOURCE.md`.
- Copyright (c) 2026 DeepSeek. MIT text retained in `vendor/deepseek-bound-conversation/LICENSE`.
- The separate adapter supplies an invocation event window to the original assembler and renderers; native conversation DOM is not copied or rewritten.
