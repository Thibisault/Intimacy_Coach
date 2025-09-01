// Lecteur d'intensités : back/intelligent, next, skip action, play/pause, stop.
// Bar de progression = temps de l'INTENSITÉ (pas de l'action)
import { applyI18n, dict, getIntensityName } from './i18n.js';
import { sleep, formatMMSS, themeClass } from './util.js';
import { loadSettings, saveSettings } from './storage.js';
import { startAudioKeepAlive, stopAudioKeepAlive } from './audio.js';
import { SpeechQueue, pickVoices, interruptAndSpeakCNFR } from './tts.js';
import { enableWakeLock, disableWakeLock } from './wake-lock.js';
import { buildPlan, drawOne } from './planner.js';

const DEFAULTS = {
  participants: { P1: 'Homme', P2: 'Femme' },
  sequence: [
    { segment:'L1', minutes:3 },
    { segment:'L2', minutes:3 },
    { segment:'L3', minutes:3 },
    { segment:'L4', minutes:3 },
    { segment:'L5', minutes:3 },
    { segment:'SEXE', minutes:4 },
  ],
  ranges: {
    L1:{min:15,max:30}, L2:{min:20,max:35}, L3:{min:20,max:40},
    L4:{min:25,max:45}, L5:{min:25,max:50}, SEXE:{min:30,max:60}
  },
  cooldownSec: 1,
  actorMode: 'random',
  filters: { anal:true, hard:true, clothed:true },
  lang: 'fr',
  voicePrefs: { fr:null, zh:null },
};

let settings = Object.assign({}, DEFAULTS, loadSettings() || {});
let data = null;
let plan = [];                 // Array<Array<Action>>
let running = false, paused = false, cancelled = false;
let voices = { zh:null, fr:null };
const tts = new SpeechQueue();

// Pointeurs de lecture
let segIdx = 0;                // index d'intensité courant
let actIdx = 0;                // index d'action courant (dans l'intensité)
let segTotal = 0;              // total secondes de l'intensité
let segElapsed = 0;            // écoulé au sein de l'intensité
let navCommand = null;         // 'next' | 'prevSmart' | 'skip' | 'stop'
const PREV_THRESHOLD_SEC = 6;  // logique “lecteur classique”

// ---------- Boot ----------
applyI18n(settings.lang);
initTabs();
wireLangButtons();
initSettingsUI();
wirePlayerUI();
initDrawTab();
loadData();

// ---------- Data ----------
async function loadData(){
  try{
    const res = await fetch('./public/data.json?' + Date.now());
    data = await res.json();
  }catch(e){
    console.error('Failed to load data.json', e);
    alert('Erreur: data.json manquant. Voir README.');
  }
  rebuildPlan();
}
function rebuildPlan(){
  if(!data) return;
  plan = buildPlan(settings, data);
  // sécurise pointeurs si la séquence change
  segIdx = Math.min(segIdx, Math.max(0, plan.length-1));
  actIdx = 0;
  updatePlayerButtons();
}

// ---------- Tabs ----------
function initTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const current = document.querySelector('.tabs .tab.active')?.dataset.tab;
      if(current === 'play' && running){ pauseSession(); }

      document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      const id = btn.dataset.tab;
      document.querySelectorAll('.tabpanel').forEach(p=>p.classList.remove('active'));
      document.getElementById('tab-' + id).classList.add('active');

      if(id === 'settings'){
        document.querySelectorAll('#tab-settings details.accordion').forEach(d => d.open = false);
      }
      if(id === 'draw'){
        try { tts.cancel(); speechSynthesis.cancel(); speechSynthesis.resume(); } catch {}
      }
    });
  });
}

