const $=id=>document.getElementById(id);
const screens=['home','pill-screen','input-screen','swallowing','waiting-screen','output-screen','failure-screen','story-screen','envelope-screen','letter-screen','receipt-gesture-screen','receipt-screen','care-screen'];
let act=0, input='', story=null, busy=false, transitionTimer=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let controller=null, generation=0, pendingDemo=null;
const shake=RegretShake.create();
let motionGranted=false, motionListening=false, sensorTimer=null, sensorSeen=false;
function motionTarget(){return !$('home').hidden?'home':!$('pill-screen').hidden?'pill':null;}
function motionHint(target,text){$(target==='home'?'bottle-hint':'pill-hint').textContent=text;}
function stopMotion(){window.removeEventListener('devicemotion',onMotion);motionListening=false;clearTimeout(sensorTimer);shake.reset();}
function onMotion(event){
  const target=motionTarget();if(document.hidden||!target||busy){shake.reset();return;}
  const vector=event.accelerationIncludingGravity;
  if(!vector||![vector.x,vector.y,vector.z].every(Number.isFinite))return;
  if(!sensorSeen){sensorSeen=true;clearTimeout(sensorTimer);motionHint(target,target==='home'?'摇一摇，取一颗。也可以轻点药瓶。':'摇一摇打开胶囊，也可以点它。');}
  if(shake.sample(vector,performance.now())){if(target==='home')dispense();else openPill();}
}
function startMotion(){
  const target=motionTarget();if(!target||document.hidden||motionListening||$('settings')?.open)return;
  const enable=$(target==='home'?'enable-shake':'enable-pill-shake');
  if(!window.isSecureContext||!window.DeviceMotionEvent){enable.hidden=true;motionHint(target,target==='home'?'轻点药瓶，取一颗。':'感应不可用，点胶囊打开。');return;}
  if(typeof DeviceMotionEvent.requestPermission==='function'&&!motionGranted){enable.hidden=false;motionHint(target,target==='home'?'开启摇一摇，或轻点药瓶取药。':'开启摇一摇，或点胶囊打开。');return;}
  enable.hidden=true;motionListening=true;sensorSeen=false;shake.reset();
  window.addEventListener('devicemotion',onMotion,{passive:true});
  sensorTimer=setTimeout(()=>{if(!sensorSeen)motionHint(target,target==='home'?'感应没有读数，轻点药瓶也能取药。':'感应没有读数，点胶囊也能打开。');},3000);
}
async function enableMotion(){
  if(!window.isSecureContext||!window.DeviceMotionEvent)return;
  try{motionGranted=await DeviceMotionEvent.requestPermission()==='granted';}catch{motionGranted=false;}
  if(motionGranted)startMotion();else{const target=motionTarget();if(target){$(target==='home'?'enable-shake':'enable-pill-shake').hidden=true;motionHint(target,target==='home'?'未开启感应，轻点药瓶。':'未开启感应，点胶囊打开。');}}
}
$('enable-shake').onclick=enableMotion;
$('enable-pill-shake').onclick=enableMotion;
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopMotion();stopFlip();stopReceiptGesture();if(!$('receipt-gesture-screen').hidden)$('receipt-gesture-hint').textContent='感应已暂停，请重新开启，或直接查看手机票据。';}else startMotion();});
window.addEventListener('pagehide',()=>{stopMotion();stopReceiptGesture();});
window.addEventListener('pageshow',startMotion);
const client=RNTClient;
let sessionId=null,result=null,latest=null,readOnly=false,pollTimer=null,imageTimer=null,elapsedTimer=null,flip=null,flipDone=0,flipSession=null,reportQueue=Promise.resolve(),recognition=null,imageDownloadUrl=null;
function status(text){$('generation-status').textContent=text;}
function stopFlip(){flip?.stop();flip=null;flipSession=null;}
function stopFlow(){stopReceiptGesture();clearTimeout(pollTimer);clearTimeout(imageTimer);clearInterval(elapsedTimer);stopFlip();recognition?.abort();recognition=null;controller?.abort();controller=null;}
function show(id){
  if(id==='pill-screen'){$('pill-screen').classList.remove('opening');$('pill').disabled=false;}
  screens.forEach(s=>$(s).hidden=s!==id);stopMotion();if(id==='home'||id==='pill-screen')startMotion();if(id!=='waiting-screen')stopFlip();if(id!=='receipt-gesture-screen')stopReceiptGesture();
  if(id!=='input-screen'&&recognition){recognition.abort();recognition=null;}
  $('reset').hidden=id==='home';window.scrollTo({top:0,behavior:'instant'});
  const title=$(id).querySelector('h1,h2');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
}
function cancelOld(){const id=sessionId;const cancel=id&&!readOnly&&latest?.state!=='done'&&latest?.state!=='error';sessionId=null;if(cancel)void client.api(`/sessions/${id}/cancel`,{method:'POST',body:{}}).catch(()=>{});}
function reset(){
  if(imageDownloadUrl){URL.revokeObjectURL(imageDownloadUrl);imageDownloadUrl=null;}$('download-image').hidden=true;
  generation++;stopFlow();cancelOld();input='';story=null;result=null;latest=null;readOnly=false;pendingDemo=null;
  $('care-copy').textContent='';$('letter-body').replaceChildren();$('receipt-body').replaceChildren();$('demo-choice').hidden=true;
  status('准备好写下你的那个如果');clearTimeout(transitionTimer);busy=false;act=0;
  $('home').classList.remove('dispensing');$('bottle').classList.remove('uncap');$('bottle').disabled=false;$('pill-screen').classList.remove('opening');$('pill').disabled=false;
  $('regret-form').reset();$('counter').textContent='0 / 1000';$('error').hidden=true;$('saved').hidden=true;
  $('mic').textContent='说出来';$('flip-start').disabled=false;
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);show('home');
}
function dispense(){if(busy||$('home').hidden)return;busy=true;stopMotion();if(navigator.vibrate)navigator.vibrate(20);$('bottle').disabled=true;$('enable-shake').hidden=true;$('home').classList.add('dispensing');$('bottle').classList.add('uncap');$('bottle-hint').textContent='这一颗，给你的那个如果。';transitionTimer=setTimeout(()=>{show('pill-screen');busy=false;},reduced?10:1250)}
function openPill(){
  if(busy||$('pill-screen').hidden)return;busy=true;stopMotion();$('pill').disabled=true;
  $('pill-screen').classList.add('opening');$('pill-hint').textContent='胶囊打开了。写下那个「如果」。';
  if(navigator.vibrate)navigator.vibrate(20);
  transitionTimer=setTimeout(()=>{show('input-screen');busy=false;},reduced?10:760);
}
$('bottle').onclick=dispense;$('pill').onclick=openPill;
function inputError(message){$('error').textContent=message;$('error').hidden=false;}
$('regret').oninput=()=>{if(pendingDemo){cancelOld();pendingDemo=null;$('demo-choice').hidden=true;}$('counter').textContent=`${$('regret').value.length} / 1000`;$('error').hidden=true;};
document.querySelector('[data-back]').onclick=()=>show('pill-screen');
function fail(message){clearTimeout(pollTimer);clearInterval(elapsedTimer);$('failure-copy').textContent=message;show('failure-screen');$('retry-session').hidden=!sessionId;status('体验暂停 · 你的输入仍在');}
function beginElapsed(){clearInterval(elapsedTimer);const started=Date.now();$('loading-copy').textContent='正在写这条路上的生活，通常需要一到两分钟。';elapsedTimer=setInterval(()=>{$('loading-copy').textContent=`正在写三幕和最后的信 · 已等待 ${Math.floor((Date.now()-started)/1000)} 秒`;},1000);}
$('regret-form').onsubmit=async event=>{
  event.preventDefault();const text=$('regret').value.trim();if(!text||text.length>1000){inputError('写下你的选择，最多 1000 字。');return;}
  generation++;stopFlow();cancelOld();readOnly=false;result=null;latest=null;pendingDemo=null;input=text;
  const ticket=generation;controller=new AbortController();$('demo-choice').hidden=true;$('error').hidden=true;show('swallowing');beginElapsed();status('正在展开这条路上的生活…');
  try{
    const s=await client.api('/sessions',{method:'POST',body:{},signal:controller.signal});
    if(ticket!==generation){void client.api(`/sessions/${s.sessionId}/cancel`,{method:'POST',body:{}}).catch(()=>{});return;}
    sessionId=s.sessionId;latest=s;
    await client.api(`/sessions/${sessionId}/generate`,{method:'POST',body:{text},signal:controller.signal});
    if(ticket===generation)poll(ticket);
  }catch(error){if(ticket!==generation)return;clearInterval(elapsedTimer);show('input-screen');inputError(error.message);status('生成未完成 · 你的输入仍在');}
};
async function poll(ticket){
  clearTimeout(pollTimer);const id=sessionId;if(!id||ticket!==generation)return;
  try{
    const s=await client.api(`/sessions/${id}`,{signal:controller?.signal});if(ticket!==generation||id!==sessionId)return;
    handleSession(s);
    if(['created','generating','await_action','printing','encapsulating'].includes(s.state))pollTimer=setTimeout(()=>poll(ticket),1200);
  }catch(error){if(ticket===generation)fail(error.message);}
}
function handleSession(s){
  latest=s;
  if(s.state!=='generating'&&s.state!=='created')clearInterval(elapsedTimer);
  if(s.state==='await_demo'){
    pendingDemo=s;show('input-screen');inputError('真实生成没有完成。可重试，或明确选择体验预写案例。');$('demo-choice').hidden=false;status('尚未生成你的故事');return;
  }
  if(s.state==='await_action'){showWaiting(s);return;}
  if(s.state==='printing'||s.state==='encapsulating'){
    const isCapsule=s.state==='encapsulating';
    $('output-title').textContent=isCapsule?'把这段人生，装进一颗药。':'让这段人生，落到纸上。';
    $('output-copy').textContent=s.simulated?(isCapsule?'正在模拟封装，不会出实体胶囊。':'正在模拟打印，不会出实体小票。'):(isCapsule?'等待装置确认封装与出仓，请勿伸手进入出仓口。':s.delivery==='receipt'?'打印机正在输出三幕小票。':'正在打印胶囊里的文字纸带。');
    $('output-screen').dataset.phase=s.state;if($('output-screen').hidden)show('output-screen');status(s.simulated?'无硬件 · 模拟交付':'实体装置正在工作');return;
  }
  if(s.state==='done'){
    clearTimeout(pollTimer);result=s;
    if(s.kind==='care'){$('care-copy').textContent=(s.acts||[]).map(a=>a.detail||a.caption).join('\n\n');status('关怀回应 · 不打印、不分享');show('care-screen');return;}
    acceptResult(s);catchUpImages(generation);return;
  }
  if(s.state==='error'){clearTimeout(pollTimer);fail(s.error||'这次体验未完成，请重新开始。');$('retry-session').hidden=true;}
}
$('demo-choice').onclick=async()=>{
  if(!pendingDemo||!sessionId)return;const id=sessionId,ticket=generation;$('demo-choice').disabled=true;
  try{const s=await client.api(`/sessions/${id}/accept-demo`,{method:'POST',body:{}});if(ticket!==generation)return;pendingDemo=null;$('demo-choice').hidden=true;handleSession(s);poll(ticket);}
  catch(error){if(ticket===generation)inputError(error.message);}finally{$('demo-choice').disabled=false;}
};
function paintWaiting(s){
  const done=Math.max(s.action?.done||0,flipDone),moves=s.action?.moves||[];
  $('action-text').textContent=done>=moves.length?'动作完成，等待装置响应…':`${moves[done]==='L'?'向左':'向右'}翻，再回到中间`;
  $('action-progress').textContent=`${done} / ${moves.length}`;
  $('action-dots').replaceChildren(...moves.map((move,i)=>{const dot=document.createElement('i');dot.classList.toggle('current',i<done);return dot;}));
}
function showWaiting(s){
  if($('waiting-screen').hidden){show('waiting-screen');flipDone=s.action?.done||0;}
  paintWaiting(s);
  $('waiting-note').textContent=s.deviceConnected?(s.delivery==='capsule'?'已连接胶囊装置 · 完成翻转后打印、封装，再出药。':'已连接打印机 · 完成翻转后交付小票。'):'没有实体设备 · 可用手机翻转，或体验模拟交付。';
  $('simulate').hidden=!!s.deviceConnected;$('flip-start').hidden=!RNTFlip.canUseFlip();
  if(flipSession!==s.sessionId){$('flip-start').disabled=false;$('flip-start').textContent='拿起手机，开始翻转';}
  status(s.kind==='demo'?'预写案例演示 · 不是根据输入实时生成':'模型生成完成 · 翻转解锁');
}
$('flip-start').onclick=async()=>{
  const s=latest,id=sessionId,ticket=generation;if(!s?.action||!id)return;
  stopFlip();flipSession=id;const detector=RNTFlip.createFlipDetector(s.action.moves,Math.max(s.action.done,flipDone));flip=detector;
  $('flip-start').disabled=true;
  detector.onProgress(done=>{
    if(ticket!==generation||id!==sessionId)return;flipDone=done;paintWaiting(latest);
    reportQueue=reportQueue.catch(()=>{}).then(async()=>{if(ticket!==generation||id!==sessionId)return;
      try{const updated=await client.api(`/sessions/${id}/flip-progress`,{method:'POST',body:{done}});if(ticket===generation&&id===sessionId)handleSession(updated);}
      catch(error){if(ticket===generation){stopFlip();$('flip-start').disabled=false;$('waiting-note').textContent=error.message;}}
    });
  });
  detector.onWrong((_actual,expected)=>{$('action-text').textContent=`这次往${expected==='L'?'左':'右'}，先把手机放回中间`;});
  const ok=await detector.start();
  if(ticket!==generation||id!==sessionId||flip!==detector){detector.stop();return;}
  if(!ok){stopFlip();$('waiting-note').textContent='未开启翻转感应。没有设备时可选择模拟；有设备请工作人员检查。';$('flip-start').disabled=false;}
  else $('flip-start').textContent='按提示翻转手机';
};
$('simulate').onclick=async()=>{
  const id=sessionId,ticket=generation;if(!id||latest?.deviceConnected)return;$('simulate').disabled=true;
  try{const s=await client.api(`/sessions/${id}/simulate-action`,{method:'POST',body:{}});if(ticket===generation)handleSession(s);}
  catch(error){if(ticket===generation)$('waiting-note').textContent=error.message;}finally{$('simulate').disabled=false;}
};
$('retry-session').onclick=()=>{if(sessionId){controller=new AbortController();show('swallowing');poll(generation);}};
$('failure-back').onclick=()=>{const value=input;reset();$('regret').value=value;$('counter').textContent=`${value.length} / 1000`;show('input-screen');};
function enrichImages(s){for(const a of s.acts||[])a.displayImage=(s.imageReadyActs||[]).includes(a.index)?`/api/sessions/${s.sessionId}/images/${a.index}`:a.imageUrl;return s;}
function acceptResult(s){
  result=enrichImages(s);story={titles:s.acts.map((a,i)=>a.heading||['那条路，真的开始了。','日子接着往下走。',s.title][i]),scenes:s.acts.map(a=>a.detail||a.caption),letter:s.letter||'这是预写演示，没有生成属于你的来信。'};
  $('delivery-note').textContent=s.delivery==='capsule'?'装置已确认胶囊出仓 · 展示道具，不可吞食':s.delivery==='receipt'?'三幕小票已打印':'手机模拟体验 · 没有真实打印或出药';
  status(s.kind==='demo'?'预写案例演示 · 与输入不一定相关':'模型生成 · 虚构的可能性');
  act=0;renderAct();
}
function renderImage(){
  const a=result?.acts?.[act];if(!a)return;const image=$('act-image');
  image.onerror=()=>{image.onerror=null;image.src=client.asset(a.imageUrl||`/img/act-${a.index}.png`);$('image-note').textContent='预置插画';};
  image.src=client.asset(a.displayImage||a.imageUrl);image.alt=`第${a.index}幕插画`;
  $('image-note').textContent=(result.imageReadyActs||[]).includes(a.index)?'生成插画 · 热敏纸质感':'预置插画';
}
async function catchUpImages(ticket){
  clearTimeout(imageTimer);if(!result||result.imageStatus!=='pending')return;const id=result.sessionId,started=Date.now();
  async function check(){if(ticket!==generation||Date.now()-started>120000)return;
    try{const s=await client.api(`/sessions/${id}`);if(ticket!==generation)return;result=enrichImages(s);if(!$('story-screen').hidden)renderImage();if(!$('receipt-screen').hidden)renderReceipt();if(s.imageStatus==='pending')imageTimer=setTimeout(check,2500);}catch{}}
  imageTimer=setTimeout(check,2500);
}
function renderAct(){
  $('chapter').textContent=['第一幕 · 开始','第二幕 · 日常','第三幕 · 后来'][act];document.querySelectorAll('.progress i').forEach((e,i)=>e.classList.toggle('current',i<=act));
  $('origin').hidden=!input;$('origin').textContent=input?`你说：「${input}」`:'';$('story-title').textContent=story.titles[act];$('narrative').textContent=story.scenes[act];renderImage();
  $('next').textContent=act===2?'还有一封信 ↗':'看看后来 →';$('prev').hidden=act===0;show('story-screen');
}
$('next').onclick=()=>{if(act<2){act++;renderAct();}else show('envelope-screen');};$('prev').onclick=()=>{if(act>0){act--;renderAct();}};
$('open-letter').onclick=()=>{$('letter-body').replaceChildren();const p=document.createElement('p');p.textContent=story.letter;$('letter-body').append(p);$('letter-source').textContent=result.kind==='demo'?'预写案例没有平行时间线来信':'寄件人：另一条时间线里的你';show('letter-screen');};
$('save').onclick=()=>{RNTCapture.download(new Blob([`给现在的我：\n\n${story.letter}\n\n另一个你\n\n${result.disclaimer}\n${$('generation-status').textContent}`],{type:'text/plain;charset=utf-8'}),'另一个你寄来的信.txt');$('saved').textContent='信已保存。';$('saved').hidden=false;};
function renderReceipt(){
  const wrap=$('receipt-body');wrap.replaceChildren();const title=document.createElement('h2');title.textContent=result.title;wrap.append(title);
  for(const a of result.acts){const section=document.createElement('section'),heading=document.createElement('h3'),image=document.createElement('img'),p=document.createElement('p');heading.textContent=`第${a.index}幕 · ${a.heading||a.name}`;image.src=client.asset(a.displayImage||a.imageUrl);image.alt=`第${a.index}幕插画`;image.onerror=()=>{image.onerror=null;image.src=client.asset(a.imageUrl);};p.textContent=a.caption;section.append(heading,image,p);wrap.append(section);}
  const ending=document.createElement('p');ending.textContent=result.ending;wrap.append(ending);
  document.querySelector('.share-block').hidden=!result.sessionId;
  $('copy-share').hidden=!result.sessionId;
  if(result.sessionId){$('qr-image').src=client.asset(`/api/sessions/${result.sessionId}/qr.png`);$('share-link').value=result.shareUrl||`${location.origin}/#/r/${result.sessionId}`;}
  $('receipt-notice').textContent=result.kind==='demo'?'预写演示案例，不是根据输入实时生成。':result.disclaimer+' 分享结果默认保留 24 小时，链接需能访问项目服务。';
}
/* This reveal affects only the phone preview, never session print authorization. */
let receiptTimer=null,receiptDetector=null,receiptSeen=false;
function stopReceiptGesture(){window.removeEventListener('deviceorientation',onReceiptOrientation);clearTimeout(receiptTimer);receiptDetector=null;}
function onReceiptOrientation(event){
  if(document.hidden||$('receipt-gesture-screen').hidden||!receiptDetector)return;
  const {beta,gamma}=event;if(![beta,gamma].every(Number.isFinite))return;
  if(!receiptSeen){receiptSeen=true;clearTimeout(receiptTimer);}
  const action=receiptDetector.sample(beta,gamma,performance.now());
  if(action==='down'){$('receipt-gesture-hint').textContent='背面已识别。现在把屏幕翻回来。';if(navigator.vibrate)navigator.vibrate(25);}
  if(action==='complete'){if(navigator.vibrate)navigator.vibrate([20,40,20]);revealReceipt('sensor');}
}
function revealReceipt(via){stopReceiptGesture();if(!result)return;$('receipt-screen').dataset.reveal=via;renderReceipt();show('receipt-screen');}
$('view-receipt').onclick=()=>{
  const supported=!!(window.isSecureContext&&window.DeviceOrientationEvent);
  $('receipt-gesture-hint').textContent=supported?'屏幕朝下停一秒，再翻回来，票据就会展开。':'当前连接无法读取翻面感应，可直接查看手机票据。';
  $('receipt-sensor').hidden=!supported;
  $('receipt-sensor').disabled=false;
  show('receipt-gesture-screen');
};
$('receipt-sensor').onclick=async()=>{
  const ticket=generation;$('receipt-sensor').disabled=true;
  let allowed=true;
  if(typeof DeviceOrientationEvent.requestPermission==='function'){
    try{allowed=await DeviceOrientationEvent.requestPermission()==='granted';}catch{allowed=false;}
  }
  if(ticket!==generation||$('receipt-gesture-screen').hidden)return;
  if(!allowed){$('receipt-gesture-hint').textContent='感应未开启；可直接查看手机票据。';$('receipt-sensor').disabled=false;return;}
  stopReceiptGesture();receiptDetector=RNTFaceDown.create();receiptSeen=false;
  window.addEventListener('deviceorientation',onReceiptOrientation,{passive:true});
  $('receipt-gesture-hint').textContent='感应已开启。屏幕朝下停一秒，再翻回来。';
  $('receipt-sensor').textContent='重新开始识别';$('receipt-sensor').disabled=false;
  receiptTimer=setTimeout(()=>{if(!receiptSeen)$('receipt-gesture-hint').textContent='未收到姿态读数；请用 HTTPS 或直接查看手机票据。';},3500);
};
$('receipt-direct').onclick=()=>revealReceipt('tap');
$('receipt-gesture-back').onclick=()=>show('letter-screen');
$('receipt-back').onclick=()=>show('letter-screen');
$('save-image').onclick=async()=>{
  const ticket=generation,s=result;$('save-image').disabled=true;
  try{const file=await RNTCapture.save(s);if(ticket!==generation){URL.revokeObjectURL(file.url);return;}
    if(imageDownloadUrl)URL.revokeObjectURL(imageDownloadUrl);imageDownloadUrl=file.url;
    $('download-image').href=file.url;$('download-image').download=file.name;$('download-image').hidden=false;
    $('receipt-status').textContent='长图已准备好。若未自动保存，请点下载。';
  }catch(error){if(ticket===generation)$('receipt-status').textContent=error.message;}finally{$('save-image').disabled=false;}
};
$('copy-share').onclick=async()=>{const url=$('share-link').value;try{await navigator.clipboard.writeText(url);$('receipt-status').textContent='链接已复制；其他手机需要能访问这台电脑的服务。';}catch{$('share-link').focus();$('share-link').select();$('receipt-status').textContent='请复制上方链接。';}};
async function route(){
  const match=location.hash.match(/^#\/r\/([\w-]{4,})$/);if(!match)return;
  generation++;stopFlow();cancelOld();readOnly=true;input='';story=null;result=null;const ticket=generation;show('swallowing');$('loading-copy').textContent='正在取出这段平行人生…';
  try{const s=await client.api(`/sessions/${match[1]}/result`);if(ticket!==generation)return;sessionId=s.sessionId;latest=s;acceptResult(s);catchUpImages(ticket);}catch(error){if(ticket===generation)fail(error.message);}
}
async function probe(){
  $('offline-demo').hidden=true;
  try{const h=await client.probe();$('connection-status').textContent=h.mockLlm?'演示模式':h.hasServerKey||client.get('apiKey')?'已连接':'待设置模型';$('connection-status').title=`模型：${client.get('model')||h.model}`;
    const d=await client.api('/demo/cases');$('examples').replaceChildren(...d.cases.map(c=>{const b=document.createElement('button');b.type='button';b.className='example';b.textContent=c.label;b.onclick=()=>{$('regret').value=c.input;$('regret').oninput();};return b;}));
  }catch{$('connection-status').textContent='连接设置';$('offline-demo').hidden=false;}
}
$('offline-demo').onclick=async()=>{
  try{
    const response=await fetch('/regret-remedy/demo-cases.json');const cases=await response.json();
    $('offline-choices').replaceChildren(...cases.map(c=>{const b=document.createElement('button');b.className='example';b.textContent=c.label;b.onclick=()=>{generation++;stopFlow();cancelOld();readOnly=false;input='';acceptResult(c);};return b;}));
    $('offline-choices').hidden=false;
  }catch{$('connection-status').textContent='演示资源未加载，请检查连接';}
};
client.setupSettings(async()=>{if(sessionId&&!readOnly&&latest?.state!=='done')reset();await probe();});
const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
$('mic').hidden=!Speech;$('mic').onclick=()=>{
  if(recognition){recognition.stop();return;}const rec=new Speech();recognition=rec;rec.lang='zh-CN';rec.interimResults=false;$('mic').textContent='正在听…';
  rec.onresult=e=>{if(recognition!==rec||$('input-screen').hidden)return;$('regret').value=e.results[0][0].transcript.slice(0,1000);$('regret').oninput();};
  rec.onerror=()=>inputError('暂时无法识别，请用键盘写下。');rec.onend=()=>{if(recognition===rec)recognition=null;$('mic').textContent='说出来';};
  try{rec.start();}catch{recognition=null;inputError('语音输入不可用，请用键盘写下。');}
};
$('regret').addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter')$('regret-form').requestSubmit();});
document.querySelector('.wordmark').onclick=event=>{event.preventDefault();reset();};
document.addEventListener('rnt:settings-open',()=>{stopMotion();stopFlip();stopReceiptGesture();});
document.addEventListener('rnt:settings-close',startMotion);
$('care-again').onclick=reset;$('again').onclick=reset;$('reset').onclick=reset;window.addEventListener('hashchange',route);
startMotion();void probe();void route();
if(new URLSearchParams(location.search).get('settings')==='1')document.querySelector('[data-settings]').click();
