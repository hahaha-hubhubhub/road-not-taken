const $=id=>document.getElementById(id);
const screens=['home','pill-screen','input-screen','swallowing','story-screen','envelope-screen','letter-screen','care-screen'];
let act=0, input='', story=null, busy=false, transitionTimer=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let controller=null, generation=0, pendingDemo=null;
const shake=RegretShake.create();
let motionGranted=false, motionListening=false, sensorTimer=null, sensorSeen=false;
function stopMotion(){window.removeEventListener('devicemotion',onMotion);motionListening=false;clearTimeout(sensorTimer);shake.reset();}
function onMotion(event){
  if(document.hidden||$('home').hidden||busy){shake.reset();return;}
  const vector=event.accelerationIncludingGravity;
  if(!vector||![vector.x,vector.y,vector.z].every(Number.isFinite))return;
  if(!sensorSeen){sensorSeen=true;clearTimeout(sensorTimer);$('bottle-hint').textContent='摇一摇，取一颗。也可以轻点药瓶。';}
  if(shake.sample(vector,performance.now()))dispense();
}
function startMotion(){
  if($('home').hidden||document.hidden||motionListening)return;
  if(!window.isSecureContext||!window.DeviceMotionEvent){$('bottle-hint').textContent='轻点药瓶，取一颗。';return;}
  if(typeof DeviceMotionEvent.requestPermission==='function'&&!motionGranted){$('enable-shake').hidden=false;$('bottle-hint').textContent='开启摇一摇，或轻点药瓶取药。';return;}
  $('enable-shake').hidden=true;motionListening=true;sensorSeen=false;
  window.addEventListener('devicemotion',onMotion,{passive:true});
  sensorTimer=setTimeout(()=>{if(!sensorSeen)$('bottle-hint').textContent='轻点药瓶也能取药；手机支持感应时可以摇一摇。';},2500);
}
$('enable-shake').onclick=async()=>{
  try{motionGranted=await DeviceMotionEvent.requestPermission()==='granted';}catch{motionGranted=false;}
  if(motionGranted)startMotion();else{$('enable-shake').hidden=true;$('bottle-hint').textContent='未开启感应，轻点药瓶也能取药。';}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMotion();else startMotion();});