// ---------- Lang ----------
function wireLangButtons(){
  const frBtn = document.getElementById('btn-fr');
  const zhBtn = document.getElementById('btn-zh');
  const setActive = (lang) => {
    settings.lang = lang;
    applyI18n(lang);
    if (typeof window._refreshSequence === 'function') window._refreshSequence();
    if (typeof window._refreshAddControls === 'function') window._refreshAddControls();
    if (typeof window._refreshRanges === 'function') window._refreshRanges();
    if (typeof window._refreshActorButtons === 'function') window._refreshActorButtons();
    if (typeof initDrawTab?.refresh === 'function') initDrawTab.refresh();
    saveSettings(settings);
    frBtn.classList.toggle('active', lang === 'fr');
    zhBtn.classList.toggle('active', lang === 'zh');
  };
  frBtn.onclick = () => setActive('fr');
  zhBtn.onclick = () => setActive('zh');
}

// ---------- Settings UI (autosave) ----------
function initSettingsUI(){
  const p1 = document.getElementById('inp-p1');
  const p2 = document.getElementById('inp-p2');
  p1.value = settings.participants.P1;
  p2.value = settings.participants.P2;

  const commitNames = ()=>{
    settings.participants.P1 = p1.value || 'Homme';
    settings.participants.P2 = p2.value || 'Femme';
    saveSettings(settings);
    if (typeof window._refreshActorButtons === 'function') window._refreshActorButtons();
  };
  p1.addEventListener('input', commitNames);
  p2.addEventListener('input', commitNames);

  // Actor mode
  const amWrap = document.getElementById('actor-mode-buttons');
  const labelFor = (mode)=>{
    const male = p1.value || 'Homme';
    const female = p2.value || 'Femme';
    if(settings.lang === 'zh'){
      return ({'random':'随机','female-male-both':`${female} → ${male} → 互相`,'just-female':`仅${female}`,'just-male':`仅${male}`,'just-both':`仅互相`})[mode];
    }
    return ({'random':'Aléatoire','female-male-both':`${female} → ${male} → Mutuelle`,'just-female':`${female} seulement`,'just-male':`${male} seulement`,'just-both':`Mutuelle seulement`})[mode];
  };
  function drawActorButtons(){
    amWrap.innerHTML = '';
    ['random','female-male-both','just-female','just-male','just-both'].forEach(m=>{
      const b = document.createElement('button');
      b.className = 'chip option' + (settings.actorMode===m?' active':'');
      b.textContent = labelFor(m);
      b.onclick = ()=>{ settings.actorMode=m; saveSettings(settings); drawActorButtons(); rebuildPlan(); };
      amWrap.appendChild(b);
    });
  }
  drawActorButtons();
  window._refreshActorButtons = drawActorButtons;

  // Voices
  (async function fillVoices(){
    await new Promise(res=>{
      const v = speechSynthesis.getVoices();
      if(v?.length) return res();
      speechSynthesis.onvoiceschanged = ()=>res();
      speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      setTimeout(res, 400);
    });
    const vs = speechSynthesis.getVoices() || [];
    const frSel = document.getElementById('sel-voice-fr');
    const zhSel = document.getElementById('sel-voice-zh');
    function fill(sel, pref, prefix){
      sel.innerHTML = '<option value="">Auto</option>';
      vs.filter(v => (v.lang||'').toLowerCase().startsWith(prefix))
        .forEach(v=>{
          const o = document.createElement('option');
          o.value = v.voiceURI || v.name;
          o.textContent = `${v.name} (${v.lang})`;
          sel.appendChild(o);
        });
      sel.value = pref || '';
    }
    fill(frSel, settings.voicePrefs?.fr || '', 'fr');
    fill(zhSel, settings.voicePrefs?.zh || '', 'zh');
    frSel.onchange = ()=>{ settings.voicePrefs.fr = frSel.value || null; saveSettings(settings); };
    zhSel.onchange = ()=>{ settings.voicePrefs.zh = zhSel.value || null; saveSettings(settings); };
  })();

  const syncFilters = ()=>{
    settings.filters = {
      anal: document.getElementById('def-anal').checked,
      hard: document.getElementById('def-hard').checked,
      clothed: document.getElementById('def-clothed').checked,
    };
    saveSettings(settings);
  };
  document.getElementById('def-anal').checked    = settings.filters.anal;
  document.getElementById('def-hard').checked    = settings.filters.hard;
  document.getElementById('def-clothed').checked = settings.filters.clothed;
  ['def-anal','def-hard','def-clothed'].forEach(id=>document.getElementById(id).addEventListener('change', syncFilters));

  // Séquence (drag + edit minutes)
  const seqList = document.getElementById('sequence-list');
  function redrawSequence(){
    seqList.innerHTML = '';
    let dragIndex = null;
    settings.sequence.forEach((s, idx)=>{
      const row = document.createElement('div'); row.className='row'; row.draggable=true; row.dataset.index=idx;
      const handle = document.createElement('div'); handle.className='drag-handle'; handle.textContent='⋮⋮';
      const seg = document.createElement('div'); seg.className='seg'; seg.textContent = getIntensityName(s.segment, settings.lang);
      const wrap = document.createElement('div'); wrap.className='input-affix';
      const min = document.createElement('input'); min.type='number'; min.min='1'; min.value=s.minutes;
      const aff = document.createElement('span'); aff.className='affix'; aff.textContent=(dict[settings.lang]?.unit_min||'min');
      wrap.append(min,aff);
      const del = document.createElement('button'); del.textContent='✕'; del.className='danger tiny';

      del.onclick = ()=>{ settings.sequence.splice(idx,1); saveSettings(settings); redrawSequence(); rebuildPlan(); };
      min.onchange = ()=>{ s.minutes = Math.max(1, parseInt(min.value||'1',10)); saveSettings(settings); rebuildPlan(); };

      row.addEventListener('dragstart', e=>{ dragIndex=idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      row.addEventListener('dragend', ()=>row.classList.remove('dragging'));
      row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', ()=>row.classList.remove('drop-target'));
      row.addEventListener('drop', ()=>{ row.classList.remove('drop-target');
        const toIdx = parseInt(row.dataset.index,10);
        if(dragIndex===null || dragIndex===toIdx) return;
        const [moved] = settings.sequence.splice(dragIndex,1);
        settings.sequence.splice(toIdx,0,moved);
        saveSettings(settings); redrawSequence(); rebuildPlan();
      });

      row.append(handle,seg,wrap,del); seqList.appendChild(row);
    });
    window._refreshSequence = redrawSequence;
  }
  redrawSequence();

  // Ajout d’étapes
  const chips = document.getElementById('add-seg-chips');
  let addSeg = 'L1';
  function redrawAdd(){
    chips.innerHTML = '';
    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const b=document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.className=`intensity-chip ${cls}`+(addSeg===seg?' active':'');
      b.textContent=getIntensityName(seg, settings.lang);
      b.onclick=()=>{ addSeg=seg; redrawAdd(); };
      chips.appendChild(b);
    });
  }
  redrawAdd(); window._refreshAddControls = redrawAdd;

  document.getElementById('btn-add-step').onclick = ()=>{
    const minutes = parseInt(document.getElementById('inp-add-min').value,10) || 3;
    settings.sequence.push({ segment:addSeg, minutes });
    saveSettings(settings); redrawSequence(); rebuildPlan();
  };

  // Ranges
  const rg = document.querySelector('.ranges-grid');
  function redrawRanges(){
    rg.innerHTML=''; const unit = dict[settings.lang]?.unit_s || 's';
    const minTxt = dict[settings.lang]?.min_label || 'min';
    const maxTxt = dict[settings.lang]?.max_label || 'max';
    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const cell1=document.createElement('div'); const cell2=document.createElement('div'); const cell3=document.createElement('div');
      cell1.innerHTML=`<label>${getIntensityName(seg, settings.lang)} ${minTxt}</label>`;
      cell2.innerHTML=`<label>${getIntensityName(seg, settings.lang)} ${maxTxt}</label>`;
      cell3.innerHTML=`<label>${getIntensityName(seg, settings.lang)}</label><small>${settings.ranges[seg].min}–${settings.ranges[seg].max}${unit}</small>`;

      const w1=document.createElement('div'); w1.className='input-affix';
      const i1=document.createElement('input'); i1.type='number'; i1.min='5'; i1.value=settings.ranges[seg].min;
      const a1=document.createElement('span'); a1.className='affix'; a1.textContent=unit; w1.append(i1,a1);

      const w2=document.createElement('div'); w2.className='input-affix';
      const i2=document.createElement('input'); i2.type='number'; i2.min='5'; i2.value=settings.ranges[seg].max;
      const a2=document.createElement('span'); a2.className='affix'; a2.textContent=unit; w2.append(i2,a2);

      i1.onchange=()=>{ settings.ranges[seg].min=Math.max(5,parseInt(i1.value,10)); saveSettings(settings); redrawRanges(); };
      i2.onchange=()=>{ settings.ranges[seg].max=Math.max(settings.ranges[seg].min,parseInt(i2.value,10)); saveSettings(settings); redrawRanges(); };

      cell1.appendChild(w1); cell2.appendChild(w2); rg.append(cell1,cell2,cell3);
    });
    window._refreshRanges = redrawRanges;
  }
  redrawRanges();

  document.getElementById('btn-test-voices').onclick = async ()=>{
    await ensureVoices();
    tts.enqueueCNFR('这是中文测试。', 'Ceci est un test français.', voices);
  };
}

