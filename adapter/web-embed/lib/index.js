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
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function apply(ctx) {
  const config = ctx.config ?? {};
  const urlFile = config.urlFile;
  if (typeof urlFile !== 'string' || urlFile.length === 0) {
    throw new Error('@codex-dsh/web-embed: urlFile config is required (absolute path)');
  }
  ctx.inject(['webServer', 'connection'], connectionCtx => {
    const root = connectionCtx.root;
    const announce = () => {
      const origin = ctx.webServer?.getOrigin?.();
      if (!origin) return;
      const authenticated = connectionCtx.connection.authenticatedUrl(origin);
      mkdirSync(dirname(urlFile), { recursive: true });
      writeFileSync(urlFile, JSON.stringify({ url: authenticated, pid: process.pid, writtenAt: new Date().toISOString() }, null, 2) + '\n');
      root.fiber.scope.dispose(); // one-shot: nothing else for this plugin to do
    };
    const loader = connectionCtx.get('loader');
    if (loader?.await) Promise.resolve(loader.await()).then(announce).catch(() => {});
    else announce();
  });
}
