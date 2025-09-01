// app.js — lecteur fiable (Start/Pause/Stop + Prev/Skip/Next-segment) + autosave + draw
import { applyI18n, dict, getIntensityName } from './i18n.js';
import { sleep, formatMMSS, themeClass } from './util.js';
import { loadSettings, saveSettings } from './storage.js';
import { startAudioKeepAlive, stopAudioKeepAlive } from './audio.js';
import { SpeechQueue, pickVoices, interruptAndSpeakCNFR } from './tts.js';
import { enableWakeLock, disableWakeLock } from './wake-lock.js';
import { buildPlan, drawOne } from './planner.js';

/* ---------- Defaults & State ---------- */
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
let currentPlan = [];            // Array< Array<Action> > ; each Action: {text, text_zh, duration, segment}
let running = false, paused = false, cancelled = false;
let voices = { zh:null, fr:null };
let uiState = 'idle';            // 'idle' | 'running' | 'paused'
const tts = new SpeechQueue();

// Pointeurs de session
let segIdx = 0;
let actIdx = 0;
let currentTotal = 0;
let currentLeft = 0;

// Commandes utilisateur (déclenchées par UI)
const control = { request: null }; // 'skip_action' | 'prev_action' | 'next_segment' | 'stop_session' | 'restart_action'

/* ---------- Boot ---------- */
applyI18n(settings.lang);
initTabs();
wireLangButtons();
initSettingsUI();
wirePlayUI();
initDrawTab();
loadData();