// ---------- Player UI ----------
function wirePlayerUI(){
  document.getElementById('btn-start').onclick = ()=>{ if (paused && running) resumeSession(); else startSession(); };
  document.getElementById('btn-pause').onclick = ()=> pauseSession();
  document.getElementById('btn-stop').onclick  = ()=> { navCommand='stop'; tts.cancel(); stopSession(); };

  document.getElementById('btn-next').onclick  = ()=> { if(!isLastSegment()) navCommand='next'; };
  document.getElementById('btn-prev').onclick  = ()=> { navCommand='prevSmart'; };
  document.getElementById('btn-skip').onclick  = ()=> { navCommand='skip'; };

  document.getElementById('keep-awake').addEventListener('change', async (e)=>{
    if(e.target.checked){ const ok = await enableWakeLock(); if(!ok) startAudioKeepAlive(); }
    else { disableWakeLock(); stopAudioKeepAlive(); }
  });

  updatePlayerButtons();
}

function updatePlayerButtons(){
  const next = document.getElementById('btn-next');
  next.disabled = isLastSegment();
  // prev toujours cliquable (restart si “trop tard”)
}

function isLastSegment(){ return segIdx >= (plan?.length||0) - 1; }

// ---------- Voices ----------
async function ensureVoices(){
  return new Promise(resolve=>{
    const ready = ()=>{ voices = pickVoices(settings.voicePrefs || {}); resolve(); };
    const v = speechSynthesis.getVoices();
    if(v?.length){ ready(); }
    else{
      speechSynthesis.onvoiceschanged = ready;
      speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      setTimeout(ready, 500);
    }
  });
}

