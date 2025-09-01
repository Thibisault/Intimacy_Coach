// app.js — lecteur fiable (Start/Pause/Stop + Prev/Skip/Next-segment) + autosave + draw + illustrations
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
let currentPlan = []; // Array<Array<Action>>
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

/* ---------- Illustrations helpers (NOUVEAU) ---------- */

// image par défaut (celle déjà utilisée par --visual-bg dans ton CSS)
const DEFAULT_VISUAL = './test.webp';

/** Résout un spec "image" en URL utilisable.
 *  - "Position-levrette.webp"  -> "./public/illustrations/positions/Position-levrette.webp"
 *  - "levrette"                -> "./public/illustrations/positions/levrette.webp"
 *  - "./public/…/X.webp"       -> inchangé (chemin absolu/relatif déjà fourni)
 */
function resolveImageUrl(spec) {
  if (!spec || typeof spec !== 'string') return null;
  const trimmed = spec.trim();
  if (trimmed.startsWith('.') || trimmed.startsWith('/')) return trimmed;
  // ajoute extension si absente
  const hasExt = /\.(webp|png|jpg|jpeg|avif)$/i.test(trimmed);
  const file = hasExt ? trimmed : `${trimmed}.webp`;
  return `./public/illustrations/positions/${file}`;
}

/** Applique une image au bloc visuel (met à jour la CSS var --visual-bg) */
function setVisualImage(url, targetId) {
  const el = document.getElementById(targetId);
  if (!el || !url) return;
  const u = encodeURI(url);
  el.style.setProperty('--visual-bg', `url("${u}")`);
  // préchargement léger
  const img = new Image();
  img.src = u;
}

/** Cherche une image sur un objet action (plusieurs alias possibles) */
function getImageSpecFromAction(act) {
  return act?.image ?? act?.illustration ?? act?.img ?? act?.picture ?? null;
}

/** Applique l'image d'une action si disponible (sinon ne touche à rien) */
function updateVisualFromAction(act, targetId) {
  const spec = getImageSpecFromAction(act);
  const url  = resolveImageUrl(spec);
  if (url) setVisualImage(url, targetId);
}

/* ---------- Boot ---------- */
applyI18n(settings.lang);
initTabs();
wireLangButtons();
initSettingsUI();
wirePlayUI();
initDrawTab();
loadData();
wireVisibilityPause();

/* ---------- Data ---------- */
async function loadData(){
  try{
    const res = await fetch('./public/data.json?' + Date.now());
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
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
  const tabButtons = document.querySelectorAll('.tabs .tab');
  const panels = document.querySelectorAll('.tabpanel');

  const setActiveTab = (id) => {
    tabButtons.forEach(b => {
      const active = b.dataset.tab === id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    panels.forEach(p => {
      const active = p.id === 'tab-' + id;
      p.classList.toggle('active', active);
      p.setAttribute('aria-hidden', String(!active));
    });
  };

  tabButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const currentTab = document.querySelector('.tabs .tab.active')?.dataset.tab;
      const nextTab = btn.dataset.tab;

      // Quitter Play => autopause (et coupe TTS)
      if(currentTab === 'play' && nextTab !== 'play' && running){
        pauseSession();
      }
      if(nextTab !== 'play'){ try { tts.cancel(); speechSynthesis.cancel(); } catch {} }

      setActiveTab(nextTab);

      // Sur "settings": fermer les accordéons par défaut
      if(nextTab === 'settings'){
        document.querySelectorAll('#tab-settings details.accordion').forEach(d => d.open = false);
      }
    });
  });

  // état initial
  setActiveTab(document.querySelector('.tabs .tab.active')?.dataset.tab || 'play');
}

