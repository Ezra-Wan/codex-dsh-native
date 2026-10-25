import {networkInterfaces} from 'node:os';

// Interface presence is a local observation, never an Internet reachability
// test. Do not ping a third party, expose addresses, or replay model requests.
export function localNetworkSnapshot(){
  try{return {localInterfaceAvailable:Object.values(networkInterfaces()).flat().some(a=>a&&!a.internal&&!a.address.startsWith('169.254.')&&!a.address.toLowerCase().startsWith('fe80:')),internetReachable:null};}
  catch{return {localInterfaceAvailable:null,internetReachable:null};}
}
export function classifyFailure(error,{stage='provider',stopSource,finishReason,networkSnapshot=localNetworkSnapshot}={}){
  const base={stage,at:new Date().toISOString(),nextAction:'先核查原会话与产物；不要自动重发或切换后端。'};
  if(stopSource)return {...base,kind:stopSource==='controller_shutdown'?'controller_shutdown':'requested_stop',label:stopSource==='controller_shutdown'?'控制器关闭触发停止':'调用方请求停止',certainty:'confirmed',network:null};
  const nodes=[],seen=new Set();let current=error;
  for(let i=0;i<5&&current&&!seen.has(current);i++){nodes.push(current);seen.add(current);current=current.cause;}
  const message=nodes.map(e=>typeof e==='string'?e:e.message??'').join('\n');
  const codes=nodes.map(e=>e.code).filter(c=>typeof c==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(c));
  const known=/\b(ENETDOWN|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET)\b/;
  const code=codes.find(c=>known.test(c))??message.match(known)?.[1]??null;
  const rawStatus=nodes.map(e=>e.statusCode??e.status??e.response?.status).find(n=>Number.isInteger(n)&&n>=400&&n<=599);
  const httpStatus=rawStatus??(Number(message.match(/\bHTTP(?: status)?[:= ]+([45]\d\d)\b/i)?.[1])||null);
  if(httpStatus)return {...base,kind:httpStatus===429?'rate_limited':[401,403].includes(httpStatus)?'authentication':'provider_error',label:httpStatus===429?'服务端限流（HTTP 429）':[401,403].includes(httpStatus)?`服务端拒绝认证（HTTP ${httpStatus}）`:`服务端返回错误（HTTP ${httpStatus}）`,certainty:'confirmed',httpStatus,code,network:null};
  const networkError=!!code||/\b(fetch failed|connection error|network error|socket hang up|request timed? ?out)\b/i.test(message);
  if(networkError){
    let network;try{network=networkSnapshot();}catch{network={localInterfaceAvailable:null,internetReachable:null};}
    if(network.localInterfaceAvailable===false)return {...base,kind:'network_unavailable',label:'疑似本机断网（无可用网络接口）',certainty:'local-observation',code,network};
    const kind=['ENETDOWN','ENETUNREACH','EHOSTUNREACH'].includes(code)?'network_unreachable':['ENOTFOUND','EAI_AGAIN'].includes(code)?'dns_error':['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code)||/timed? ?out/i.test(message)?'request_timeout':'connection_lost';
    const label={network_unreachable:'网络路径不可达',dns_error:'域名解析失败',request_timeout:'请求超时（是否断网未确认）',connection_lost:'连接丢失（本机或服务端原因未确认）'}[kind];
    return {...base,kind,label,certainty:code?'reported-code':'reported-message',code,network};
  }
  if(['aborted','interrupted','closed'].includes(finishReason))return {...base,kind:'runtime_interrupted',label:'运行时中止（未确认是主动停止）',certainty:'reported-state',network:null};
  if(stage==='controller')return {...base,kind:'controller_lost',label:'原控制器已失联，任务状态待核实',certainty:'local-observation',network:null};
  if(['native_transport','worker_transport','view'].includes(stage)&&/connection (?:closed|lost)|transport|socket|EPIPE|ECONN|channel.*closed/i.test(message))return {...base,kind:'channel_lost',label:stage==='view'?'观察通道断开，执行状态未确认':'本地控制通道断开，执行状态待核实',certainty:'reported-message',network:null};
  return {...base,kind:'unclassified',label:'任务异常（原因未确认）',certainty:'unknown',network:null};
}
