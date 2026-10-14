/* 手机上的动作识别：翻面、吹气、长按。
   传感器与麦克风读数只在浏览器内存里过一遍，不落盘、不上传、不发往服务端。 */
(function(root){
  /* 翻面：手机屏幕朝上放平时重力 z≈+9.8，翻过去屏幕朝下时 z≈-9.8。
     所以「z 掉到 -7 以下并保持一小会儿」就是翻了面。 */
  function createFlip(options){
    const config=options||{};
    const falling=Number.isFinite(config.falling)?config.falling:-7.2;
    const holdMs=Number.isFinite(config.holdMs)?config.holdMs:140;
    let since=0, fired=false;
    function reset(){since=0;fired=false;}
    function sample(vector,now){
      if(fired||!vector||!Number.isFinite(vector.z)||!Number.isFinite(now))return false;
      if(vector.z>falling){since=0;return false;}
      if(!since)since=now;
      if(now-since>=holdMs){fired=true;return true;}
      return false;
    }
    return {sample,reset};
  }

  /* 长按：到 ms 算完成；提前撒手算取消。进度 0→1 交给调用方画。 */
  function createHold(target,options){
    const config=options||{};
    const ms=Number.isFinite(config.ms)?config.ms:1600;
    let startedAt=0, frame=0, active=false, done=false;
    function paint(p){if(config.onProgress)config.onProgress(Math.max(0,Math.min(1,p)));}
    function tick(){
      if(!active)return;
      const p=(performance.now()-startedAt)/ms;
      paint(p);
      if(p>=1){active=false;done=true;if(config.onDone)config.onDone();return;}
      frame=requestAnimationFrame(tick);
    }
    function down(event){
      if(active||done)return;
      if(event&&event.button!==undefined&&event.button!==0&&event.pointerType==='mouse')return;
      active=true;
      startedAt=performance.now();
      if(event&&event.pointerId!==undefined&&target.setPointerCapture){try{target.setPointerCapture(event.pointerId);}catch{}}
      if(config.onStart)config.onStart();
      paint(0);
      frame=requestAnimationFrame(tick);
    }
    function cancel(){
      if(!active)return;
      active=false;cancelAnimationFrame(frame);paint(0);
      if(config.onCancel)config.onCancel(performance.now()-startedAt);
    }
    target.addEventListener('pointerdown',down);
    target.addEventListener('pointerup',cancel);
    target.addEventListener('pointercancel',cancel);
    target.addEventListener('pointerleave',cancel);
    return {
      reset(){cancel();done=false;paint(0);},
      dispose(){this.reset();target.removeEventListener('pointerdown',down);target.removeEventListener('pointerup',cancel);target.removeEventListener('pointercancel',cancel);target.removeEventListener('pointerleave',cancel);}
    };
  }

  /* 吹气：对着麦克风吹，波形是持续的高能量噪声。
     用 RMS 超过阈值并维持 sustain 毫秒来判定，读一次算一次。 */
  async function createBlow(options){
    const config=options||{};
    const threshold=Number.isFinite(config.threshold)?config.threshold:0.2;
    const sustain=Number.isFinite(config.sustain)?config.sustain:240;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('no-microphone');
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('no-audio-context');
    const context=new Context();
    if(context.state==='suspended'&&context.resume)await context.resume();
    const analyser=context.createAnalyser();
    analyser.fftSize=1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer=new Uint8Array(analyser.fftSize);
    let over=0, fired=false, stopped=false, timer=0, peak=0;
    function loop(){
      if(stopped)return;
      analyser.getByteTimeDomainData(buffer);
      let sum=0;
      for(let i=0;i<buffer.length;i++){const v=(buffer[i]-128)/128;sum+=v*v;}
      const rms=Math.sqrt(sum/buffer.length);
      if(rms>peak)peak=rms;
      if(config.onLevel)config.onLevel(rms);
      const now=performance.now();
      if(rms>threshold){
        if(!over)over=now;
        if(now-over>=sustain){fired=true;stop();if(config.onBlow)config.onBlow();return;}
      }else over=0;
      timer=setTimeout(loop,50);
    }
    function stop(){
      if(stopped)return;
      stopped=true;clearTimeout(timer);
      stream.getTracks().forEach(t=>t.stop());
      if(context.close)context.close().catch(()=>{});
    }
    loop();
    return {stop,get peak(){return peak;},get fired(){return fired;}};
  }

  root.RegretGestures={createFlip,createHold,createBlow};
})(typeof window==='undefined'?globalThis:window);