/* ---------- Lang ---------- */
function wireLangButtons(){
  const frBtn = document.getElementById('btn-fr');
  const zhBtn = document.getElementById('btn-zh');

  const setActive = (lang) => {
    settings.lang = lang;
    applyI18n(lang);

    // Rafraîchir les zones construites dynamiquement
    window._refreshSequence?.();
    window._refreshAddControls?.();
    window._refreshRanges?.();
    window._refreshActorButtons?.();
    initDrawTab.refresh?.();

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
  if (p1) p1.value = settings.participants.P1;
  if (p2) p2.value = settings.participants.P2;

  const commitNames = () => {
    settings.participants.P1 = (p1?.value || 'Homme').trim() || 'Homme';
    settings.participants.P2 = (p2?.value || 'Femme').trim() || 'Femme';
    saveSettings(settings);
    window._refreshActorButtons?.();
  };
  p1?.addEventListener('input', commitNames);
  p2?.addEventListener('input', commitNames);

  // Actor mode
  const amWrap = document.getElementById('actor-mode-buttons');
  function actorLabel(mode){
    const male = p1?.value || 'Homme';
    const female = p2?.value || 'Femme';
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
    if(!amWrap) return;
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
      // nudge Safari/iOS
      try { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch {}
      setTimeout(res, 400);
    });
    const vs = speechSynthesis.getVoices() || [];
    const frSel = document.getElementById('sel-voice-fr');
    const zhSel = document.getElementById('sel-voice-zh');
    function fill(sel, pref, langPrefix){
      if(!sel) return;
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
    frSel && (frSel.onchange = ()=>{ settings.voicePrefs.fr = frSel.value || null; saveSettings(settings); });
    zhSel && (zhSel.onchange = ()=>{ settings.voicePrefs.zh = zhSel.value || null; saveSettings(settings); });
  }
  fillVoices();

  // Filters (autosave)
  const syncFilters = () => {
    settings.filters = {
      anal: document.getElementById('def-anal')?.checked ?? true,
      hard: document.getElementById('def-hard')?.checked ?? true,
      clothed: document.getElementById('def-clothed')?.checked ?? true,
    };
    saveSettings(settings);
  };
  const chkAnal = document.getElementById('def-anal');
  const chkHard = document.getElementById('def-hard');
  const chkClothed = document.getElementById('def-clothed');
  if(chkAnal) chkAnal.checked = !!settings.filters.anal;
  if(chkHard) chkHard.checked = !!settings.filters.hard;
  if(chkClothed) chkClothed.checked = !!settings.filters.clothed;
  chkAnal?.addEventListener('change', syncFilters);
  chkHard?.addEventListener('change', syncFilters);
  chkClothed?.addEventListener('change', syncFilters);

  // Sequence editor
  const seqList = document.getElementById('sequence-list');
  function redrawSequence(){
    if(!seqList) return;
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
      del.type = 'button';
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
    if(!addChipsCont) return;
    addChipsCont.innerHTML = '';
    ['L1','L2','L3','L4','L5','SEXE'].forEach(seg=>{
      const b = document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.type = 'button';
      b.className = `intensity-chip ${cls}` + (addSegCurrent===seg?' active':'');
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick = ()=>{ addSegCurrent = seg; redrawAddControls(); };
      addChipsCont.appendChild(b);
    });
  }
  redrawAddControls();
  window._refreshAddControls = redrawAddControls;

  document.getElementById('btn-add-step')?.addEventListener('click', ()=>{
    const minutes = parseInt(document.getElementById('inp-add-min')?.value,10) || 3;
    settings.sequence.push({ segment:addSegCurrent, minutes });
    redrawSequence(); saveSettings(settings);
  });

  // Ranges
  const rg = document.querySelector('.ranges-grid');
  function redrawRanges(){
    if(!rg) return;
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
  document.getElementById('btn-test-voices')?.addEventListener('click', async ()=>{
    await ensureVoices();
    tts.enqueueCNFR('这是中文测试。', 'Ceci est un test français.', voices);
  });
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

  startBtn?.addEventListener('click', () => {
    if (paused && running) { resumeSession(); return; }
    tts.cancel(); startSession();
  });
  pauseBtn?.addEventListener('click', () => { pauseSession(); });
  stopBtn?.addEventListener('click',  () => { control.request = 'stop_session'; tts.cancel(); stopSession(); });

  prevBtn?.addEventListener('click', () => { if (running) control.request = 'prev_action'; });
  skipBtn?.addEventListener('click', () => { if (running) control.request = 'skip_action'; });
  nextBtn?.addEventListener('click', () => { if (running) control.request = 'next_segment'; });

  document.getElementById('keep-awake')?.addEventListener('change', async (e)=>{
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
    if (startBtn){ startBtn.hidden = false; startBtn.disabled = false; }
    if (pauseBtn){ pauseBtn.hidden = true;  pauseBtn.disabled = true; }
    if (stopBtn){ stopBtn.disabled = true; }
    if (prevBtn){ prevBtn.disabled = true; }
    if (skipBtn){ skipBtn.disabled = true; }
    if (nextBtn){ nextBtn.disabled = true; }
    // UI neutre
    setActionTexts('—','—');
    setTimer(0,0);
    const metaElIdle = document.getElementById('action-meta');
    if (metaElIdle) metaElIdle.textContent = '—';
    // remet l'image par défaut
    setVisualImage(DEFAULT_VISUAL, 'action-visual');
  }
  if(state === 'running'){
    if (startBtn){ startBtn.hidden = true; }
    if (pauseBtn){ pauseBtn.hidden = false; pauseBtn.disabled = false; }
    if (stopBtn){ stopBtn.disabled = false; }
    if (prevBtn){ prevBtn.disabled = false; }
    if (skipBtn){ skipBtn.disabled = false; }
    if (nextBtn){ nextBtn.disabled = false; }
  }
  if(state === 'paused'){
    if (startBtn){ startBtn.hidden = false; startBtn.disabled = false; }
    if (pauseBtn){ pauseBtn.hidden = true;  pauseBtn.disabled = true; }
    if (stopBtn){ stopBtn.disabled = false; }
    if (prevBtn){ prevBtn.disabled = false; }
    if (skipBtn){ skipBtn.disabled = false; }
    if (nextBtn){ nextBtn.disabled = false; }
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
      try { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch {}
      setTimeout(ready, 500);
    }
  });
}

/* ---------- Theme / UI helpers ---------- */
function setTheme(seg){
  const card = document.getElementById('action-card');
  if (card){
    card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
    card.classList.add(themeClass(seg));
  }
  document.body.setAttribute('data-intensity', seg);
  const name = getIntensityName(seg, settings.lang);
  const badge = document.getElementById('badge-segment');
  if (badge) badge.textContent = name;

  const drawCard = document.getElementById('draw-card');
  if (drawCard) {
    drawCard.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
    drawCard.classList.add(themeClass(seg));
  }
}
function setActionTexts(fr, zh){
  const frN = document.getElementById('text-fr');
  const zhN = document.getElementById('text-zh');
  if (frN) frN.textContent = fr ?? '—';
  if (zhN) zhN.textContent = zh ?? '—';
}
function setTimer(left, total){
  const leftEl  = document.getElementById('time-left');
  const totalEl = document.getElementById('time-total');
  if (leftEl)  leftEl.textContent  = formatMMSS(left);
  if (totalEl) totalEl.textContent = formatMMSS(total);

  const pct = total ? ((total - left) / total) * 100 : 0;
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = pct.toFixed(2) + '%';
}

function setMeta(){
  const metaEl = document.getElementById('action-meta');
  if(!running){
    if (metaEl) metaEl.textContent = '—';
    return;
  }
  const segCount    = currentPlan?.length || 0;
  const actionsInSeg= currentPlan?.[segIdx]?.length || 0;
  const segName     = currentPlan?.[segIdx]?.[0]?.segment || 'L1';
  const meta = `${dict[settings.lang]?.segment || 'Segment'} ${segIdx+1}/${segCount} `
             + `(${getIntensityName(segName, settings.lang)}) • `
             + `${dict[settings.lang]?.action || 'Action'} ${actIdx+1}/${actionsInSeg}`;
  if (metaEl) metaEl.textContent = meta;
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
  if (document.getElementById('keep-awake')?.checked) {
    const ok = await enableWakeLock();
    if(!ok) startAudioKeepAlive();
  } else {
    // même si non coché, on démarre le ping audio pour iOS afin d'autoriser le TTS continu
    startAudioKeepAlive();
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

      // >>> NOUVEAU : applique l'illustration de l'action si fournie
      updateVisualFromAction(act, 'action-visual');

      interruptAndSpeakCNFR(tts, act.text_zh, act.text, voices);

      currentTotal = act.duration;
      const reason = await runCountdown(act.duration);
      if(cancelled || reason === 'stop_session') break outer;

      // Petite période de cooldown entre actions si on n'a pas sauté/segment
      const afterCooldown = async () => {
        const cd = settings.cooldownSec || 0;
        if(cd > 0 && (reason === 'done' || reason === 'skip_action')){
          setActionTexts('—','—');
          await runCountdown(cd); // prend en compte pause/stop
        }
      };

      switch(reason){
        case 'done':
        case 'skip_action':
          await afterCooldown();
          actIdx++;
          break;

        case 'prev_action': {
          const elapsed = currentTotal - currentLeft;
          if (elapsed > 2) {
            // redémarrer la même action (actIdx inchangé)
          } else if (actIdx > 0) {
            actIdx--;
          } else if (segIdx > 0) {
            segIdx--;
            actIdx = currentPlan[segIdx].length - 1;
            const prevSegName = currentPlan[segIdx][0]?.segment || 'L1';
            setTheme(prevSegName);
          }
          break;
        }

        case 'next_segment':
          segIdx++;
          actIdx = 0;
          continue outer;

        default:
          // restart_action (si besoin)
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
  setUIState('idle');
  stopAudioKeepAlive(); disableWakeLock();
}

/* ---------- Draw tab ---------- */
function initDrawTab(){
  const cont = document.getElementById('draw-intensity-chips');
  const segs = ['L1','L2','L3','L4','L5','SEXE'];
  let current = 'L1';

  function drawChips(){
    if(!cont) return;
    cont.innerHTML = '';
    segs.forEach(seg=>{
      const b = document.createElement('button');
      const cls = seg==='SEXE' ? 'sexe' : ('level'+parseInt(seg.replace('L',''),10));
      b.className = `intensity-chip ${cls}` + (current===seg?' active':'');
      b.type = 'button';
      b.textContent = getIntensityName(seg, settings.lang);
      b.onclick = ()=>{ current=seg; document.body.setAttribute('data-intensity', seg); drawChips(); };
      cont.appendChild(b);
    });
  }
  drawChips();
  initDrawTab.refresh = ()=>drawChips();

  document.getElementById('btn-draw-play')?.addEventListener('click', async ()=>{
    if(!data){ alert('data.json manquant'); return; }
    await ensureVoices();
    const pick = drawOne(settings, data, current, settings.filters);

    const card = document.getElementById('draw-card');
    if(card){
      card.classList.remove('hidden');
      card.classList.remove('theme-level1','theme-level2','theme-level3','theme-level4','theme-level5','theme-sexe');
      card.classList.add(themeClass(current));
    }

    const fr = document.getElementById('draw-fr');
    const zh = document.getElementById('draw-zh');
    if(fr) fr.textContent = pick ? pick.text : '—';
    if(zh) zh.textContent = pick ? (pick.text_zh || '—') : '—';

    // >>> NOUVEAU : illustration aussi pour le tirage simple
    if (pick) updateVisualFromAction(pick, 'draw-visual');

    if(pick){ interruptAndSpeakCNFR(tts, pick.text_zh, pick.text, voices); }
  });
}

/* ---------- Auto-pause quand l’onglet est masqué ---------- */
function wireVisibilityPause(){
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden && running && !paused){
      pauseSession();
    }
  });
}

/* ---------- Micro-interactions ---------- */
document.addEventListener('pointerdown', (e)=>{
  const b = e.target.closest?.('button');
  if(!b) return;
  const rect = b.getBoundingClientRect();
  b.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  b.style.setProperty('--my', `${e.clientY - rect.top}px`);
});

// Tilt subtil
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
(()=>{
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
