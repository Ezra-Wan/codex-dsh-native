// Carrier only. The official frontend owns every DSH component and state store.
import { App } from '@modelcontextprotocol/ext-apps';
import { createNativeMcpRpc } from './native-mcp-rpc.mjs';
const app=new App({name:'DSH original frontend via MCP',version:'1'}, {}, {autoResize:false});
const call=async(name,args)=>{
  const result=await app.callServerTool({name,arguments:args});
  if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text??'MCP transport failed');
  return result._meta?.payload;
};
async function signal(event,detail='') {try{await call('native_ui_signal',{event,detail:String(detail).slice(0,1000)});}catch{}}
window.addEventListener('error',e=>{void signal('error',e.message);});
window.addEventListener('unhandledrejection',e=>{void signal('rejection',e.reason?.message??e.reason);});
window.addEventListener('securitypolicyviolation',e=>{void signal('csp',e.violatedDirective+': '+e.blockedURI);});
await app.connect();
document.getElementById('dsh-mcp-status').textContent='MCP 已连接，正在加载 DSH 原版前端…';
document.documentElement.style.height='600px';
document.body.style.height='600px';
document.body.style.overflow='hidden';
await app.sendSizeChanged({height:600});
globalThis.__DSH_TRANSPORT__={
  // This page does not own the external runtime: never assert ownsHost=true.
  rpc:createNativeMcpRpc(call),
  loadBundle:async url=>{
    const {code}=await call('native_asset',{path:url});
    const script=document.createElement('script');script.textContent=code;document.head.appendChild(script);script.remove();
  },
};
for(const encoded of globalThis.__DSH_MCP_BATCHES__??[]){
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const script=document.createElement('script');script.textContent=code;document.head.appendChild(script);script.remove();
}
delete globalThis.__DSH_MCP_BATCHES__;
globalThis.__DSH_MCP_READY__.resolve();
await signal('mcp-carrier-ready');
// Observe whether upstream mounted visible text. This is diagnostic evidence,
// never a replacement for the user's visible acceptance of the native UI.
let last='';
const observer=new MutationObserver(()=>{
  const text=document.getElementById('root')?.innerText??'';
  if(text&&text!==last){last=text;clearTimeout(globalThis.__dshReportTimer);globalThis.__dshReportTimer=setTimeout(()=>{document.getElementById('dsh-mcp-status')?.remove();void signal('upstream-dom-text',text.slice(0,900));},500);}
});
observer.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
