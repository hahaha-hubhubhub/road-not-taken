const $=id=>document.getElementById(id);
const screens=['home','pill-screen','input-screen','swallowing','story-screen','envelope-screen','letter-screen','care-screen'];
let act=0, input='', story=null, busy=false, transitionTimer=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let controller=null, generation=0, pendingDemo=null;
let exampleIntent=false, examplesReady=false;
const shake=RegretShake.create();
const flip=RegretGestures.createFlip();
let motionGranted=false, motionListening=false, motionMode=null, motionWant=null, sensorTimer=null, sensorSeen=false;
let shakeGate=0; // 刚摇过一次的冷静期，避免一次甩动被算成两下

function buzz(pattern){try{if(!navigator.vibrate)return;if(navigator.userActivation&&!navigator.userActivation.hasBeenActive)return;navigator.vibrate(pattern);}catch{}}
function sensorHint(text){const hint=$('bottle-hint');if(hint)hint.textContent=text;}

/* ---------------- 传感器：摇一摇取药 / 翻面咽药 / 摇一摇翻页 ----------------
   全部读数只在本地判断动作是否发生，不记录、不上传。没有传感器就退回点按。 */
function stopMotion(){window.removeEventListener('devicemotion',onMotion);motionListening=false;motionMode=null;clearTimeout(sensorTimer);shake.reset();flip.reset();}
function onMotion(event){
  const vector=event.accelerationIncludingGravity;
  if(!vector||![vector.x,vector.y,vector.z].every(Number.isFinite))return;
  const now=performance.now();
  if(!sensorSeen){sensorSeen=true;clearTimeout(sensorTimer);onSensorLive();}
  if(motionMode==='dispense'){if(now>=shakeGate&&shake.sample(vector,now)){shakeGate=now+1200;dispense();}}
  else if(motionMode==='flip'){if(flip.sample(vector,now))markSwallowed('flip');}
  else if(motionMode==='story'){if(now>=shakeGate&&shake.sample(vector,now)){shakeGate=now+1200;advanceAct();}}
}
function onSensorLive(){
  if(motionMode==='dispense')sensorHint('摇一摇。先倒一颗清醒。');
  else if(motionMode==='story')$('story-hint').hidden=false;
  else if(motionMode==='flip'&&!swallowReady)$('swallow-hint').textContent=swallowHint();
}
function swallowHint(){return motionListening?'翻个面。嫌麻烦就按住两秒。':'按住两秒。规矩不能坏。';}
function startMotion(mode){
  stopMotion();
  motionWant=mode||null;
  if(!motionWant)return;
  motionMode=motionWant;sensorSeen=false;
  if(motionMode==='story')$('story-hint').hidden=true;
  if(document.hidden||!window.isSecureContext||!window.DeviceMotionEvent){localFallback();return;}
  if(typeof DeviceMotionEvent.requestPermission==='function'&&!motionGranted){localFallback(true);return;}
  $('enable-shake').hidden=true;
  motionListening=true;
  window.addEventListener('devicemotion',onMotion,{passive:true});
  // 真机上传感器是连续上报的，几毫秒内就会有一条；等不到才降级成「按住」的说法
  sensorTimer=setTimeout(()=>{if(!sensorSeen)localFallback();},4000);
}
function localFallback(offerPermission){
  motionListening=false;
  if(motionMode==='dispense'){
    if(offerPermission&&$('home').hidden===false){$('enable-shake').hidden=false;sensorHint('感应没开。可以开，也可以直接点。');}
    else sensorHint('感应没上班。轻点药瓶也算。');
  }else if(motionMode==='flip'&&!swallowReady){
    $('swallow-hint').textContent='按住两秒。规矩不能坏。';
  }
}
$('enable-shake').onclick=async()=>{
  try{motionGranted=await DeviceMotionEvent.requestPermission()==='granted';}catch{motionGranted=false;}
  if(motionGranted){startMotion('dispense');sensorHint('摇一摇。先倒一颗清醒。');}
  else{$('enable-shake').hidden=true;sensorHint('感应不肯上班。点药瓶。');}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMotion();else startMotion(motionWant);});
window.addEventListener('pagehide',stopMotion);
window.addEventListener('pageshow',()=>startMotion(motionWant));

