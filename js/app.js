import {applyI18n, dict, getIntensityName} from './i18n.js';
import {sleep, formatMMSS, themeClass, SEGMENTS} from './util.js';
import {loadSettings, saveSettings} from './storage.js';
import {beep, startAudioKeepAlive, stopAudioKeepAlive} from './audio.js';
import {SpeechQueue, pickVoices, interruptAndSpeakCNFR} from './tts.js';
import {enableWakeLock, disableWakeLock} from './wake-lock.js';
import {buildPlan, drawOne} from './planner.js';

/* ================= Motion helpers ================= */
const GSAP = typeof window !== 'undefined' ? window.gsap : null;
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const Motion = {
  heroAnim: null,
  startHero() {
    if (reduceMotion || !GSAP) return;
    const img = document.getElementById('action-image');
    if (!img) return;
    GSAP.set(img, { transformOrigin: '50% 50%' });
    this.heroAnim = GSAP.to(img, {
      scale: 1.08, xPercent: 2, yPercent: -2,
      duration: 12, yoyo: true, repeat: -1, ease: 'power1.inOut'
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.heroAnim) return;
      document.hidden ? this.heroAnim.pause() : this.heroAnim.resume();
    });
  },
  pauseHero(){ this.heroAnim?.pause(); },
  resumeHero(){ this.heroAnim?.resume(); },
  killHero(){ this.heroAnim?.kill(); this.heroAnim = null; },

  chipSelect(el){ if (!GSAP || reduceMotion) return; GSAP.from(el, { scale: 0.9, duration: .25, ease: 'back.out(2)' }); },

  sceneIn(){
    if (!GSAP || reduceMotion) return;
    const tl = GSAP.timeline();
    tl.from('#text-fr', { y: 12, opacity: 0, filter: 'blur(4px)', duration: .35, ease: 'power2.out' }, 0)
      .from('#text-zh', { y: 12, opacity: 0, filter: 'blur(4px)', duration: .35, ease: 'power2.out' }, .08);
  },

  glow(el){
    if (!GSAP || reduceMotion) return;
    GSAP.fromTo(el,
      { boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
      { boxShadow: '0 0 32px 0 color-mix(in oklab, var(--ring) 35%, transparent)', duration: .6, ease: 'power2.out' }
    );
  },

  progressTo(pct){
    if (!GSAP || reduceMotion) {
      document.getElementById('progress-bar').style.width = pct + '%';
      return;
    }
    GSAP.to('#progress-bar', { width: pct + '%', duration: .2, ease: 'power1.out' });
    const prog = document.querySelector('#progress');
    prog?.classList.add('flash');
    // petite impulsion du liseré lumineux
    const el = prog; if (!el) return;
    el.style.setProperty('--flash', '1');
    setTimeout(()=>{ el.style.removeProperty('--flash'); }, 150);
  }
};

/* ================= App logic ================= */
const DEFAULTS = {
  participants:{P1:'Homme', P2:'Femme'},
  sequence:[{segment:'L1',minutes:3},{segment:'L2',minutes:3},{segment:'L3',minutes:3},{segment:'L4',minutes:3},{segment:'L5',minutes:3},{segment:'SEXE',minutes:4}],
  ranges:{ L1:{min:15,max:30}, L2:{min:20,max:35}, L3:{min:20,max:40}, L4:{min:25,max:45}, L5:{min:25,max:50}, SEXE:{min:30,max:60}},
  cooldownSec:1,
  actorMode:'random',
  filters:{anal:true, hard:true, clothed:true},
  lang:'fr',
  voicePrefs:{ fr:null, zh:null }
};

let settings = Object.assign({}, DEFAULTS, loadSettings()||{});
let data = null;
let currentPlan = [];
let flatPlan = [];
let running=false, cancelled=false, paused=false;
let voices = {zh:null, fr:null};
const tts = new SpeechQueue();

applyI18n(settings.lang);
initTabs();
wireLangButtons();
initSettingsUI();
wirePlayUI();
initDrawTab();
loadData();
bootHeroAndSkeleton();

