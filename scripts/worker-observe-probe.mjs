// Read-only second-instance view of an existing wrapped worker task.
// No start/followup/interrupt/review tools or provider prompts are exposed.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {WorkerTasks} from '../src/worker-tasks.mjs';
import {registerNativeTaskUi,NATIVE_TASK_URI} from '../src/native-task-ui.mjs';

const root=process.env.DSH_WORKER_VIEW_ROOT;
if(!root)throw Error('Explicit isolated DSH_WORKER_VIEW_ROOT required');
const tasks=await new WorkerTasks({root,enabled:async()=>false}).init();
const server=new McpServer({name:'dsh-worker-observe-probe',version:'1'},{instructions:'Read-only existing worker view acceptance. Call show_worker_probe once, expand the card, and let the user judge its appearance. No model tasks or mutation tools are exposed; never claim visual acceptance yourself.'});
const ui=registerNativeTaskUi(server,{
  listTasks:()=>tasks.list(),resolveTask:async id=>tasks.summary(await tasks.read(id)),
  workerEvents:(id,after,limit)=>tasks.events(id,after,limit),
});
server.registerTool('show_worker_probe',{title:'旧 worker 兜底 · 只读验收',description:'Display existing worker status, final answer and real tool evidence in the production card. No model prompt, no new task.',inputSchema:{},_meta:{ui:{resourceUri:NATIVE_TASK_URI}}},async()=>({
  content:[{type:'text',text:'Read-only existing worker view. The user must judge the displayed evidence.'}],structuredContent:{items:await tasks.list()},
}));
let closing=false;
async function close(){if(closing)return;closing=true;ui.close();await tasks.close();await server.close();}
process.stdin.once('end',()=>void close());process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
await server.connect(new StdioServerTransport());