const getSetting=key=>{try{return localStorage.getItem(`rnt.${key}`)||''}catch{return ''}};
function status(text){$('generation-status').textContent=text;}
function acceptResult(result){
  const source=result.story;
  if(result.kind==='care'){
    $('care-copy').textContent=source.scenes.map(s=>s.caption).join('\n\n');
    status('关怀回应 · 未生成平行人生');show('care-screen');return;
  }
  story={titles:source.scenes.map((s,i)=>s.heading||['广告拍得不错','账单开始说话',source.title][i]),scenes:source.scenes.map(s=>s.detail||s.caption),letter:source.letter||'这是一份现成账单。不是你的专属来信。\n\n模型没开。先拿它看个样。'};
  status(result.kind==='story'?'模型现编。内容虚构':'现成案例。别当成你的命');
  act=0;renderAct();
}
function show(id){
  screens.forEach(s=>$(s).hidden=s!==id);
  if(id!=='envelope-screen')stopBlow();
  if(id==='home')startMotion('dispense');
  else if(id==='swallowing')startMotion('flip');
  else if(id==='story-screen')startMotion('story');
  else stopMotion();
  // 提示文案要在监听建立之后算，否则会说不出「翻个面」这条路
  if(id==='swallowing'&&!swallowReady)$('swallow-hint').textContent=swallowHint();
  if(id==='pill-screen')restorePill();
  $('reset').hidden=id==='home';
  window.scrollTo({top:0,behavior:'instant'});
  const title=$(id).querySelector('h1,h2');
  if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
}
function reset(){
  input='';story=null;$('care-copy').textContent='';$('letter-body').replaceChildren();
  generation++;controller?.abort();controller=null;pendingDemo=null;
  $('demo-choice').hidden=true;exampleIntent=false;clearExamplePressed(true);
  status('机器醒着。你可以后悔了');
  clearTimeout(transitionTimer);stopBlow();busy=false;act=0;pillTaps=0;swallowReady=false;swallowResult=null;
  $('home').classList.remove('dispensing');$('bottle').classList.remove('uncap');$('bottle').disabled=false;
  $('pill').classList.remove('melted','holding');$('pill').style.setProperty('--hold',0);pillHold?.reset();$('pill-hint').textContent='按住。先把滤镜化了。';
  $('swallow-hold').classList.remove('done','holding');$('swallow-hold').style.setProperty('--hold',0);
  $('regret-form').reset();$('counter').textContent='0 / 1000';$('error').hidden=true;$('saved').hidden=true;
  show('home');
}
function dispense(){if(busy||$('home').hidden)return;busy=true;stopMotion();$('bottle').disabled=true;$('home').classList.add('dispensing');$('bottle').classList.add('uncap');$('bottle-hint').textContent='药给你。滤镜留下。';buzz(24);transitionTimer=setTimeout(()=>{show('pill-screen');busy=false;},reduced?10:1250)}
$('bottle').onclick=dispense;

/* ---------------- 按住不放：把药丸化开 ----------------
   按满 1.6 秒才算化开。点一下就走的，提示两次后放行（键盘和辅助设备也走这条路）。 */
let pillTaps=0;
const pillHold=RegretGestures.createHold($('pill'),{
  ms:1600,
  onProgress(p){$('pill').style.setProperty('--hold',p.toFixed(3));$('pill').classList.toggle('holding',p>0);},
  onDone(){
    buzz(20);$('pill').classList.add('melted');
    transitionTimer=setTimeout(()=>{if(!$('pill-screen').hidden)show('input-screen');},reduced?0:420);
  },
  onCancel(heldFor){
    if($('pill-screen').hidden)return;
    if(heldFor>420){$('pill-hint').textContent='快了。手别先后悔。';return;}
    pillTaps++;
    if(pillTaps>=3){pillHold.reset();$('pill').classList.add('melted');transitionTimer=setTimeout(()=>{if(!$('pill-screen').hidden)show('input-screen');},reduced?0:300);return;}
    $('pill-hint').textContent='按住。一两秒就化。规矩不能坏。';
    buzz(8);
  }
});
document.querySelector('#pill .capsule').addEventListener('animationend',(event)=>{
  if(event.animationName==='pop')$('pill').classList.add('settled');
});
$('pill').addEventListener('click',(event)=>{
  // 键盘 Enter/Space 产生的 click 不带指针计数（detail 为 0），直接放行
  if(event.detail!==0||pillHoldDone())return;
  $('pill').classList.add('melted');
  transitionTimer=setTimeout(()=>{if(!$('pill-screen').hidden)show('input-screen');},0);
});
function pillHoldDone(){return $('pill').classList.contains('melted');}
/* 从输入页「先放回去」时，药丸得是完整的一颗，不能还留着化开的残影 */
function restorePill(){
  if(!pillHoldDone()&&!$('pill').classList.contains('holding'))return;
  $('pill').classList.remove('melted','holding');
  $('pill').style.setProperty('--hold',0);
  pillHold.reset();pillTaps=0;
  $('pill-hint').textContent='按住。先把滤镜化了。';
}