// ---------- Theme / UI helpers ----------
function setTheme(seg){
  const card = document.getElementById('action-card');
  card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
  card.classList.add(themeClass(seg));
  document.body.setAttribute('data-intensity', seg);
  document.getElementById('badge-segment').textContent = getIntensityName(seg, settings.lang);
  updatePlayerButtons();
}

function setOverlayTexts(fr, zh){
  document.getElementById('text-fr').textContent = fr || '—';
  document.getElementById('text-zh').textContent = zh || '—';
}

function setSegTimerUI(left, total){
  document.getElementById('time-left').textContent = formatMMSS(left);
  document.getElementById('time-total').textContent = formatMMSS(total);
  const pct = total ? ((total-left)/total)*100 : 0;
  document.getElementById('progress-bar').style.width = pct.toFixed(2) + '%';
}

function setActionMeta(idx, of, labelFR){
  const el = document.getElementById('action-meta');
  el.textContent = of>0 ? `Action ${idx+1}/${of}${labelFR?` • ${labelFR}`:''}` : '—';
}

// ---------- Session engine ----------
async function startSession(){
  if(running) return;
  if(!data){ alert('data.json manquant'); return; }
  rebuildPlan();
  await ensureVoices();
  running = true; cancelled = false; paused = false; navCommand = null;
  segIdx = Math.max(0, segIdx); actIdx = Math.max(0, actIdx);

  setUIState('running');
  startAudioKeepAlive();

  while(running && !cancelled && segIdx < plan.length){
    const seg = plan[segIdx];
    if(!seg || seg.length===0){ segIdx++; continue; }

    // Thème de l'intensité
    const segName = seg[0]?.segment || 'L1';
    setTheme(segName);

    // Totaux de l'intensité (incl. cooldowns)
    const cd = settings.cooldownSec||0;
    segTotal = seg.reduce((s,a)=>s + a.duration, 0) + cd * Math.max(0, seg.length-1);
    segElapsed = 0;

    // Timer initial
    setSegTimerUI(segTotal, segTotal);
    setActionMeta(actIdx, seg.length, '');

    // Parcourt les actions de l'intensité
    let leaveSegment = false;
    for(; actIdx < seg.length; actIdx++){
      if(cancelled){ leaveSegment=true; break; }

      const act = seg[actIdx];
      setOverlayTexts(act.text, act.text_zh);
      tts.cancel(); interruptAndSpeakCNFR(tts, act.text_zh, act.text, voices);

      // Compte à rebours de l'action avec commandes
      const r = await runActionCountdown(act.duration);
      if(r === 'jump-next'){ leaveSegment = true; segIdx++; actIdx=0; break; }
      if(r === 'jump-prev-smart'){
        // si “peu de temps passé” → intensité précédente, sinon restart intensité
        if(segElapsed <= PREV_THRESHOLD_SEC){
          segIdx = Math.max(0, segIdx-1); actIdx = 0;
        }else{
          actIdx = 0; // restart cette intensité
        }
        leaveSegment = true; break;
      }
      if(r === 'stopped'){ stopSession(); return; }

      // Cooldown entre actions
      if(cd>0 && actIdx < seg.length-1){
        setOverlayTexts('—','—');
        const r2 = await runActionCountdown(cd);
        if(r2 === 'jump-next'){ leaveSegment = true; segIdx++; actIdx=0; break; }
        if(r2 === 'jump-prev-smart'){
          if(segElapsed <= PREV_THRESHOLD_SEC){ segIdx = Math.max(0, segIdx-1); actIdx = 0; }
          else{ actIdx = 0; }
          leaveSegment = true; break;
        }
        if(r2 === 'stopped'){ stopSession(); return; }
      }
    }

    if(!leaveSegment){
      // Fin normale de l'intensité → passe à la suivante
      segIdx++; actIdx=0;
    }

    // boucle while continue avec la prochaine intensité
  }

  stopSession();
}

