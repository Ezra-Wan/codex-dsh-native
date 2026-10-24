// Thin adapter mounted INSIDE the executing DSH runtime (sdk-web profile).
//
// The bridge spawns each task as an SDK process whose profile also mounts the
// official web stack (webserver/gateway/frontend/session-controller) in the
// SAME process, so the official UI's follow stream sees this process's native
// assistant-stream frames — the transient text stream the SDK stdio protocol
// does not carry and a separate replay process cannot receive.
//
// This plugin's only job: once webServer + connection are live, write the
// authenticated UI URL (the in-process launch token never leaves the process
// otherwise) to a bridge-owned file. The bridge reads that file and embeds
// the URL. Written per docs/upstream-source-study.md (S1 plan, 2026-10-24).
//
// Cordis contract (verified against the installed @deepseek-ai/cordis and
// matching how official plugins like dsh-web-app do it): configuration is the
// SECOND apply argument — apply(ctx, config). Reading ctx.config without an
// inject declaration throws. One-shot behavior is a local flag; never dispose
// the host fiber from a plugin.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function apply(ctx, config) {
  const urlFile = config?.urlFile;
  if (typeof urlFile !== 'string' || urlFile.length === 0) {
    throw new Error('@codex-dsh/web-embed: urlFile config is required (absolute path)');
  }
  ctx.inject(['webServer', 'connection'], connectionCtx => {
    let announced = false;
    const announce = () => {
      if (announced) return;
      // Services are injected onto the CALLBACK context. A sibling provider
      // (how dsh-host-webserver actually mounts — a Service plugin in its own
      // plugin context) is NOT reachable through the outer plugin ctx: reading
      // ctx.webServer there throws "cannot get property webServer without
      // inject" in real compositions.
      const origin = connectionCtx.webServer?.getOrigin?.();
      if (!origin) throw new Error('@codex-dsh/web-embed: webServer.getOrigin unavailable after injection');
      const authenticated = connectionCtx.connection.authenticatedUrl(origin);
      mkdirSync(dirname(urlFile), { recursive: true });
      writeFileSync(urlFile, JSON.stringify({ url: authenticated, pid: process.pid, writtenAt: new Date().toISOString() }, null, 2) + '\n');
      announced = true;
    };
    const loader = connectionCtx.get('loader');
    if (loader?.await) {
      // A rejected loader settlement must not silently swallow the announce:
      // retry once so a healthy stack still writes the URL, and surface a
      // marker file when it truly cannot (the bridge reads it as a miss).
      Promise.resolve(loader.await())
        .then(announce)
        .catch(() => {
          try { announce(); } catch (error) {
            try {
              mkdirSync(dirname(urlFile), { recursive: true });
              writeFileSync(`${urlFile}.error`, String(error?.message ?? error));
            } catch { /* the bridge times out and degrades */ }
          }
        });
    } else announce();
  });
}
