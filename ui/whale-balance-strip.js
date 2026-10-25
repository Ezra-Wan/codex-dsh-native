// Presentation adapter only. The original whale service owns fetching,
// authentication, balance semantics and caching; no model or task is started.
(() => {
  const strip=document.createElement('aside');strip.className='codex-dsh-balance';
  Object.assign(strip.style,{position:'absolute',right:'0',bottom:'64%',width:'max-content',maxWidth:'260px',padding:'7px 10px',borderRadius:'10px',background:'#18232fee',color:'#edf5ff',font:'12px/1.5 system-ui',whiteSpace:'pre-line',pointerEvents:'none'});
  strip.textContent='DSH 账户余额：正在读取…\n本轮费用：未接入';
  let timer,stopped=false,controller,last='';
  function attach(){const root=document.querySelector('.dshwv-root');if(root&&!strip.isConnected){root.append(strip);window.dispatchEvent(new Event('whale-shape-request'));}}
  const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});attach();
  async function refresh(){
    if(stopped)return;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/dsh-whale/balance.json',{signal:controller.signal});if(!response.ok)throw Error('balance unavailable');
      const balance=await response.json();if(stopped)return;
      if(!balance.ok)throw Error('balance unavailable');
      last=window.WhaleBalanceView.amount(balance,(v,c)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:4}).format(v));
      strip.textContent=`DSH 账户余额：${last}\n本轮费用：未接入`;strip.title=`账户合计，不归属单项任务；更新时间 ${balance.updatedAt??'未知'}`;
    }catch{if(!stopped)strip.textContent=`DSH 账户余额：${last?last+'（已过期）':'暂不可用'}\n本轮费用：未接入`;}
    finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(refresh,60000);}
  }
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);controller?.abort();observer.disconnect();strip.remove();},{once:true});
  refresh();
})();