// compte à rebours “action” (met à jour le timer d'INTENSITÉ)
async function runActionCountdown(duration){
  // navCommand peut être 'skip'/'next'/'prevSmart'/'stop'
  if(duration <= 0) return 'ok';

  for(let left = duration; left > 0; ){
    if(cancelled) return 'stopped';

    // Gestion pause
    while(paused){ await sleep(120); if(cancelled) return 'stopped'; }

    // Consommation de commandes
    if(navCommand){
      const cmd = navCommand; navCommand = null;
      if(cmd === 'stop')    return 'stopped';
      if(cmd === 'skip')    { segElapsed += left; setSegTimerUI(Math.max(0, segTotal - segElapsed), segTotal); return 'ok'; }
      if(cmd === 'next')    return 'jump-next';
      if(cmd === 'prevSmart') return 'jump-prev-smart';
    }

    // tick d'1 seconde précis
    const target = performance.now() + 1000;
    left -= 1;
    segElapsed += 1;

    // UI
    setSegTimerUI(Math.max(0, segTotal - segElapsed), segTotal);
    setActionMeta(actIdx, plan[segIdx]?.length||0, '');

    // attente ajustée
    const wait = Math.max(0, target - performance.now());
    await sleep(wait);
  }

  return 'ok';
}

function pauseSession(){
  if(!running || paused) return;
  paused = true;
  tts.pause();
  setUIState('paused');
}
function resumeSession(){
  if(!running || !paused) return;
  paused = false;
  tts.resume();
  setUIState('running');
}
function stopSession(){
  if(!running && !paused) return;
  cancelled = true; paused = false; running = false;
  tts.cancel();
  setOverlayTexts('—','—'); setSegTimerUI(0,0);
  setUIState('idle');
  stopAudioKeepAlive(); disableWakeLock();
  navCommand = null;
  updatePlayerButtons();
}