$('regret').oninput=()=>{pendingDemo=null;$('demo-choice').hidden=true;clearExamplePressed(true);$('counter').textContent=`${$('regret').value.length} / 1000`;$('error').hidden=true};
document.querySelector('[data-back]').onclick=()=>show('pill-screen');

/* ---------------- 吞药：翻个面，或者按住不放 ---------------- */
let swallowReady=false, swallowResult=null;
function beginSwallow(){
  swallowReady=false;swallowResult=null;
  $('swallow-hold').classList.remove('done','holding');$('swallow-hold').style.setProperty('--hold',0);
  $('swallow-hint').textContent=swallowHint();
}
function markSwallowed(how){
  if(swallowReady||$('swallowing').hidden)return;
  swallowReady=true;
  buzz(how==='flip'?[26,55,26]:[20,40,20]);
  $('swallow-hold').classList.add('done');
  $('swallow-hint').textContent=how==='flip'?'面翻了。滤镜也该翻。':'咽下去了。账单开印。';
  status('那条路开门了。账单在路上');
  flushSwallow();
}
function flushSwallow(){
  if(!swallowReady||!swallowResult)return;
  const result=swallowResult;swallowResult=null;
  acceptResult(result);
}
const swallowHold=RegretGestures.createHold($('swallow-hold'),{
  ms:2000,
  onProgress(p){$('swallow-hold').style.setProperty('--hold',p.toFixed(3));$('swallow-hold').classList.toggle('holding',p>0);},
  onDone(){markSwallowed('hold');},
  onCancel(heldFor){
    if($('swallowing').hidden||swallowReady)return;
    $('swallow-hint').textContent=heldFor>600?`差一点。按满两秒。${motionListening?'翻面也算。':''}`:swallowHint();
  }
});
$('swallow-hold').addEventListener('click',(event)=>{
  // 同上：只有键盘/辅助设备触发的 click（detail 为 0）才当一次「咽下」
  if(event.detail===0)markSwallowed('tap');
});

$('regret-form').onsubmit=async e=>{
  e.preventDefault();input=$('regret').value.trim();
  const viaExample=exampleIntent;exampleIntent=false;
  if(!input||input.length>1000){$('error').textContent='把事说清。最多 1000 字。';$('error').hidden=false;return;}
  const ticket=++generation;controller?.abort();controller=new AbortController();
  const active=controller;pendingDemo=null;$('demo-choice').hidden=true;
  beginSwallow();show('swallowing');status('广告播完。机器开始查账');
  const timeout=setTimeout(()=>active.abort(),240000);
  try{
    const headers={'Content-Type':'application/json'};
    for(const [setting,header] of [['apiKey','X-Stepfun-Api-Key'],['model','X-Stepfun-Model'],['baseUrl','X-Stepfun-Base-Url']]){const value=getSetting(setting);if(value)headers[header]=value;}
    // 凭据只发给当前同源项目服务，不跟随任意存储的 apiBase。
    const response=await fetch('/api/stories/preview',{method:'POST',headers,body:JSON.stringify({text:input}),signal:active.signal});
    const contentType=response.headers.get('content-type')||'';
    if(!contentType.includes('application/json'))throw new Error('这页开错地方了。请从项目服务进入。');
    const result=await response.json();
    if(ticket!==generation)return;
    if(!response.ok)throw new Error(result.error||'机器没算完。等会再来。');
    if(!result.story?.scenes||result.story.scenes.length!==3)throw new Error('账单少了一页。再算一次。');
    // 危机回应不走吞咽这一步，直接送到人面前
    if(result.kind==='care'){acceptResult(result);return;}
    if(result.kind==='demo'&&!viaExample){
      // 用户没自己点示例：先把现成案例挂住，停在输入页让他决定
      pendingDemo=result;swallowResult=null;show('input-screen');
      $('error').textContent='模型没干完。可以重试。也可以先看一份现成账单。';$('error').hidden=false;$('demo-choice').hidden=false;
      status('你的账没算出来。先别认领现成的');
      void loadExamples(true);
      return;
    }
    swallowResult=result;
    if(swallowReady)flushSwallow();
    else{status('那边已经开门。等你把药咽了');if(!motionListening)$('swallow-hint').textContent='按住两秒。规矩不能坏。';}
  }catch(error){
    if(ticket!==generation)return;
    swallowResult=null;show('input-screen');$('error').textContent=error.name==='AbortError'?'等太久了。机器也会卡。再来一次。':error.message;$('error').hidden=false;status('没算完。你写的东西还在');
  }finally{clearTimeout(timeout);if(ticket===generation)controller=null;}
};
$('demo-choice').onclick=()=>{if(pendingDemo)acceptResult(pendingDemo)};

