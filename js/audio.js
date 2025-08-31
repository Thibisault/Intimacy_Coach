let ctx=null;
function getCtx(){ if(!ctx){ try{ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch{} } return ctx; }
export function beep(freq=880, durMs=120){
  const c = getCtx(); if(!c) return;
  const o = c.createOscillator(); const g=c.createGain();
  o.connect(g); g.connect(c.destination);
  o.type='sine'; o.frequency.value=freq;
  const t=c.currentTime; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.2,t+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001,t+durMs/1000);
  o.start(); o.stop(t+durMs/1000);
}
let keepAliveNode = null;
export function startAudioKeepAlive(){
  const c=getCtx(); if(!c || keepAliveNode) return;
  const o=c.createOscillator(); const g=c.createGain();
  o.connect(g); g.connect(c.destination); g.gain.value=0.00001;
  o.frequency.value=20; o.start(); keepAliveNode=o;
}
export function stopAudioKeepAlive(){ try{keepAliveNode?.stop();}catch{} keepAliveNode=null; }
