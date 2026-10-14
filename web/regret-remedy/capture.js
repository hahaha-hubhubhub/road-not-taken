window.RNTCapture=(()=>{
  const load=src=>new Promise(resolve=>{const image=new Image();const timer=setTimeout(()=>resolve(null),10000);image.crossOrigin='anonymous';image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);resolve(null);};image.src=src;});
  function lines(ctx,text,width){const result=[];for(const paragraph of String(text||'').split('\n')){let line='';for(const character of paragraph){if(line&&ctx.measureText(line+character).width>width){result.push(line);line='';}line+=character;}result.push(line);}return result;}
  async function save(s){
    const width=750,pad=60;const measuring=document.createElement('canvas').getContext('2d');const commands=[];let y=64;
    const text=(value,size=27,color='#25292b')=>{measuring.font=`${size}px sans-serif`;for(const line of lines(measuring,value,width-pad*2)){commands.push({line,size,color,y});y+=size*1.65;}y+=18;};
    text('没走的路 / 后悔药',20,'#686f72');text(s.title,39);
    text(s.kind==='demo'?'预写演示案例 · 不是根据输入实时生成':'模型生成 · 虚构的可能性',20,'#686f72');
    for(const a of s.acts||[]){
      text(`第${a.index}幕 · ${a.heading||a.name}`,27,'#304fe8');
      const image=await load(RNTClient.asset(a.displayImage||a.imageUrl));
      if(image){const h=Math.min(330,(width-pad*2)*image.height/image.width);const w=h*image.width/image.height;commands.push({image,x:(width-w)/2,y,w,h});y+=h+24;}
      text(a.detail||a.caption);
    }
    text(s.ending,26);if(s.letter){text('寄件人：另一条时间线里的你',22,'#686f72');text(s.letter);}
    text(s.disclaimer||'这是模型生成的虚构故事，不是人生预测。',19,'#686f72');
    if(s.sessionId){const qr=await load(RNTClient.asset(`/api/sessions/${s.sessionId}/qr.png`));if(qr){commands.push({image:qr,x:275,y,w:200,h:200});y+=230;}text('分享链接依赖项目服务，结果默认保留 24 小时。',18,'#686f72');}
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.ceil(y+40);
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f1f3f2';ctx.fillRect(0,0,width,canvas.height);ctx.textBaseline='top';
    for(const c of commands){if(c.image)ctx.drawImage(c.image,c.x,c.y,c.w,c.h);else{ctx.font=`${c.size}px sans-serif`;ctx.fillStyle=c.color;ctx.fillText(c.line,pad,c.y);}}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片保存失败，请重试。');
    const name=`没走的路-${s.sessionId||'demo'}.png`;
    return {url:download(blob,name,true),name};
  }
  function download(blob,name,retain=false){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();if(!retain)setTimeout(()=>URL.revokeObjectURL(url),5000);return url;}
  return {save,download};
})();
