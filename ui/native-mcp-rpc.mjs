// Logical carrier consumed by the unmodified DSH ClientTransportHooks.rpc.
export function createNativeMcpRpc(call) {
  return {
    async call(channel, endpoint, payload, signal) {
      signal?.throwIfAborted();
      const data = await call('native_rpc', { channel, endpoint, payload });
      signal?.throwIfAborted();
      return data;
    },
    async *open(channel, endpoint, payload, signal, uplink) {
      if (channel !== '/api') throw new Error('Unsupported probe channel');
      signal?.throwIfAborted();
      const { id } = await call('native_stream_open', { endpoint, payload });
      const stopped = Promise.withResolvers();
      let pumpingError;
      const iterator = uplink?.[Symbol.asyncIterator]();
      const pumping = (async () => {
        if (!iterator) return;
        while (true) {
          const next = await Promise.race([iterator.next(), stopped.promise]);
          if (next === null || signal?.aborted) return;
          await call('native_stream_send', { id, type: next.done ? 'end' : 'item',
            ...(next.value === undefined ? {} : { value: next.value }) });
          if (next.done) return;
        }
      })().catch(error => { pumpingError = error; });
      try {
        while (!signal?.aborted) {
          const { frames, closed } = await call('native_stream_read', { id });
          if (pumpingError) throw pumpingError;
          for (const frame of frames) {
            if (signal?.aborted) return;
            if (frame.type === 'error') throw Object.assign(new Error(frame.error?.message ?? 'Native stream failed'), frame.error, { isDSHRemoteError: true });
            if (frame.type === 'item') yield frame.value;
            if (frame.type === 'end') return;
          }
          if (closed) return;
        }
      } finally {
        stopped.resolve(null);
        // A native journal handle can be blocked on next(). Releasing it must
        // not deadlock the downstream consumer's cancellation.
        Promise.resolve(iterator?.return?.()).catch(() => {});
        await pumping;
        await call('native_stream_close', { id }).catch(() => {});
      }
    },
  };
}
