import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { mkdir, writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import {randomUUID} from 'node:crypto';
import { WEB_RUNTIME_PATCH } from './web-profile.mjs';

// Reuse the installed base rows by ID. In this version the providers already
// exist; adding unnamed duplicates would collide on their provider names.
const SUBAGENT_PATCH = [
  '- id: subagent',
  "  name: '@deepseek-ai/dsh-subagent'",
  '- id: subagent-spawn-in-process',
  "  name: '@deepseek-ai/dsh-subagent-spawn-in-process'",
  '- id: tool-subagent',
  "  name: '@deepseek-ai/dsh-tool-subagent'",
  '  disabled: false',
  '  config:',
  '    provider: spawn',
  '    toolName: subagent',
].join('\n') + '\n';

async function writePatch(path,text){const temporary=`${path}.${randomUUID()}.tmp`;await writeFile(temporary,text,'utf8');await rename(temporary,path);}

// Web removes these host rows because its own session factory mounts a
// per-agent preset. SDK agents bypass that factory, so composing sdk+web
// without restoring SDK execution leaves only working_directory and no
// compactor. Reuse upstream implementations/configs, patching visibility only.
export async function writeExecutionPatch(root,{webEmbed=false,subagents=false}={}){
  const dir=join(root,'patches');await mkdir(dir,{recursive:true});
  const restored=['tool-jobs','tool-fs','tool-fs-search','skill-filesystem','tool-skill','command-goal','tool-goal','plan-mode','compaction-basic','command-compact','tool-result-pruner','agent-instructions','tool-todo','tool-web'];
  const delegation=['tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','workflow-ptc','tool-workflow'];
  const rows=[...(webEmbed?restored.map(id=>`- id: ${id}\n  disabled: false`):[]),
    ...(webEmbed?['- id: tool-bash\n  disabled: !!js process.platform === \'win32\'','- id: tool-pwsh\n  disabled: !!js process.platform !== \'win32\'']:[]),
    ...delegation.map(id=>`- id: ${id}\n  disabled: ${!subagents}`)];
  const path=join(dir,`execution-${webEmbed?'web':'sdk'}-${subagents?'children':'single'}.yaml`);
  await writePatch(path,rows.join('\n')+'\n');return path;
}

export async function writeSubagentPatch(root) {
  const dir = join(root, 'patches');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'subagent.yaml');
  await writePatch(path, SUBAGENT_PATCH);
  return path;
}

// Per-task overlay for the sdk-web profile: pins this task's webserver port
// and mounts @codex-dsh/web-embed with the bridge-owned URL file it writes.
export async function writeWebEmbedPatch(root, { port, urlFile, key }) {
  const dir = join(root, 'patches');
  await mkdir(dir, { recursive: true });
  if(key!==undefined&&!/^[a-f0-9-]+$/i.test(key))throw Error('Invalid native runtime patch identity');
  const path = join(dir, `web-embed-${key??port}.yaml`);
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
  await writePatch(path, yaml);
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