/* ---------------- 演示模式的现成案例按钮 ----------------
   只有演示模式（/api/health 的 mockLlm）或真实生成降级时才出现；
   点一个 = 明确选择这个预写案例，直接给出故事，不再多要一次确认。 */
function clearExamplePressed(alsoHide){
  document.querySelectorAll('#example-list .example').forEach((b)=>b.setAttribute('aria-pressed','false'));
  if(alsoHide&&!examplesReady&&$('examples'))$('examples').hidden=true;
}
async function loadExamples(force){
  if(examplesReady||$('examples').hidden===false){$('examples').hidden=false;return;}
  try{
    const health=await (await fetch('/api/health')).json();
    // 真模型在线时不摆现成案例，免得盖过生成；只有降级（force）才无条件补上
    if(!health.mockLlm&&!force)return;
    const cases=(await (await fetch('/api/demo/cases')).json()).cases||[];
    const usable=cases.filter((c)=>c&&c.input);
    if(!usable.length)return;
    const wrap=$('example-list');wrap.replaceChildren();
    for(const item of usable){
      const button=document.createElement('button');
      button.type='button';button.className='example';
      button.textContent=item.label||item.input;button.title=item.input;
      button.setAttribute('aria-pressed','false');
      button.onclick=()=>useExample(item,button);
      wrap.appendChild(button);
    }
    examplesReady=true;$('examples').hidden=false;
  }catch{/* 服务没起来就照常手写，不挡路 */}
}
function useExample(item,button){
  if(busy)return;
  $('regret').value=item.input;
  $('regret').dispatchEvent(new Event('input')); // 先让 oninput 清一遍，再打上选中态
  clearExamplePressed(false);
  button.setAttribute('aria-pressed','true');
  exampleIntent=true;
  $('regret-form').dispatchEvent(new Event('submit',{cancelable:true}));
}
void loadExamples();
$('care-again').onclick=reset;

/* ---------------- 三幕：按钮翻页，摇一摇也能翻 ---------------- */
function renderAct(){$('chapter').textContent=['第一幕 · 广告片','第二幕 · 账单','第三幕 · 本人证词'][act];document.querySelectorAll('.progress i').forEach((e,i)=>e.classList.toggle('current',i<=act));$('origin').textContent=`你说：「${input}」`;$('story-title').textContent=story.titles[act];$('narrative').textContent=story.scenes[act];$('scene').dataset.act=act;$('next').innerHTML=act===2?'账算完了。拆信 <span>↗</span>':'继续。账还没算完 <span>→</span>';$('prev').hidden=act===0;show('story-screen');}
function advanceAct(){if(!story)return;buzz(16);if(act<2){act++;renderAct()}else show('envelope-screen')}
$('next').onclick=()=>advanceAct();$('prev').onclick=()=>{if(act>0){act--;renderAct()}};

/* ---------------- 拆信：吹一口气，或者点 ---------------- */
let blowSession=null;
function stopBlow(){if(blowSession){blowSession.stop();blowSession=null;}}
function openLetter(){
  if(!story)return;
  stopBlow();
  $('letter-body').replaceChildren();const p=document.createElement('p');p.textContent=story.letter;$('letter-body').append(p);
  show('letter-screen');
}
async function enableBlow(){
  $('enable-blow').disabled=true;$('enable-blow').textContent='正在打开麦克风…';
  try{
    blowSession=await RegretGestures.createBlow({onBlow:()=>{buzz(18);$('envelope-hint').textContent='开了。人还在。';openLetter();}});
    $('enable-blow').hidden=true;$('envelope-hint').textContent='对着手机上沿吹一口。让气流干活。';
    status('麦克风开了。吹一口');
  }catch{
    $('enable-blow').disabled=false;$('enable-blow').textContent='麦克风请假。点上面拆 ↗';
    $('envelope-hint').textContent='吹不了。点按钮也能拆。';
  }
}
$('open-letter').onclick=openLetter;
$('enable-blow').onclick=enableBlow;

$('save').onclick=()=>{const text=`给现在的我：\n\n关于你写下的「${input}」\n\n${story.letter}\n\n另一个你\n\n这是故意丑化的虚构故事。不是人生预测。${$('generation-status').textContent}`;const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='没走的路_那边来信.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('saved').textContent='带走了。下次脑补，先看账。';$('saved').hidden=false;};
$('again').onclick=reset;$('reset').onclick=reset;

/* 有能力就先把吹气拆信摆出来，做不到就只留按钮，并且别在文案里许一个做不到的愿 */
if(window.isSecureContext&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
  $('enable-blow').hidden=false;
}else{
  $('envelope-hint').textContent='麦克风没来。点开就行。';
}
startMotion('dispense');
