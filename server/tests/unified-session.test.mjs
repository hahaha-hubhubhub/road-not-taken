import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
process.env.IMAGE_API_KEY='';
process.env.SIMULATED_PRINT_MS='10';
const {default:express}=await import('express');
const {sessionStore}=await import('../dist/sessions/store.js');
const {activateSession,getPublicView,completeAction,finishPrint,finishCapsule}=await import('../dist/sessions/service.js');
const {apiRouter}=await import('../dist/sessions/routes.js');
const {bus}=await import('../dist/bus.js');
const story={title:'先修好这辆车',scenes:[1,2,3].map(i=>({caption:'你把自行车修好，再擦去手上的油。',heading:`第${i}次试骑`,detail:'你把自行车扶住，重新调整车轮。客人问什么时候修好，你让他再等一会儿，转动踏板听了听声音。',image_prompt:'黑白自行车修理店'})),letter:'这是另一时间线的来信。',ending:'明天再修一辆。',disclaimer:'虚构故事'};
function pending(){const s=sessionStore.create();sessionStore.patch(s.id,{state:'await_demo',story,kind:'demo',degraded:true,input:'不进入公开视图的原文',note:'不进入公开视图的诊断'});return s;}
test('public session preserves detailed acts and letter, excludes original input and provider diagnostics',()=>{
 const view=getPublicView(pending());assert.equal(view.letter,story.letter);assert.equal(view.acts[0].detail,story.scenes[0].detail);assert.equal(view.acts[0].heading,story.scenes[0].heading);assert.equal(view.input,undefined);assert.equal(view.note,undefined);
});
test('fallback requires acceptance before actions/dispatch; cancelled or duplicate activation cannot print',()=>{
 const s=pending();let dispatched=0;const onReady=ready=>{if(ready.id===s.id)dispatched++;};bus.on('session:ready',onReady);
 try{assert.equal(completeAction(s.id,'demo'),false);assert.equal(s.authorizedPrint,false);assert.equal(dispatched,0);
 assert.equal(activateSession(s.id),true);assert.equal(dispatched,1);assert.equal(s.state,'await_action');assert.equal(activateSession(s.id),false);
 sessionStore.patch(s.id,{state:'error'});assert.equal(completeAction(s.id,'demo'),false);finishPrint(s.id);finishCapsule(s.id);assert.equal(s.state,'error');}
 finally{/* The bus has no unsubscribe API; listener only observes this unique session. */}
});
test('unified API rejects premature shared results and duplicate acceptance; reopening/cancelling done preserves result',async()=>{
 const app=express();app.use(express.json());app.use('/api',apiRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
 const post=path=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 try{const s=pending();assert.equal((await fetch(`${base}/sessions/${s.id}/result`)).status,409);
 assert.equal((await post(`/sessions/${s.id}/accept-demo`)).status,200);assert.equal((await post(`/sessions/${s.id}/accept-demo`)).status,409);
 assert.equal((await post(`/sessions/${s.id}/simulate-action`)).status,200);await new Promise(r=>setTimeout(r,60));assert.equal(s.state,'done');
 const result=await (await fetch(`${base}/sessions/${s.id}/result`)).json();assert.equal(result.letter,story.letter);assert.equal(result.input,undefined);
 await post(`/sessions/${s.id}/cancel`);assert.equal(s.state,'done');
 const care=sessionStore.create();sessionStore.patch(care.id,{state:'done',kind:'care',story});assert.equal((await fetch(`${base}/sessions/${care.id}/result`)).status,409);assert.equal((await fetch(`${base}/sessions/${care.id}/qr.png`)).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
