import {sleep} from './util.js';

function findBestVoice(langPrefs=[], nameRegexes=[]){
  const voices = speechSynthesis.getVoices() || [];
  // exact match
  for(const code of langPrefs){
    const v = voices.find(v=>v.lang && v.lang.toLowerCase()===code.toLowerCase());
    if(v) return v;
  }
  // prefix match (e.g., fr-*, zh-*)
  for(const code of langPrefs){
    const prefix = code.split('-')[0].toLowerCase();
    const v = voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(prefix));
    if(v) return v;
  }
  // name heuristics
  for(const rx of nameRegexes){
    const v = voices.find(v=>rx.test(v.name) || (v.voiceURI && rx.test(v.voiceURI)));
    if(v) return v;
  }
  // last resort
  return voices[0] || null;
}

export function pickVoices(prefs={}){
  const voices = speechSynthesis.getVoices() || [];
  // helper to find by URI or name
  function byId(id){
    if(!id) return null;
    return voices.find(v=>v.voiceURI===id || v.name===id) || null;
  }
  const zhLangPrefs = ['zh-CN','cmn-Hans-CN','zh-Hans','zh','yue-HK','zh-TW','cmn-Hant-TW','zh-Hant'];
  const frLangPrefs = ['fr-FR','fr-CH','fr-BE','fr-CA','fr'];
  const zhNameHeur = [/Chinese|Mandarin|普通话|粤语/i, /Ting[- ]?Ting|Xiao|Liang|Mei/i, /Google.*(中文|中國|粤语|普通话)/i];
  const frNameHeur = [/French|Français/i, /Am[eé]lie|Thomas|Audrey|Aurelie|Sophie|Virginie|Fabienne|Nicolas|Jean|Yannick|Louise/i, /Google.*fran/i];

  function findBestVoice(langPrefs=[], nameRegexes=[], prefId=null){
    const vPref = byId(prefId); if(vPref) return vPref;
    // exact lang
    for(const code of langPrefs){
      const v = voices.find(v=>v.lang && v.lang.toLowerCase()===code.toLowerCase()); if(v) return v;
    }
    // prefix lang
    for(const code of langPrefs){
      const p = code.split('-')[0].toLowerCase();
      const v = voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(p)); if(v) return v;
    }
    // name heuristics
    for(const rx of nameRegexes){
      const v = voices.find(v=>rx.test(v.name) || (v.voiceURI && rx.test(v.voiceURI))); if(v) return v;
    }
    return voices[0] || null;
  }
  const zh = findBestVoice(zhLangPrefs, zhNameHeur, prefs.zh);
  const fr = findBestVoice(frLangPrefs, frNameHeur, prefs.fr);
  return { zh, fr, zhLang: (zh?.lang || 'zh-CN'), frLang: (fr?.lang || 'fr-FR') };
}

export function speak(text, voice, langHint){
  return new Promise((resolve)=>{
    if(!text){ resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if(voice) u.voice = voice;
    u.lang = (voice && voice.lang) ? voice.lang : (langHint || 'en-US');
    // optional: slower zh on some engines sounds clearer
    if(/^zh/i.test(u.lang)) u.rate = 0.95;
    u.onend=()=>resolve();
    u.onerror=()=>resolve();
    speechSynthesis.speak(u);
  });
}

export function interruptAndSpeakCNFR(queue, zhText, frText, voices){
  try{ queue.cancel(); }catch{}
  try{ speechSynthesis.cancel(); }catch{}
  try{ speechSynthesis.resume(); }catch{}
  queue.paused=false;
  queue.enqueueCNFR(zhText, frText, voices);
}
export class SpeechQueue{
  constructor(){ this.queue=[]; this.running=false; this.paused=false; }
  enqueueCNFR(zhText, frText, voices){
    if(zhText) this.queue.push(()=>speak(zhText, voices.zh, voices.zhLang));
    if(frText) this.queue.push(()=>speak(frText, voices.fr, voices.frLang));
    this._run();
  }
  async _run(){
    if(this.running) return; this.running=true;
    while(this.queue.length){
      if(this.paused){ await sleep(80); continue; }
      const fn=this.queue.shift();
      await fn();
      await sleep(80);
    }
    this.running=false;
  }
  pause(){ this.paused=true; speechSynthesis.pause(); }
  resume(){ this.paused=false; speechSynthesis.resume(); }
  cancel(){ this.queue.length=0; speechSynthesis.cancel(); }
}