function setUIState(state){
  const startBtn = document.getElementById('btn-start');
  const pauseBtn = document.getElementById('btn-pause');
  const stopBtn  = document.getElementById('btn-stop');

  if(state === 'idle'){
    startBtn.hidden = false; startBtn.disabled = false;
    pauseBtn.hidden = true;  pauseBtn.disabled = true;
    stopBtn.disabled = true;
  }
  if(state === 'running'){
    startBtn.hidden = true;
    pauseBtn.hidden = false; pauseBtn.disabled = false;
    stopBtn.disabled = false;
  }
  if(state === 'paused'){
    startBtn.hidden = false; startBtn.disabled = false;
    pauseBtn.hidden = true;  pauseBtn.disabled = true;
    stopBtn.disabled = false;
  }
  updatePlayerButtons();
}

// ---------- Draw tab ----------
function initDrawTab(){
  const cont = document.getElementById('draw-intensity-chips');
  const segs = ['L1','L2','L3','L4','L5','SEXE'];
  let current = 'L1';
  function drawChips(){
    cont.innerHTML = '';
    segs.forEach(seg=>{
      const b = document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.className = `intensity-chip ${cls}` + (current===seg?' active':'');
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick = ()=>{ current=seg; document.body.setAttribute('data-intensity', seg); drawChips(); };
      cont.appendChild(b);
    });
  }
  drawChips();
  initDrawTab.refresh = ()=>drawChips();

  document.getElementById('btn-draw-play').onclick = async ()=>{
    if(!data){ alert('data.json manquant'); return; }
    await ensureVoices();
    const pick = drawOne(settings, data, current, settings.filters);
    const card = document.getElementById('draw-card');
    card.style.display='block';
    card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
    card.classList.add(themeClass(current));
    document.getElementById('draw-fr').textContent = pick ? pick.text : '—';
    document.getElementById('draw-zh').textContent = pick ? (pick.text_zh || '—') : '—';
    if(pick){ interruptAndSpeakCNFR(tts, pick.text_zh, pick.text, voices); }
  };
}

// ---------- Micro-interactions ----------
// Ripple doux
document.addEventListener('pointerdown', (e)=>{
  const b = e.target.closest('button');
  if(!b) return;
  const rect = b.getBoundingClientRect();
  b.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  b.style.setProperty('--my', `${e.clientY - rect.top}px`);
});

// Tilt subtil sur visuels
(() => {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduce) return;
  const boxes = [document.getElementById('action-visual'), document.getElementById('draw-visual')].filter(Boolean);
  const max = 6;
  boxes.forEach((box)=>{
    const onMove = (e) => {
      const r = box.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      box.style.transform = `perspective(800px) rotateX(${-y*max}deg) rotateY(${x*max}deg)`;
    };
    const reset = () => { box.style.transform = 'perspective(800px) rotateX(0) rotateY(0)'; };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerleave', reset);
  });
})();
