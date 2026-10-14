/* Shared by the single experience: settings, health and same-origin API requests. */
window.RNTClient=(()=>{
  const get=k=>{try{return localStorage.getItem(`rnt.${k}`)||'';}catch{return '';}};
  const set=(k,v)=>{try{v?localStorage.setItem(`rnt.${k}`,v):localStorage.removeItem(`rnt.${k}`);}catch{}};
  let health=null;
  function base(){return get('integratedApiBase')||location.origin;}
  async function api(path,{method='GET',body,signal}={}){
    const timeout=new AbortController();const abort=()=>timeout.abort();signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();const timer=setTimeout(abort,20000);
    try{
      const headers=body?{'Content-Type':'application/json'}:{};
      // Never inherit an old query-string apiBase as a destination for credentials.
      for(const [key,name] of [['apiKey','Api-Key'],['model','Model'],['baseUrl','Base-Url'],['imageModel','Image-Model']]){
        const value=get(key);if(value)headers[`X-Stepfun-${name}`]=value;
      }
      const response=await fetch(`${base()}/api${path}`,{method,headers,body:body?JSON.stringify(body):undefined,signal:timeout.signal});
      if(!response.headers.get('content-type')?.includes('json'))throw new Error('未连接项目服务，请检查连接设置。');
      const data=await response.json();if(!response.ok)throw new Error(data.error||`请求失败（${response.status}）`);return data;
    }catch(error){if(error.name==='AbortError')throw new Error('连接超时或请求已取消，请重试。');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function probe(){health=await api('/health');return health;}
  function asset(url){return url?.startsWith('/api/')?base()+url:new URL(url||'/img/act-1.png',location.origin).href;}
  function setupSettings(onSave){
    const dialog=document.getElementById('settings');let opener=null;
    const fields=['apiKey','model','baseUrl','imageModel','integratedApiBase'];
    function open(event){opener=event?.currentTarget||document.activeElement;
      for(const key of fields)document.getElementById(`setting-${key}`).value=get(key);
      document.getElementById('setting-model').placeholder=health?.model||'使用服务端默认模型';
      document.getElementById('setting-imageModel').placeholder=health?.imageModel||'使用服务端默认插画模型';
      document.getElementById('setting-integratedApiBase').placeholder=location.origin;
      document.getElementById('settings-status').textContent=health?.hasServerKey?'电脑服务已配置密钥，留空即可使用。':'留空使用电脑服务配置，也可以在此设置。';
      dialog.showModal();document.dispatchEvent(new Event('rnt:settings-open'));document.getElementById('setting-model').focus();
    }
    document.querySelectorAll('[data-settings]').forEach(button=>button.onclick=open);
    document.getElementById('close-settings').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{opener?.focus();document.dispatchEvent(new Event('rnt:settings-close'));});
    document.getElementById('settings-form').onsubmit=async event=>{
      event.preventDefault();
      for(const key of ['baseUrl','integratedApiBase']){
        const value=document.getElementById(`setting-${key}`).value.trim();
        if(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();}
          catch{document.getElementById('settings-status').textContent='地址需要是完整的 http:// 或 https:// 地址。';return;}}
      }
      for(const key of fields)set(key,document.getElementById(`setting-${key}`).value.trim().replace(['baseUrl','integratedApiBase'].includes(key)?/\/+$/ : /$^/,''));
      dialog.close();await onSave();
    };
    return {open};
  }
  return {get,api,probe,base,asset,setupSettings};
})();
