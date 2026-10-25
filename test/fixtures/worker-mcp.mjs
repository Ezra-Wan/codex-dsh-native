// Offline protocol fixture. No DSH, provider, service or model is started.
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const path=process.env.FAKE_WORKER_STATE;
const read=async()=>JSON.parse(await readFile(path,'utf8').catch(()=>'{"items":[],"starts":0}'));
const save=state=>writeFile(path,JSON.stringify(state));
const server=new McpServer({name:'offline-worker-fixture',version:'1'});
const add=(name,inputSchema,handler)=>server.registerTool(name,{inputSchema},async args=>{
  try{return{content:[{type:'text',text:JSON.stringify(await handler(args))}]};}
  catch(e){return{isError:true,content:[{type:'text',text:e.message}]};}
});
const id={agent_id:z.string()};
add('dsh_start',{task:z.string(),cwd:z.string(),name:z.string().optional(),issue_id:z.string(),permission:z.string().optional(),model:z.string().optional(),provider:z.string().optional(),effort:z.string().optional()},async args=>{
  const state=await read(),row={agent_id:randomUUID(),name:args.name,status:'running',answer:'WORKER_OK',review:{issue_id:args.issue_id,revision_round:0}};
  state.items.push(row);state.starts++;
  const lost=process.env.FAKE_WORKER_LOST_ACK==='once'&&!state.lost;
  if(lost)state.lost=true;
  await save(state);
  if(lost)process.exit(23);
  return row;
});
add('dsh_status',id,async args=>(await read()).items.find(row=>row.agent_id===args.agent_id));
add('dsh_wait',{...id,seconds:z.number().optional()},async args=>{
  const state=await read(),row=state.items.find(row=>row.agent_id===args.agent_id);
  if(row.status==='running')row.status='completed';await save(state);
  return{...row,wait_outcome:'settled',finish_reason:{kind:row.status==='completed'?'completed':'interrupted'}};
});
add('dsh_list',{match:z.string().optional(),limit:z.number().optional(),max_chars:z.number().optional()},async({match})=>({items:(await read()).items.filter(row=>!match||row.name.includes(match))}));
add('dsh_followup',{...id,task:z.string()},async args=>{const state=await read(),row=state.items.find(row=>row.agent_id===args.agent_id);if(row.review.verdict!=='revise')throw Error('Review revise is required');row.status='running';row.answer='FOLLOWUP_OK';row.review.revision_round++;await save(state);return row;});
add('dsh_interrupt',id,async args=>{const state=await read(),row=state.items.find(row=>row.agent_id===args.agent_id);row.status='interrupted';await save(state);return row;});
add('dsh_review',{...id,verdict:z.string(),feedback:z.string()},async args=>{const state=await read(),row=state.items.find(row=>row.agent_id===args.agent_id);row.review={...row.review,...args};await save(state);return row.review;});
add('dsh_events',{...id,after:z.union([z.number(),z.string()]),limit:z.number(),max_chars:z.number(),include_progress:z.boolean(),include_tool_events:z.boolean(),include_descendants:z.boolean()},async()=>({items:[{type:'tool/call',name:'read_file',text:'fixture.txt'}],next_cursor:'opaque:next'}));
await server.connect(new StdioServerTransport());