/* ---------- Data ---------- */
async function loadData(){
  try{
    const res = await fetch('./public/data.json?' + Date.now());
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
}

/* ---------- Tabs / Navigation ---------- */
function initTabs(){
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const currentTab = document.querySelector('.tabs .tab.active')?.dataset.tab;

      // Quitter Play => autopause
      if(currentTab === 'play' && running){
        pauseSession();
      }

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

/* ---------- Lang ---------- */
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

/* ---------- Settings UI ---------- */
function initSettingsUI(){
  const p1 = document.getElementById('inp-p1');
  const p2 = document.getElementById('inp-p2');
  p1.value = settings.participants.P1;
  p2.value = settings.participants.P2;

  const commitNames = () => {
    settings.participants.P1 = p1.value || 'Homme';
    settings.participants.P2 = p2.value || 'Femme';
    saveSettings(settings);
    if (typeof window._refreshActorButtons === 'function') window._refreshActorButtons();
  };
  p1.addEventListener('input', commitNames);
  p2.addEventListener('input', commitNames);

  // Actor mode
  const amWrap = document.getElementById('actor-mode-buttons');
  function actorLabel(mode){
    const male = p1.value || 'Homme';
    const female = p2.value || 'Femme';
    if(settings.lang === 'zh'){
      return ({
        'random': '随机',
        'female-male-both': `${female} → ${male} → 互相`,
        'just-female': `仅${female}`,
        'just-male': `仅${male}`,
        'just-both': `仅互相`,
      })[mode];
    }
    return ({
      'random': 'Aléatoire',
      'female-male-both': `${female} → ${male} → Mutuelle`,
      'just-female': `${female} seulement`,
      'just-male': `${male} seulement`,
      'just-both': `Mutuelle seulement`,
    })[mode];
  }
  function drawActorButtons(){
    amWrap.innerHTML = '';
    ['random','female-male-both','just-female','just-male','just-both'].forEach(m=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip option' + (settings.actorMode===m ? ' active' : '');
      b.textContent = actorLabel(m);
      b.onclick = () => { settings.actorMode = m; drawActorButtons(); saveSettings(settings); };
      amWrap.appendChild(b);
    });
  }
  drawActorButtons();
  window._refreshActorButtons = drawActorButtons;

  // Voices
  async function fillVoices(){
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
    function fill(sel, pref, langPrefix){
      sel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = ''; opt0.textContent = 'Auto';
      sel.appendChild(opt0);
      vs.filter(v => (v.lang||'').toLowerCase().startsWith(langPrefix))
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
  }
  fillVoices();

  // Filters (autosave)
  const syncFilters = () => {
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
  document.getElementById('def-anal').addEventListener('change', syncFilters);
  document.getElementById('def-hard').addEventListener('change', syncFilters);
  document.getElementById('def-clothed').addEventListener('change', syncFilters);

  // Sequence editor
  const seqList = document.getElementById('sequence-list');
  function redrawSequence(){
    seqList.innerHTML = '';
    let dragIndex = null;

    settings.sequence.forEach((s, idx)=>{
      const row = document.createElement('div');
      row.className = 'row';
      row.draggable = true;
      row.dataset.index = idx;

      const handle = document.createElement('div');
      handle.className = 'drag-handle';
      handle.textContent = '⋮⋮';

      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.textContent = getIntensityName(s.segment, settings.lang);

      const minutesWrap = document.createElement('div');
      minutesWrap.className = 'input-affix';
      const min = document.createElement('input');
      min.type='number'; min.min='1'; min.value=s.minutes;
      const affix = document.createElement('span');
      affix.className='affix';
      affix.textContent = (dict[settings.lang]?.unit_min || 'min');
      minutesWrap.append(min,affix);

      const del = document.createElement('button');
      del.textContent = '✕';
      del.className = 'danger tiny';

      del.onclick = ()=>{ settings.sequence.splice(idx,1); redrawSequence(); saveSettings(settings); };
      min.onchange = ()=>{ s.minutes = Math.max(1, parseInt(min.value||'1',10)); saveSettings(settings); };

      row.addEventListener('dragstart', e=>{ dragIndex = idx; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      row.addEventListener('dragend',   ()=>{ row.classList.remove('dragging'); });
      row.addEventListener('dragover', e=>{
        e.preventDefault();
        const overIdx = parseInt(row.dataset.index,10);
        if(overIdx!==dragIndex) row.classList.add('drop-target');
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

  // Add controls
  const addChipsCont = document.getElementById('add-seg-chips');
  let addSegCurrent = 'L1';
  function redrawAddControls(){
    addChipsCont.innerHTML = '';
    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const b = document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.className = `intensity-chip ${cls}` + (addSegCurrent===seg?' active':'');
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick = ()=>{ addSegCurrent = seg; redrawAddControls(); };
      addChipsCont.appendChild(b);
    });
  }
  redrawAddControls();
  window._refreshAddControls = redrawAddControls;

  document.getElementById('btn-add-step').onclick = ()=>{
    const minutes = parseInt(document.getElementById('inp-add-min').value,10) || 3;
    settings.sequence.push({ segment:addSegCurrent, minutes });
    redrawSequence(); saveSettings(settings);
  };

  // Ranges
  const rg = document.querySelector('.ranges-grid');
  function redrawRanges(){
    rg.innerHTML = '';
    const unitS  = dict[settings.lang]?.unit_s || 's';
    const minTxt = dict[settings.lang]?.min_label || 'min';
    const maxTxt = dict[settings.lang]?.max_label || 'max';

    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const cell1 = document.createElement('div');
      const cell2 = document.createElement('div');
      const cell3 = document.createElement('div');

      cell1.innerHTML = `<label>${getIntensityName(seg, settings.lang)} ${minTxt}</label>`;
      cell2.innerHTML = `<label>${getIntensityName(seg, settings.lang)} ${maxTxt}</label>`;
      cell3.innerHTML = `<label>${getIntensityName(seg, settings.lang)}</label><small>${settings.ranges[seg].min}–${settings.ranges[seg].max}${unitS}</small>`;

      const minWrap = document.createElement('div'); minWrap.className='input-affix';
      const minInp = document.createElement('input'); minInp.type='number'; minInp.min='5'; minInp.value=settings.ranges[seg].min;
      const minAff = document.createElement('span'); minAff.className='affix'; minAff.textContent=unitS;
      minWrap.append(minInp,minAff);

      const maxWrap = document.createElement('div'); maxWrap.className='input-affix';
      const maxInp = document.createElement('input'); maxInp.type='number'; maxInp.min='5'; maxInp.value=settings.ranges[seg].max;
      const maxAff = document.createElement('span'); maxAff.className='affix'; maxAff.textContent=unitS;
      maxWrap.append(maxInp,maxAff);

      cell1.appendChild(minWrap); cell2.appendChild(maxWrap);
      rg.append(cell1,cell2,cell3);

      minInp.onchange = ()=>{ settings.ranges[seg].min = Math.max(5, parseInt(minInp.value,10)); saveSettings(settings); redrawRanges(); };
      maxInp.onchange = ()=>{ settings.ranges[seg].max = Math.max(settings.ranges[seg].min, parseInt(maxInp.value,10)); saveSettings(settings); redrawRanges(); };
    });

    window._refreshRanges = redrawRanges;
  }
  redrawRanges();

  // Test voix
  document.getElementById('btn-test-voices').onclick = async ()=>{
    await ensureVoices();
    tts.enqueueCNFR('这是中文测试。', 'Ceci est un test français.', voices);
  };
}

/* ---------- Play Controls ---------- */
function wirePlayUI(){
  const startBtn = document.getElementById('btn-start');
  const pauseBtn = document.getElementById('btn-pause');
  const stopBtn  = document.getElementById('btn-stop');
  const prevBtn  = document.getElementById('btn-prev');
  const skipBtn  = document.getElementById('btn-skip');
  const nextBtn  = document.getElementById('btn-next');

  setUIState('idle');

  startBtn.onclick = () => {
    if (paused && running) { resumeSession(); return; }
    tts.cancel(); startSession();
  };
  pauseBtn.onclick = () => { pauseSession(); };
  stopBtn.onclick  = () => { control.request = 'stop_session'; tts.cancel(); stopSession(); };

  // Nouveaux contrôles fonctionnels
  prevBtn.onclick = () => {
    if (!running) return;
    control.request = 'prev_action';
  };
  skipBtn.onclick = () => {
    if (!running) return;
    control.request = 'skip_action';
  };
  nextBtn.onclick = () => {
    if (!running) return;
    control.request = 'next_segment';
  };

  document.getElementById('keep-awake').addEventListener('change', async (e)=>{
    if(e.target.checked){
      const ok = await enableWakeLock();
      if(!ok) startAudioKeepAlive();
    } else {
      disableWakeLock(); stopAudioKeepAlive();
    }
  });
}

function setUIState(state){
  uiState = state;
  const startBtn = document.getElementById('btn-start');
  const pauseBtn = document.getElementById('btn-pause');
  const stopBtn  = document.getElementById('btn-stop');
  const prevBtn  = document.getElementById('btn-prev');
  const skipBtn  = document.getElementById('btn-skip');
  const nextBtn  = document.getElementById('btn-next');

  if(state === 'idle'){
    startBtn.hidden = false; startBtn.disabled = false;
    pauseBtn.hidden = true;  pauseBtn.disabled = true;
    stopBtn.disabled = true;
    prevBtn.disabled = true; skipBtn.disabled = true; nextBtn.disabled = true;
  }
  if(state === 'running'){
    startBtn.hidden = true;
    pauseBtn.hidden = false; pauseBtn.disabled = false;
    stopBtn.disabled = false;
    prevBtn.disabled = false; skipBtn.disabled = false; nextBtn.disabled = false;
  }
  if(state === 'paused'){
    startBtn.hidden = false; startBtn.disabled = false;
    pauseBtn.hidden = true;  pauseBtn.disabled = true;
    stopBtn.disabled = false;
    // On laisse Prev/Skip/Next actifs pendant la pause (la commande sera prise en compte à la reprise)
    prevBtn.disabled = false; skipBtn.disabled = false; nextBtn.disabled = false;
  }
}

/* ---------- Voices ---------- */
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

/* ---------- Theme / UI helpers ---------- */
function setTheme(seg){
  const card = document.getElementById('action-card');
  card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
  card.classList.add(themeClass(seg));
  document.body.setAttribute('data-intensity', seg);
  const name = getIntensityName(seg, settings.lang);
  document.getElementById('badge-segment').textContent = name;

  const drawCard = document.getElementById('draw-card');
  if (drawCard) {
    drawCard.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
    drawCard.classList.add(themeClass(seg));
  }
}
function setActionTexts(fr, zh){
  document.getElementById('text-fr').textContent = fr || '—';
  document.getElementById('text-zh').textContent = zh || '—';
}
function setTimer(left, total){
  document.getElementById('time-left').textContent = formatMMSS(left);
  document.getElementById('time-total').textContent = formatMMSS(total);
  const pct = total ? ((total-left)/total)*100 : 0;
  document.getElementById('progress-bar').style.width = pct.toFixed(2) + '%';
}
function setMeta(){
  const segCount = currentPlan?.length || 0;
  const actionsInSeg = currentPlan?.[segIdx]?.length || 0;
  const segName = currentPlan?.[segIdx]?.[0]?.segment || 'L1';
  const meta = `Segment ${segIdx+1}/${segCount} (${getIntensityName(segName, settings.lang)}) • Action ${actIdx+1}/${actionsInSeg}`;
  document.getElementById('action-meta').textContent = meta;
}

/* ---------- Session loop ---------- */
async function runCountdown(totalSec){
  // Renvoie 'done' si terminé naturellement, sinon la commande utilisateur
  const base = performance.now();
  for(let left=totalSec; left>=0; left--){
    if(cancelled) return 'stop_session';
    while(paused){ await sleep(120); if(cancelled) return 'stop_session'; }

    currentLeft = left; currentTotal = totalSec;
    setTimer(left, totalSec);

    // Interception des commandes
    if (control.request){
      const req = control.request;
      control.request = null;
      return req;
    }

    if(left>0){
      const target = base + (totalSec - (left-1))*1000;
      const wait = Math.max(0, target - performance.now());
      await sleep(wait);
    }
  }
  return 'done';
}

async function startSession(){
  if(running) return;
  if(!data){ alert('data.json manquant'); return; }
  refreshPlan();
  await ensureVoices();

  running = true; cancelled = false; paused = false;
  control.request = null;
  segIdx = 0; actIdx = 0; currentLeft = 0; currentTotal = 0;

  setUIState('running');
  if (document.getElementById('keep-awake').checked) {
    const ok = await enableWakeLock();
    if(!ok) startAudioKeepAlive();
  } else {
    startAudioKeepAlive(); // garde l’audio en vie pour iOS
  }

  outer: while(running && !cancelled && segIdx < currentPlan.length){
    const seg = currentPlan[segIdx];
    const segName = seg[0]?.segment || 'L1';
    setTheme(segName);

    while(running && !cancelled && actIdx < seg.length){
      const act = seg[actIdx];
      tts.cancel();
      setActionTexts(act.text, act.text_zh);
      setMeta();
      interruptAndSpeakCNFR(tts, act.text_zh, act.text, voices);

      currentTotal = act.duration;
      const reason = await runCountdown(act.duration);
      if(cancelled || reason === 'stop_session') break outer;

      // Petite période de cooldown entre actions si on n'a pas sauté/segment
      const afterCooldown = async () => {
        const cd = settings.cooldownSec || 0;
        if(cd > 0){
          setActionTexts('—','—');
          await runCountdown(cd); // on réutilise runCountdown (prend en compte pause/stop)
        }
      };

      switch(reason){
        case 'done':
        case 'skip_action':
          await afterCooldown();
          actIdx++;
          break;
        case 'prev_action': {
          // Si on a déjà parcouru >2s, on redémarre l'action; sinon on remonte à l'action précédente
          const elapsed = currentTotal - currentLeft;
          if (elapsed > 2) {
            // redémarrer la même action
            // (actIdx inchangé)
          } else {
            if (actIdx > 0) {
              actIdx--;
            } else if (segIdx > 0) {
              segIdx--;
              actIdx = currentPlan[segIdx].length - 1;
              // Mettre à jour le thème du segment précédent
              const prevSegName = currentPlan[segIdx][0]?.segment || 'L1';
              setTheme(prevSegName);
            } // sinon on reste au tout début
          }
          break;
        }
        case 'next_segment':
          // passe immédiatement au segment suivant
          segIdx++;
          actIdx = 0;
          continue outer;
        default:
          // restart_action (optionnel) / autres
          break;
      }
    }

    // Fin du segment courant → prochain
    segIdx++;
    actIdx = 0;
  }

  stopSession();
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
  control.request = null;
  tts.cancel();
  setActionTexts('—','—'); setTimer(0,0);
  setMeta();
  setUIState('idle');
  stopAudioKeepAlive(); disableWakeLock();
}

/* ---------- Draw tab ---------- */
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

/* ---------- Micro-interactions ---------- */
document.addEventListener('pointerdown', (e)=>{
  const b = e.target.closest('button');
  if(!b) return;
  const rect = b.getBoundingClientRect();
  b.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  b.style.setProperty('--my', `${e.clientY - rect.top}px`);
});

// Tilt subtil
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
(() => {
  if (reduceMotion) return;
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
