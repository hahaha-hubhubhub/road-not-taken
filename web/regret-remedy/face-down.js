/* A local-only, two-phase gesture: hold screen down, then return it face up.
   No orientation samples are stored or sent to the server. */
(function(root){
  function create({holdMs=650,maxGapMs=450}={}){
    let phase='waiting',downSince=null,lastAt=null;
    function reset(){phase='waiting';downSince=null;lastAt=null;}
    function sample(beta,gamma,now){
      if(![beta,gamma,now].every(Number.isFinite)||phase==='complete')return null;
      if(lastAt!==null&&(now<lastAt||now-lastAt>maxGapMs))reset();
      lastAt=now;
      const down=Math.abs(beta)>=145&&Math.abs(gamma)<35;
      const up=Math.abs(beta)<35&&Math.abs(gamma)<35;
      if(phase==='waiting'){
        if(down){if(downSince===null)downSince=now;
          if(now-downSince>=holdMs){phase='return';return 'down';}}
        else downSince=null;
      }else if(up){phase='complete';return 'complete';}
      return null;
    }
    return {sample,reset,get phase(){return phase;}};
  }
  root.RNTFaceDown={create};
})(typeof window==='undefined'?globalThis:window);