window.addEventListener('pagehide',stopMotion);
window.addEventListener('pageshow',startMotion);
const getSetting=key=>{try{return localStorage.getItem(`rnt.${key}`)||''}catch{return ''}};
function status(text){$('generation-status').textContent=text;}
function acceptResult(result){
  const source=result.story;
  if(result.kind==='care'){
    $('care-copy').textContent=source.scenes.map(s=>s.caption).join('\n\n');
    status('关怀回应 · 未生成平行人生');show('care-screen');return;
  }
  story={titles:source.scenes.map((s,i)=>s.heading||['那条路，真的开始了。','日子接着往下走。',source.title][i]),scenes:source.scenes.map(s=>s.detail||s.caption),letter:source.letter||'这次是预写演示故事，没有生成属于你的来信。\n\n请配置真实模型后，再打开你的那个如果。'};
  status(result.kind==='story'?'模型生成 · 虚构的可能性':'预写案例演示 · 与你的输入不一定相关');
  act=0;renderAct();
}
function show(id){screens.forEach(s=>$(s).hidden=s!==id);if(id==='home')startMotion();else stopMotion();$('reset').hidden=id==='home';window.scrollTo({top:0,behavior:'instant'});const title=$(id).querySelector('h1,h2');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
function reset(){input='';story=null;$('care-copy').textContent='';$('letter-body').replaceChildren();generation++;controller?.abort();controller=null;pendingDemo=null;$('demo-choice').hidden=true;status('准备好写下你的那个如果');clearTimeout(transitionTimer);busy=false;act=0;$('home').classList.remove('dispensing');$('bottle').classList.remove('uncap');$('bottle').disabled=false;$('regret-form').reset();$('counter').textContent='0 / 1000';$('error').hidden=true;$('saved').hidden=true;show('home');}
function dispense(){if(busy||$('home').hidden)return;busy=true;stopMotion();$('bottle').disabled=true;$('home').classList.add('dispensing');$('bottle').classList.add('uncap');$('bottle-hint').textContent='这一颗，给你的那个如果。';transitionTimer=setTimeout(()=>{show('pill-screen');busy=false;},reduced?10:1250)}
$('bottle').onclick=dispense;
$('pill').onclick=()=>show('input-screen');
$('regret').oninput=()=>{pendingDemo=null;$('demo-choice').hidden=true;$('counter').textContent=`${$('regret').value.length} / 1000`;$('error').hidden=true};
document.querySelector('[data-back]').onclick=()=>show('pill-screen');
$('regret-form').onsubmit=async e=>{
  e.preventDefault();input=$('regret').value.trim();
  if(!input||input.length>1000){$('error').textContent='写下你的选择，最多 1000 字。';$('error').hidden=false;return;}
  const ticket=++generation;controller?.abort();controller=new AbortController();
  const active=controller;pendingDemo=null;$('demo-choice').hidden=true;
  show('swallowing');status('正在展开这条路上的生活…');
  const timeout=setTimeout(()=>active.abort(),240000);
  try{
    const headers={'Content-Type':'application/json'};
    for(const [setting,header] of [['apiKey','X-Stepfun-Api-Key'],['model','X-Stepfun-Model'],['baseUrl','X-Stepfun-Base-Url']]){const value=getSetting(setting);if(value)headers[header]=value;}
    // 凭据只发给当前同源项目服务，不跟随任意存储的 apiBase。
    const response=await fetch('/api/stories/preview',{method:'POST',headers,body:JSON.stringify({text:input}),signal:active.signal});
    const contentType=response.headers.get('content-type')||'';
    if(!contentType.includes('application/json'))throw new Error('请从项目服务的 /regret-remedy/ 打开此页面。');
    const result=await response.json();
    if(ticket!==generation)return;
    if(!response.ok)throw new Error(result.error||'生成未完成，请稍后再试。');
    if(!result.story?.scenes||result.story.scenes.length!==3)throw new Error('返回的故事不完整，请重试。');
    if(result.kind==='demo'){
      pendingDemo=result;show('input-screen');
      $('error').textContent='当前为演示模式，或真实生成未完成。可以重试；也可以明确选择查看预写案例。';$('error').hidden=false;$('demo-choice').hidden=false;
      status('尚未生成你的故事');return;
    }
    acceptResult(result);
  }catch(error){
    if(ticket!==generation)return;
    show('input-screen');$('error').textContent=error.name==='AbortError'?'等待超时，请重试。':error.message;$('error').hidden=false;status('生成未完成 · 你的输入仍在');
  }finally{clearTimeout(timeout);if(ticket===generation)controller=null;}
};
$('demo-choice').onclick=()=>{if(pendingDemo)acceptResult(pendingDemo)};
$('care-again').onclick=reset;
function renderAct(){$('chapter').textContent=['第一幕 · 开始','第二幕 · 日常','第三幕 · 后来'][act];document.querySelectorAll('.progress i').forEach((e,i)=>e.classList.toggle('current',i<=act));$('origin').textContent=`你说：「${input}」`;$('story-title').textContent=story.titles[act];$('narrative').textContent=story.scenes[act];$('scene').dataset.act=act;$('next').innerHTML=act===2?'旅程结束了吗？ <span>↗</span>':'看看后来 <span>→</span>';$('prev').hidden=act===0;show('story-screen');}
$('next').onclick=()=>{if(act<2){act++;renderAct()}else show('envelope-screen')};$('prev').onclick=()=>{if(act>0){act--;renderAct()}};
$('open-letter').onclick=()=>{$('letter-body').replaceChildren();const p=document.createElement('p');p.textContent=story.letter;$('letter-body').append(p);show('letter-screen')};
$('save').onclick=()=>{const text=`给现在的我：\n\n关于你写下的「${input}」\n\n${story.letter}\n\n另一个你\n\n此信来自虚构的平行人生体验，不是人生预测。${$('generation-status').textContent}`;const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='另一个你寄来的信.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('saved').textContent='信已保存。留给某个想再读一遍的日子。';$('saved').hidden=false;};
$('again').onclick=reset;$('reset').onclick=reset;
startMotion();