/* ===== Boot: image skeleton & hero animation ===== */
function bootHeroAndSkeleton(){
  const visual = document.getElementById('action-visual');
  const img = document.getElementById('action-image');
  if (!visual || !img) return;

  // remove skeleton when image decoded, then fade-in
  img.decode?.().catch(()=>{}).finally(()=>{
    visual.classList.remove('skeleton');
    if (GSAP && !reduceMotion) GSAP.from(visual, { opacity: 0, duration:.35, ease:'power1.out' });
  });

  Motion.startHero();

  // Parallaxe douce au pointeur (fallback simple)
  const apply = (x,y)=> { if (!GSAP || reduceMotion) return;
    GSAP.to(img, { xPercent: 2 + x*1.5, yPercent: -2 + y*1.5, duration:.3, overwrite:true });
  };
  document.getElementById('action-visual')?.addEventListener('pointermove', e=>{
    const r=e.currentTarget.getBoundingClientRect();
    const x=((e.clientX-r.left)/r.width - .5)*2;
    const y=((e.clientY-r.top)/r.height - .5)*2;
    apply(x,y);
  });
}

async function loadData(){
  try{
    const res = await fetch('./public/data.json?'+Date.now());
    data = await res.json();
  }catch(e){
    console.error('Failed to load data.json', e);
    alert('Erreur: data.json manquant. Voir README.');
  }
  refreshPlan();
}

function refreshPlan(){
  if(!data) return;
  currentPlan = buildPlan(settings, data);
  flatPlan = currentPlan.flat();
}

function initTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const currentTab = document.querySelector('.tabs .tab.active')?.dataset.tab;
      if(currentTab==='play' && running){
        paused=true; tts.pause();
        const toggle = document.getElementById('btn-toggle');
        toggle.textContent = dict[settings.lang]?.resume || 'Reprendre';
        toggle.classList.remove('secondary'); toggle.classList.add('primary');
        Motion.pauseHero();
      }
      document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      document.querySelectorAll('.tabpanel').forEach(p=>p.classList.remove('active'));
      document.getElementById('tab-'+id).classList.add('active');
      if(id==='settings'){
        document.querySelectorAll('#tab-settings details.accordion').forEach(d=>{ d.open = false; });
      }
      if(id==='draw'){ try{ tts.cancel(); speechSynthesis.cancel(); speechSynthesis.resume(); }catch{} }
    });
  });
}

function wireLangButtons(){
  const frBtn = document.getElementById('btn-fr');
  const zhBtn = document.getElementById('btn-zh');
  const setActive=(lang)=>{
    settings.lang=lang; 
    applyI18n(lang); 
    if (typeof window._refreshSequence==='function') window._refreshSequence();
    if (typeof window._refreshAddControls==='function') window._refreshAddControls();
    if (typeof window._refreshRanges==='function') window._refreshRanges();
    if (typeof window._refreshActorButtons==='function') window._refreshActorButtons();
    saveSettings(settings);
    frBtn.classList.toggle('active', lang==='fr');
    zhBtn.classList.toggle('active', lang==='zh');
    if(typeof initDrawTab?.refresh==='function') initDrawTab.refresh();
  };
  frBtn.onclick=()=>setActive('fr');
  zhBtn.onclick=()=>setActive('zh');
}

