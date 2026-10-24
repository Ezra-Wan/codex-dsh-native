import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WEB_RUNTIME_PATCH } from './web-profile.mjs';

// Official minimal delegation setup from @deepseek-ai/dsh-subagent README:
// service + in-process provider + model-facing tool. The sdk profile ships
// without any of these, so subagent tasks opt in via an extra profile patch.
const SUBAGENT_PATCH = [
  "- name: '@deepseek-ai/dsh-subagent'",
  "- name: '@deepseek-ai/dsh-subagent-spawn-in-process'",
  "- name: '@deepseek-ai/dsh-tool-subagent'",
  '  config:',
  '    provider: spawn',
  '    toolName: subagent',
].join('\n') + '\n';

export async function writeSubagentPatch(root) {
  const dir = join(root, 'patches');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'subagent.yaml');
  await writeFile(path, SUBAGENT_PATCH, 'utf8');
  return path;
}

// Per-task overlay for the sdk-web profile: pins this task's webserver port
// and mounts @codex-dsh/web-embed with the bridge-owned URL file it writes.
export async function writeWebEmbedPatch(root, { port, urlFile }) {
  const dir = join(root, 'patches');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `web-embed-${port}.yaml`);
  const yaml = [
    WEB_RUNTIME_PATCH.trimEnd(),
    `- id: webserver`,
    `  config:`,
    `    host: 127.0.0.1`,
    `    port: ${port}`,
    `- insert:`,
    `  - id: codex-web-embed`,
    `    name: '@codex-dsh/web-embed'`,
    `    config:`,
    `      urlFile: ${JSON.stringify(urlFile)}`,
  ].join('\n') + '\n';
  await writeFile(path, yaml, 'utf8');
  return path;
}

class NativeRuntime extends DeepSeekHarness {
  async run(task, { sessionId, onNotification }) {
    // The SDK's task-level wait includes native descendants and their summary
    // turns. Keep observing until that wait ends, including intermediate idle.
    const subscription = this.client.subscribeSessionTree(sessionId);
    const events = [];
    let finished = false;
    let streamError;
    const collect = notification => {
      onNotification?.(notification);
      if (notification.method === 'session.event' && notification.params.sessionId === sessionId) {
        const event = notification.params.event;
        if (['assistant/message', 'turn/end'].includes(event.type)) events.push(event);
      }
    };
    const reader = (async () => {
      try { while (!finished) collect(await subscription.next()); }
      catch (error) { if (!finished) streamError = error; }
    })();
    try {
      await this.client.prompt(sessionId, [{ type: 'text', text: task }]);
      await this.client.request('session/wait', { sessionId });
      let next;
      while ((next = subscription.tryNext()) !== undefined) collect(next);
      finished = true;
      subscription.close();
      await reader;
      if (streamError) throw streamError;
      const last = events.findLast(event => event.type === 'assistant/message');
      const finalResponse = last?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
      return { events, finalResponse };
    } finally {
      finished = true;
      subscription.close();
      await reader;
    }
  }
}

// The official SDK owns process lifetime, native history, tools and compaction.
// The bridge never rebuilds a model prompt from a transcript.
export function createRuntime(record, { home, patches = [], profile = 'sdk' }) {
  return new NativeRuntime({
    dshHome: home,
    profile,
    patches,
    cwd: record.cwd,
    processCwd: record.cwd,
    provider: record.provider,
    model: record.model,
    maxTokens: record.maxTokens,
    ...(record.effort ? { reasoningEffort: record.effort } : {}),
    initializeTimeoutMs: 60_000,
    env: {
      ...process.env,
      DSH_PERMISSION_MODE: record.permission,
      // A token-truncated answer must not be presented as a successful delivery.
      DSH_MAX_TOKENS_AS_SUCCESS: 'false',
    },
  });
}
