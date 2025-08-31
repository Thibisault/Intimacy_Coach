let wakeLock = null;
export async function enableWakeLock(){
  try{
    if('wakeLock' in navigator){
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async()=>{
        if(document.visibilityState==='visible' && wakeLock?.released){
          try{ wakeLock = await navigator.wakeLock.request('screen'); }catch{}
        }
      });
      return true;
    }
  }catch(e){}
  return false;
}
export function disableWakeLock(){ try{ wakeLock?.release(); }catch{} wakeLock=null; }
