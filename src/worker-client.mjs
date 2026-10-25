import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

export class WorkerRequestError extends Error {
  constructor(message, mayHaveRun = false) { super(message); this.mayHaveRun = mayHaveRun; }
}
const clean = error => String(error?.message ?? error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/([?&](?:token|api_key|key)=)[^&\s]+/gi, '$1[redacted]').slice(0,2000);
const required = ['dsh_start','dsh_status','dsh_wait','dsh_events','dsh_followup','dsh_interrupt','dsh_review','dsh_list'];

// Resolve at first use so installed worker upgrades keep their configured
// launcher. Never edit its config, installation, credentials or daemon.
export async function workerLaunchConfig({ configPath = process.env.CODEX_DSH_WORKER_CONFIG ?? join(process.env.CODEX_HOME ?? join(homedir(),'.codex'),'config.toml'), serverName = process.env.CODEX_DSH_WORKER_SERVER ?? 'deepseek_worker', env = process.env } = {}) {
  let document;
  try { document = parse(await readFile(configPath,'utf8'),{unsafeKeyBehaviour:'throw'}); }
  catch { throw new WorkerRequestError('Cannot read or parse the configured worker MCP configuration'); }
  const server = document.mcp_servers?.[serverName];
  if (!server || server.enabled === false) throw new WorkerRequestError('The configured worker MCP is absent or disabled');
  if (typeof server.command !== 'string' || !server.command || server.url) throw new WorkerRequestError('Worker fallback requires a configured STDIO MCP server');
  if (server.args !== undefined && (!Array.isArray(server.args) || !server.args.every(value=>typeof value==='string'))) throw new WorkerRequestError('Invalid worker launcher arguments');
  const forwarded = {};
  for (const entry of server.env_vars ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (typeof entry === 'object' && entry.source && entry.source !== 'local')) throw new WorkerRequestError('Unsupported worker environment forwarding');
    if (env[name] !== undefined) forwarded[name] = String(env[name]);
  }
  for (const [name,value] of Object.entries(server.env ?? {})) {
    if (typeof value !== 'string') throw new WorkerRequestError('Worker static environment values must be strings');
    forwarded[name] = value;
  }
  return { command:server.command, args:server.args ?? [], ...(server.cwd ? {cwd:server.cwd} : {}),
    env:{...getDefaultEnvironment(),...forwarded}, stderr:'pipe' };
}

// Standard MCP client, lazy and scoped. Closing this transport disconnects
// its proxy; it does not stop the retained worker daemon or other tasks.
export class WorkerMcpClient {
  constructor(options = {}) { this.options = options; this.closed = false; }
  async prepare() {
    if (this.closed) throw new WorkerRequestError('Worker adapter is closed');
    if (this.connection) return this.connection;
    if (!this.connecting) this.connecting = (async()=>{
      const config = await workerLaunchConfig(this.options);
      const client = new Client({name:'codex-native-worker-fallback',version:'1'});
      const transport = new StdioClientTransport(config);
      transport.stderr?.on('data',()=>{});
      try {
        await client.connect(transport,{timeout:30000});
        const {tools} = await client.listTools();
        for (const name of required) if (!tools.some(tool=>tool.name===name)) throw new Error(`Configured worker lacks ${name}`);
        const connection = {client,tools:new Map(tools.map(tool=>[tool.name,tool]))};
        client.onclose = ()=>{if(this.connection===connection)this.connection=null;};
        if (this.closed) throw new Error('Worker adapter was closed during connection');
        this.connection = connection;
        return connection;
      } catch(error) { await client.close().catch(()=>{}); throw new WorkerRequestError(clean(error)); }
    })().finally(()=>{this.connecting=null;});
    return this.connecting;
  }
  async capabilities() {
    const {tools} = await this.prepare(), schema = tools.get('dsh_start').inputSchema?.properties ?? {};
    return { outputCapField: 'maxTokens' in schema ? 'maxTokens' : 'max_tokens' in schema ? 'max_tokens' : null };
  }
  async startArguments(args) {
    const {tools} = await this.prepare(), fields = tools.get('dsh_start').inputSchema?.properties ?? {};
    const values = Object.fromEntries(Object.entries(args).filter(([,value])=>value!==undefined));
    if ('maxTokens' in values && !('maxTokens' in fields) && 'max_tokens' in fields) { values.max_tokens=values.maxTokens; delete values.maxTokens; }
    for (const key of Object.keys(values)) if (!(key in fields)) throw new WorkerRequestError(`Configured worker does not support ${key}; no task was sent`);
    return values;
  }
  async call(name,args = {}, { timeout = 60000, signal, mutating = false } = {}) {
    const {client} = await this.prepare();
    try {
      const result = await client.callTool({name,arguments:args},undefined,{timeout,signal});
      if (result.isError) throw new Error(result.content?.find(item=>item.type==='text')?.text ?? 'Worker tool failed');
      if (result.structuredContent) return result.structuredContent;
      const text = result.content?.find(item=>item.type==='text')?.text;
      if (!text) throw new Error('Worker returned no structured result');
      return JSON.parse(text);
    } catch(error) {
      // Once a mutation was sent, even a remote error may follow acceptance.
      // The caller must reconcile the stable submission marker, never replay.
      throw new WorkerRequestError(clean(error),mutating);
    }
  }
  async start(args) { return this.call('dsh_start',await this.startArguments(args),{mutating:true}); }
  status(agent_id) { return this.call('dsh_status',{agent_id}); }
  wait(agent_id,seconds=50,signal) { return this.call('dsh_wait',{agent_id,seconds},{timeout:Math.max(10000,(seconds+10)*1000),signal}); }
  followup(agent_id,task) { return this.call('dsh_followup',{agent_id,task},{mutating:true}); }
  stop(agent_id) { return this.call('dsh_interrupt',{agent_id},{timeout:60000,mutating:true}); }
  review(agent_id,verdict,feedback) { return this.call('dsh_review',{agent_id,verdict,feedback},{mutating:true}); }
  events(agent_id,after=0,limit=30) { return this.call('dsh_events',{agent_id,after:after===-1?0:after,limit,max_chars:12000,include_progress:false,include_tool_events:true,include_descendants:true}); }
  find(marker) { return this.call('dsh_list',{match:marker,limit:100,max_chars:50000}); }
  async close() { this.closed=true; await this.connecting?.catch(()=>{}); await this.connection?.client.close(); this.connection=null; }
}
