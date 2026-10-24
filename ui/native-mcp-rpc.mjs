// MCP carries the frames; unmodified upstream WorkerTunnel owns duplex stream
// semantics, cancellation, blocked-uplink release and structured failures.
import { WorkerTunnel } from '../vendor/deepseek-worker-tunnel/client.mjs';

export function createNativeMcpRpc(call) {
  const listeners = new Map();
  const streams = new Map();
  const emit = (type, data) => { for (const listener of listeners.get(type) ?? []) listener({ data, message: data?.message }); };
  const close = state => {
    state.cancelled = true;
    if (state.nativeId) void call('native_stream_close', { id: state.nativeId }).catch(() => {});
    streams.delete(state.id);
  };
  const port = {
    addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    postMessage(frame) {
      if (frame.t === 'stream-open') {
        const state = { id: frame.id, cancelled: false };
        streams.set(frame.id, state);
        state.ack = Promise.withResolvers();
        void (async () => {
          const { id } = await call('native_stream_open', { endpoint: frame.endpoint, payload: frame.payload });
          state.nativeId = id;
          state.ack.resolve();
          if (state.cancelled) { close(state); return; }
          while (!state.cancelled) {
            const { frames, closed } = await call('native_stream_read', { id });
            if (state.cancelled) return;
            let terminal = false;
            for (const item of frames) {
              if (item.type === 'item') emit('message', { t: 'stream-item', id: frame.id, value: item.value });
              else if (item.type === 'error') {
                terminal = true;
                emit('message', { t: 'stream-error', id: frame.id, failure: {
                  kind: item.carrier ? 'carrier' : 'remote', message: item.error?.message ?? 'Native stream failed',
                  code: item.error?.code, details: item.error?.details,
                } });
              } else if (item.type === 'end') { terminal = true; emit('message', { t: 'stream-end', id: frame.id }); }
              if (terminal) break;
            }
            if (terminal || closed) {
              if (!terminal) emit('message', { t: 'stream-error', id: frame.id,
                failure: { kind: 'carrier', message: 'Native connection closed before stream completion' } });
              close(state); return;
            }
          }
        })().catch(error => {
          state.ack.resolve();
          if (!state.cancelled) emit('message', { t: 'stream-error', id: frame.id,
            failure: { kind: 'carrier', message: error.message } });
          close(state);
        });
        return;
      }
      const state = streams.get(frame.id);
      if (!state) return;
      if (frame.t === 'abort') { close(state); return; }
      if (frame.t === 'stream-uplink-item' || frame.t === 'stream-uplink-end') {
        void state.ack.promise.then(async () => {
          if (state.cancelled) return;
          await call('native_stream_send', { id: state.nativeId,
            type: frame.t === 'stream-uplink-end' ? 'end' : 'item',
            ...(frame.t === 'stream-uplink-item' ? { value: frame.value } : {}) });
        }).catch(error => {
          if (!state.cancelled) emit('message', { t: 'stream-error', id: frame.id,
            failure: { kind: 'carrier', message: error.message } });
          close(state);
        });
        return;
      }
      throw new Error(`Unsupported native MCP frame: ${frame.t}`);
    },
  };
  const tunnel = new WorkerTunnel(port);
  return {
    async call(channel, endpoint, payload, signal) {
      if (channel !== '/api') throw new Error('Unsupported native channel');
      signal?.throwIfAborted();
      const result = await call('native_rpc', { channel, endpoint, payload });
      signal?.throwIfAborted();
      return result;
    },
    open(channel, endpoint, payload, signal = new AbortController().signal, uplink) {
      if (channel !== '/api') throw new Error('Unsupported native channel');
      return tunnel.open(endpoint, payload, signal, uplink);
    },
    dispose() { emit('error', { message: 'MCP native view disposed' }); for (const state of streams.values()) close(state); },
  };
}
