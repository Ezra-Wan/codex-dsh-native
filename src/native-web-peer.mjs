import { createRequire } from 'node:module';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-gateway'));
const { WebSocket } = require('ws');

// Server-side peer for ONE executing DSH runtime. The browser never sees its
// launch token or cookies. This adapts the already verified zero-model peer.
export class NativeWebPeer {
  constructor(url, { allow = () => true, fetchImpl = fetch, WebSocketImpl = WebSocket, maxQueueBytes = 8 * 1024 * 1024 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('Expected a task-owned loopback runtime');
    this.url = url; this.origin = parsed.origin; this.allow = allow; this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl; this.maxQueueBytes = maxQueueBytes;
    this.streams = new Map(); this.closed = false;
  }
  async initialize() {
    if (this.closed) throw new Error('Native peer released');
    if (this.initialized) return;
    if (!this.initializing) this.initializing = (async () => {
      const auth = await this.fetch(this.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (auth.status !== 303) throw new Error('Native browser authentication failed');
      this.cookie = auth.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      await this.authenticateOperator();
      this.initialized = true;
    })().finally(() => { this.initializing = null; });
    return this.initializing;
  }
  async authenticateOperator() {
    const connect = new URL('/connect', this.url);
    connect.search = new URL(this.url).search; connect.searchParams.set('interactions', 'answer');
    const auth = await this.fetch(connect, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (auth.status !== 302) throw new Error('Native operator authentication failed');
    this.apiCookie = auth.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  }
  async shell() {
    await this.initialize();
    const response = await this.fetch(this.origin, { headers: { Cookie: this.cookie }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Native shell HTTP ${response.status}`);
    return response.text();
  }
  async asset(path) {
    const url = new URL(path, this.origin + '/');
    if (url.origin !== this.origin || !(/^\/plugins\/\?\?/.test(url.pathname + url.search) || /^\/assets\/[A-Za-z0-9_./-]+$/.test(url.pathname))) throw new Error('Asset outside official bundle routes');
    const response = await this.fetch(url, { headers: { Cookie: this.cookie }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Native asset HTTP ${response.status}`);
    return response.text();
  }
  assertEndpoint(endpoint) {
    if (!/^(?:\$events(?:\/result)?|[A-Za-z][\w-]*\/[A-Za-z][\w-]*)$/.test(endpoint) || !this.allow(endpoint)) throw new Error(`Native view refuses endpoint: ${endpoint}`);
    if (this.closed) throw new Error('Native peer released');
  }
  async ensureMux() {
    await this.initialize();
    if (this.mux?.readyState === this.WebSocket.OPEN) return;
    if (this.muxStarting) return this.muxStarting;
    this.muxStarting = (async () => {
      if (this.closed) throw new Error('Native peer released');
      if (this.mux) await this.authenticateOperator();
      const socket = new this.WebSocket(this.origin.replace('http:', 'ws:') + '/api/remote.mux', {
        headers: { Cookie: this.apiCookie, Origin: this.origin }, handshakeTimeout: 5000,
      });
      this.mux = socket;
      socket.on('message', raw => {
        let frame;
        try { frame = JSON.parse(raw.toString()); } catch { socket.terminate(); return; }
        const state = this.streams.get(frame.streamId);
        if (!state || state.closed) return;
        const bytes = Buffer.byteLength(raw);
        if (state.bytes + bytes > this.maxQueueBytes) {
          state.queue = [{ type: 'error', carrier: true, error: { message: 'Native view exceeded its queue budget; reconnect this view' } }];
          state.bytes = 0; state.closed = true;
          socket.send(JSON.stringify({ type: 'cancel', streamId: frame.streamId }));
        } else { state.queue.push(frame); state.bytes += bytes; }
        state.wake?.();
      });
      const lost = () => { for (const state of this.streams.values()) if (state.socket === socket) { state.closed = true; state.wake?.(); } };
      socket.on('close', lost); socket.on('error', lost);
      await once(socket, 'open');
      if (this.closed) { socket.terminate(); throw new Error('Native peer released'); }
    })().finally(() => { this.muxStarting = null; });
    return this.muxStarting;
  }
  async rpc(endpoint, payload) {
    this.assertEndpoint(endpoint); await this.ensureMux();
    const response = await this.fetch(`${this.origin}/api/${endpoint}`, {
      method: 'POST', headers: { Cookie: this.apiCookie, Origin: this.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Native RPC HTTP ${response.status}`);
    return (await response.json()).result;
  }
  async open(endpoint, payload) {
    this.assertEndpoint(endpoint); await this.ensureMux();
    if (this.streams.size >= 64) throw new Error('Too many native view streams');
    const id = randomUUID();
    this.streams.set(id, { queue: [], bytes: 0, closed: false, socket: this.mux });
    this.mux.send(JSON.stringify({ type: 'open', streamId: id, endpoint, payload }));
    return { id };
  }
  async read(id) {
    const state = this.streams.get(id);
    if (!state) throw new Error('Unknown native view stream');
    if (state.reading) throw new Error('Concurrent readers for one native stream');
    state.reading = true;
    try {
      if (!state.queue.length && !state.closed) await new Promise(resolve => {
        const timer = setTimeout(done, 1000);
        function done() { clearTimeout(timer); state.wake = null; resolve(); }
        state.wake = done;
      });
      const frames = state.queue.splice(0, 100);
      state.bytes = state.queue.reduce((n, frame) => n + Buffer.byteLength(JSON.stringify(frame)), 0);
      return { frames, closed: state.closed && !state.queue.length };
    } finally { state.reading = false; }
  }
  send(id, type, value) {
    const state = this.streams.get(id);
    if (!state || state.closed || state.socket !== this.mux || this.mux.readyState !== this.WebSocket.OPEN) throw new Error('Inactive native stream');
    this.mux.send(JSON.stringify({ type, streamId: id, ...(value === undefined ? {} : { value }) }));
    return { sent: true };
  }
  closeStream(id) {
    const state = this.streams.get(id);
    if (state?.socket.readyState === this.WebSocket.OPEN) state.socket.send(JSON.stringify({ type: 'cancel', streamId: id }));
    if (state) { state.closed = true; state.wake?.(); this.streams.delete(id); }
    return { closed: true };
  }
  close() {
    this.closed = true;
    for (const id of this.streams.keys()) this.closeStream(id);
    this.mux?.terminate();
  }
}
