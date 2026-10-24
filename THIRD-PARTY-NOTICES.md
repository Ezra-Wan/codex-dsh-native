# Third-party source reuse

## DeepSeek WorkerTunnel

- Upstream: https://github.com/deepseek-ai/deepseek-harness
- Commit: `687f282e8625c6b8d11ff58211a90524be2e4317` (`0.2.1-rc.2`).
- Copyright (c) 2026 DeepSeek. MIT license, reproduced in `vendor/deepseek-worker-tunnel/LICENSE`.
- Exact original files and SHA-256 hashes: `vendor/deepseek-worker-tunnel/UPSTREAM.json`.
- `client.mjs` is generated from those unmodified TypeScript sources by `scripts/build-native-vendor.mjs`.
- The project supplies a separate MCP carrier port; no worker host privilege fallback is copied.

Installed dependencies retain their own licenses and notices. This file records source copied into this repository and does not replace their notices.
