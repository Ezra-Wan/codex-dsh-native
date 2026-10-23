import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';

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
export function createRuntime(record, { home, patches = [] }) {
  return new NativeRuntime({
    dshHome: home,
    profile: 'sdk',
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