function initSettingsUI(){
  const p1=document.getElementById('inp-p1'), p2=document.getElementById('inp-p2');
  p1.value=settings.participants.P1; p2.value=settings.participants.P2;
  const amWrap = document.getElementById('actor-mode-buttons');

  function actorLabel(mode){
    const male = p1.value || 'Homme';
    const female = p2.value || 'Femme';
    if(settings.lang==='zh'){
      const map = {'random':'随机','female-male-both':`${female} → ${male} → 互相`,'just-female':`仅${female}`,'just-male':`仅${male}`,'just-both':`仅互相`};
      return map[mode];
    } else {
      const map = {'random':'Aléatoire','female-male-both':`${female} → ${male} → Mutuelle`,'just-female':`${female} seulement`,'just-male':`${male} seulement`,'just-both':`Mutuelle seulement`};
      return map[mode];
    }
  }

  window.drawActorButtons = function drawActorButtons(){
    amWrap.innerHTML='';
    ['random','female-male-both','just-female','just-male','just-both'].forEach(m=>{
      const b=document.createElement('button');
      b.type='button'; b.className='chip option' + (settings.actorMode===m?' active':'');
      b.textContent = actorLabel(m);
      b.onclick=()=>{ settings.actorMode=m; drawActorButtons(); saveSettings(settings); if (GSAP && !reduceMotion) Motion.chipSelect(b); };
      amWrap.appendChild(b);
    });
  }
  drawActorButtons();

  // Populate voice selects
  async function fillVoices(){
    await new Promise(res=>{
      const v = speechSynthesis.getVoices(); if(v?.length) return res();
      speechSynthesis.onvoiceschanged = ()=>res();
      speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      setTimeout(res, 400);
    });
    const vs = speechSynthesis.getVoices()||[];
    const frSel = document.getElementById('sel-voice-fr');
    const zhSel = document.getElementById('sel-voice-zh');
    function fill(sel, pref, langPrefix){
      sel.innerHTML='';
      const opt0=document.createElement('option'); opt0.value=''; opt0.textContent='Auto'; sel.appendChild(opt0);
      vs.filter(v=> (v.lang||'').toLowerCase().startsWith(langPrefix)).forEach(v=>{
        const o=document.createElement('option'); o.value=v.voiceURI||v.name; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o);
      });
      sel.value = pref || '';
    }
    fill(frSel, settings.voicePrefs?.fr||'', 'fr');
    fill(zhSel, settings.voicePrefs?.zh||'', 'zh');
    frSel.onchange=()=>{ settings.voicePrefs.fr = frSel.value || null; saveSettings(settings); };
    zhSel.onchange=()=>{ settings.voicePrefs.zh = zhSel.value || null; saveSettings(settings); };
  }
  fillVoices();
  window._refreshActorButtons = ()=>drawActorButtons();

  document.getElementById('def-anal').checked=settings.filters.anal;
  document.getElementById('def-hard').checked=settings.filters.hard;
  document.getElementById('def-clothed').checked=settings.filters.clothed;

  const seqList=document.getElementById('sequence-list');
  function redrawSequence(){
    seqList.innerHTML='';
    let dragIndex = null;

    settings.sequence.forEach((s,idx)=>{
      const row=document.createElement('div');
      row.className='row';
      row.draggable = true;
      row.dataset.index = idx;

      const handle = document.createElement('div');
      handle.className='drag-handle';
      handle.textContent='⋮⋮';

      const seg=document.createElement('div');
      seg.className='seg';
      seg.textContent=getIntensityName(s.segment, settings.lang);

      const minutesWrap = document.createElement('div');
      minutesWrap.className='input-affix';
      const min=document.createElement('input');
      min.type='number'; min.min='1'; min.value=s.minutes;
      const affix=document.createElement('span');
      affix.className='affix';
      affix.textContent = (dict[settings.lang]?.unit_min || 'min');
      minutesWrap.appendChild(min); minutesWrap.appendChild(affix);

      const del=document.createElement('button');
      del.textContent='✕';
      del.className='danger tiny';

      // events
      del.onclick=()=>{ settings.sequence.splice(idx,1); redrawSequence(); saveSettings(settings); };

      min.onchange=()=>{ s.minutes=Math.max(1, parseInt(min.value||'1',10)); saveSettings(settings); };

      row.addEventListener('dragstart', e=>{ dragIndex = idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); });
      row.addEventListener('dragover', e=>{
        e.preventDefault();
        const overIdx = parseInt(row.dataset.index,10);
        if(overIdx!==dragIndex){ row.classList.add('drop-target'); }
      });
      row.addEventListener('dragleave', ()=>row.classList.remove('drop-target'));
      row.addEventListener('drop', ()=>{
        row.classList.remove('drop-target');
        const toIdx = parseInt(row.dataset.index,10);
        if(dragIndex===null || dragIndex===toIdx) return;
        const [moved] = settings.sequence.splice(dragIndex,1);
        settings.sequence.splice(toIdx,0,moved);
        saveSettings(settings);
        redrawSequence();
      });

      row.append(handle, seg, minutesWrap, del);
      seqList.appendChild(row);
    });

    window._refreshSequence = redrawSequence;
  }
  redrawSequence();

  // --- Ajout d'une intensité via chips ---
  const addChipsCont = document.getElementById('add-seg-chips');
  let addSegCurrent = 'L1';
  function redrawAddControls(){
    addChipsCont.innerHTML='';
    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const b=document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.className = `intensity-chip ${cls}` + (addSegCurrent===seg?' active':'');
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick=()=>{ addSegCurrent=seg; redrawAddControls(); if (GSAP && !reduceMotion) Motion.chipSelect(b); };
      addChipsCont.appendChild(b);
    });
  }
  redrawAddControls();
  window._refreshAddControls = redrawAddControls;

  document.getElementById('btn-add-step').onclick=()=>{
    const minutes=parseInt(document.getElementById('inp-add-min').value,10)||3;
    settings.sequence.push({segment:addSegCurrent, minutes});
    redrawSequence(); saveSettings(settings);
  };

  const rg=document.querySelector('.ranges-grid');
  function redrawRanges(){
    rg.innerHTML='';
    const minTxt = dict[settings.lang]?.min_label || 'min';
    const maxTxt = dict[settings.lang]?.max_label || 'max';
    const unitS  = dict[settings.lang]?.unit_s || 's';

    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const row=document.createElement('div'); row.className='range-row';

      const cell1=document.createElement('div');
      const cell2=document.createElement('div');
      const cell3=document.createElement('div');

      cell1.innerHTML = `<label>${getIntensityName(seg, settings.lang)} ${minTxt}</label>`;
      cell2.innerHTML = `<label>${getIntensityName(seg, settings.lang)} ${maxTxt}</label>`;
      cell3.innerHTML = `<label>${getIntensityName(seg, settings.lang)}</label><small>${settings.ranges[seg].min}–${settings.ranges[seg].max}${unitS}</small>`;

      const minWrap = document.createElement('div'); minWrap.className='input-affix';
      const minInp=document.createElement('input'); minInp.type='number'; minInp.min='5'; minInp.value=settings.ranges[seg].min;
      const minAff=document.createElement('span'); minAff.className='affix'; minAff.textContent=unitS;
      minWrap.append(minInp,minAff);

      const maxWrap = document.createElement('div'); maxWrap.className='input-affix';
      const maxInp=document.createElement('input'); maxInp.type='number'; maxInp.min='5'; maxInp.value=settings.ranges[seg].max;
      const maxAff=document.createElement('span'); maxAff.className='affix'; maxAff.textContent=unitS;
      maxWrap.append(maxInp,maxAff);

      cell1.appendChild(minWrap); cell2.appendChild(maxWrap);
      rg.append(cell1,cell2,cell3);

      minInp.onchange=()=>{ settings.ranges[seg].min=Math.max(5, parseInt(minInp.value,10)); saveSettings(settings); redrawRanges(); };
      maxInp.onchange=()=>{ settings.ranges[seg].max=Math.max(settings.ranges[seg].min, parseInt(maxInp.value,10)); saveSettings(settings); redrawRanges(); };
    });

    window._refreshRanges = redrawRanges;
  }
  redrawRanges();

  document.getElementById('btn-save').onclick=()=>{
    settings.participants={P1:p1.value||'Homme', P2:p2.value||'Femme'};
    settings.filters={
      anal: document.getElementById('def-anal').checked,
      hard: document.getElementById('def-hard').checked,
      clothed: document.getElementById('def-clothed').checked,
    };
    settings.cooldownSec=1;
    saveSettings(settings);
    refreshPlan();
    drawActorButtons();

    // repopulate voices after save (original code retained)
    (async function fillVoices(){
      await new Promise(res=>{
        const v = speechSynthesis.getVoices(); if(v?.length) return res();
        speechSynthesis.onvoiceschanged = ()=>res();
        speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
        setTimeout(res, 400);
      });
      const vs = speechSynthesis.getVoices()||[];
      const frSel = document.getElementById('sel-voice-fr');
      const zhSel = document.getElementById('sel-voice-zh');
      function fill(sel, pref, langPrefix){
        sel.innerHTML='';
        const opt0=document.createElement('option'); opt0.value=''; opt0.textContent='Auto'; sel.appendChild(opt0);
        vs.filter(v=> (v.lang||'').toLowerCase().startsWith(langPrefix)).forEach(v=>{
          const o=document.createElement('option'); o.value=v.voiceURI||v.name; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o);
        });
        sel.value = pref || '';
      }
      fill(frSel, settings.voicePrefs?.fr||'', 'fr');
      fill(zhSel, settings.voicePrefs?.zh||'', 'zh');
      frSel.onchange=()=>{ settings.voicePrefs.fr = frSel.value || null; saveSettings(settings); };
      zhSel.onchange=()=>{ settings.voicePrefs.zh = zhSel.value || null; saveSettings(settings); };
    })();
  };

  document.getElementById('btn-reset').onclick=()=>{
    settings = JSON.parse(JSON.stringify(DEFAULTS));
    saveSettings(settings); location.reload();
  };
  document.getElementById('btn-export').onclick=()=>{
    const blob = new Blob([JSON.stringify(settings,null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='settings.json'; a.click();
  };
  document.getElementById('btn-import').onclick=()=>document.getElementById('file-import').click();
  document.getElementById('file-import').onchange=(ev)=>{
    const file=ev.target.files[0]; if(!file) return;
    file.text().then(txt=>{ try{ settings=JSON.parse(txt); saveSettings(settings); location.reload(); }catch{ alert('Fichier invalide.'); } });
  };

  document.getElementById('btn-test-voices').onclick=async()=>{
    await ensureVoices();
    showTTS(true);
    tts.enqueueCNFR('这是中文测试。', 'Ceci est un test français.', voices);
    // masquage indicateur après un court délai
    setTimeout(()=>showTTS(false), 1500);
  };
}

function wirePlayUI(){
  ["btn-start","btn-toggle","btn-stop"].forEach(id=>{
    const el=document.getElementById(id);
    el?.addEventListener('click', ()=> { if (GSAP && !reduceMotion) GSAP.fromTo(el,{y:0},{y:-2,duration:.08,yoyo:true,repeat:1,ease:"power1.out"}); });
  });

  document.getElementById('btn-start').onclick=()=>{ tts.cancel(); startSession(); };
  document.getElementById('btn-toggle').onclick=()=>togglePauseResume();
  document.getElementById('btn-stop').onclick=()=>{ tts.cancel(); stopSession(); };
  document.getElementById('keep-awake').addEventListener('change', async (e)=>{
    if(e.target.checked){ const ok = await enableWakeLock(); if(!ok) startAudioKeepAlive(); }
    else { disableWakeLock(); stopAudioKeepAlive(); }
  });
}

async function ensureVoices(){
  return new Promise(resolve=>{
    const ready = ()=>{ voices = pickVoices(settings.voicePrefs||{}); resolve(); };
    const v = speechSynthesis.getVoices();
    if(v?.length){ ready(); }
    else {
      speechSynthesis.onvoiceschanged = ready;
      speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      setTimeout(ready, 500);
    }
  });
}

function setTheme(seg){
  const card=document.getElementById('action-card');
  card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
  card.classList.add(themeClass(seg));
  document.body.setAttribute('data-intensity', seg);
  const name = getIntensityName(seg, settings.lang);
  document.getElementById('badge-segment').textContent = name;
  Motion.glow(card);
}

function updateActorBadge(actor){ /* kept for potential future */ }

function setActionTexts(fr, zh){
  document.getElementById('text-fr').textContent = fr||'—';
  document.getElementById('text-zh').textContent = zh||'—';
  Motion.sceneIn();
}

function setTimer(left, total){
  document.getElementById('time-left').textContent = formatMMSS(left);
  document.getElementById('time-total').textContent = formatMMSS(total);
  const pct = total? ((total-left)/total)*100 : 0;
  Motion.progressTo(+pct.toFixed(2));
}

function showTTS(show){ const ind=document.getElementById('tts-ind'); if (ind) ind.style.visibility = show ? 'visible' : 'hidden'; }

async function accurateCountdown(totalSec){
  const base = performance.now();
  for(let left=totalSec; left>=0; left--){
    if(cancelled) return;
    while(paused){ await sleep(120); if(cancelled) return; }
    setTimer(left, totalSec);
    if(left>0){
      const target = base + (totalSec - (left-1))*1000;
      const wait = Math.max(0, target - performance.now());
      await sleep(wait);
    }
  }
}

async function startSession(){
  if(running) return;
  if(!data) { alert('data.json manquant'); return; }
  refreshPlan();
  await ensureVoices();
  running=true; cancelled=false; paused=false;
  document.getElementById('btn-start').disabled=true;
  document.getElementById('btn-toggle').disabled=false;
  document.getElementById('btn-stop').disabled=false;
  document.getElementById('btn-toggle').textContent = dict[settings.lang]?.pause || 'Pause';
  startAudioKeepAlive();
  Motion.resumeHero(); // s'assure que l'anim tourne

  for(const seg of currentPlan){
    if(cancelled) break;
    const segName = seg[0]?.segment || 'L1';
    setTheme(segName);
    for(const act of seg){
      if(cancelled) break;
      tts.cancel();
      setActionTexts(act.text, act.text_zh);
      showTTS(true);
      interruptAndSpeakCNFR(tts, act.text_zh, act.text, voices);
      await accurateCountdown(act.duration);
      showTTS(false);
      if(cancelled) break;
      settings.cooldownSec=1;
      if(settings.cooldownSec>0){
        setActionTexts('—', '—');
        await accurateCountdown(settings.cooldownSec);
      }
    }
  }
  stopSession();
}

function togglePauseResume(){
  if(!running) return;
  const btn = document.getElementById('btn-toggle');
  if(!paused){
    paused=true; tts.pause(); Motion.pauseHero();
    btn.textContent = dict[settings.lang]?.resume || 'Reprendre';
    btn.classList.remove('secondary'); btn.classList.add('primary');
  } else {
    paused=false; tts.resume(); Motion.resumeHero();
    btn.textContent = dict[settings.lang]?.pause || 'Pause';
    btn.classList.remove('primary'); btn.classList.add('secondary');
  }
}

function stopSession(){
  if(!running) return;
  cancelled=true; paused=false; running=false;
  tts.cancel();
  document.getElementById('btn-start').disabled=false;
  document.getElementById('btn-toggle').disabled=true;
  document.getElementById('btn-stop').disabled=true;
  setActionTexts('—','—'); setTimer(0,0);
  showTTS(false);
  stopAudioKeepAlive(); disableWakeLock();
  // on laisse l'anim héro tourner en fond; sinon: Motion.pauseHero();
}

/* ---- Draw Tab v2 ---- */
function initDrawTab(){
  const cont = document.getElementById('draw-intensity-chips');
  const segs = ['L1','L2','L3','L4','L5','SEXE'];
  let current = 'L1';
  function drawChips(){
    cont.innerHTML='';
    segs.forEach(seg=>{
      const b=document.createElement('button');
      const cls = seg==='SEXE'?'sexe':('level'+parseInt(seg.replace('L',''),10));
      b.className = `intensity-chip ${cls}` + (current===seg?' active':'');
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick=()=>{ current=seg; document.body.setAttribute('data-intensity', seg); drawChips(); if (GSAP && !reduceMotion) Motion.chipSelect(b); };
      cont.appendChild(b);
    });
  }
  drawChips();
  initDrawTab.refresh = ()=>{ drawChips(); };
  document.getElementById('btn-draw-play').onclick = async ()=>{
    if(!data){ alert('data.json manquant'); return; }
    await ensureVoices();
    const pick = drawOne(settings, data, current, settings.filters);
    const card = document.getElementById('draw-card');
    card.style.display='block';
    card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
    card.classList.add(themeClass(current));
    document.getElementById('draw-fr').textContent = pick? pick.text : '—';
    document.getElementById('draw-zh').textContent = pick? (pick.text_zh||'—') : '—';
    if(pick){ showTTS(true); interruptAndSpeakCNFR(tts, pick.text_zh, pick.text, voices); setTimeout(()=>showTTS(false), 1500); }
  };
}
