import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleNativeRendering } from '../ui/native-render-evidence.mjs';

test('render evidence counts only original assistant rows intersecting the visible card, never status or hidden content', () => {
  const rect={top:0,left:0,bottom:600,right:700,width:700,height:600};
  const row=(key,text,streaming,box=rect)=>({dataset:{chatNodeKey:key},innerText:text,
    getBoundingClientRect:()=>box,querySelector:()=>streaming?{}:null});
  const rows=[row('hidden','not visible',true,{...rect,top:650,bottom:750}),row('live','正文第一段',true)];
  const root={innerText:'status may change without assistant text',
    getBoundingClientRect:()=>rect,querySelectorAll:selector=>{
      assert.equal(selector,'[data-chat-flow-kind="assistant-step"]');return rows;
    },querySelector:()=>null};
  const options={mode:'inline',doc:{hidden:false},now:()=>1,styleOf:()=>({visibility:'visible',display:'block'})};
  const first=sampleNativeRendering(root,options);
  assert.deepEqual(first.assistantRows,[{key:'live',chars:5,streaming:true}]);
  rows[1].innerText+='；正文继续增长';
  const next=sampleNativeRendering(root,options);
  assert.ok(next.assistantRows[0].chars>first.assistantRows[0].chars);
  assert.equal('text' in next.assistantRows[0],false,'diagnostics retain lengths, never transcript text');
  options.doc.hidden=true;
  assert.deepEqual(sampleNativeRendering(root,options).assistantRows,[],'a background document cannot prove visible streaming');
});
