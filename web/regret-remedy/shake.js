/* Motion stays on the device; no sensor samples are stored or sent. */
(function(root){
  function create(){
    let previous=null, previousAt=0, peak=null, peakAt=0;
    function reset(){previous=null;previousAt=0;peak=null;peakAt=0;}
    function sample(vector,now){
      if(!vector||![vector.x,vector.y,vector.z,now].every(Number.isFinite))return false;
      const current=[vector.x,vector.y,vector.z];
      if(!previous||now-previousAt>1000||now<previousAt){previous=current;previousAt=now;peak=null;return false;}
      const delta=current.map((v,i)=>v-previous[i]);previous=current;previousAt=now;
      const strength=Math.hypot(...delta);
      if(strength<18)return false;
      if(peak&&now-peakAt<90)return false;
      if(peak&&now-peakAt<=800){
        const alignment=delta.reduce((sum,v,i)=>sum+v*peak[i],0)/(strength*Math.hypot(...peak));
        if(alignment<-.2){reset();return true;}
      }
      peak=delta;peakAt=now;return false;
    }
    return {sample,reset};
  }
  root.RegretShake={create};
})(typeof window==='undefined'?globalThis:window);
