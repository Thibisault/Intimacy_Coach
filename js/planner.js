// planner.js — propage aussi l'image des templates vers l'action finale
import { randInt } from './util.js';

function templateKey(seg, actionId, text){ return `${seg}|${actionId}|${text}`; }

function applyFilters(templates, filters){
  return templates.filter(t=>{
    const tags = t.tags||[];
    if(filters.anal && tags.includes('anal')) return false;
    if(filters.hard && tags.includes('hard')) return false;
    if(filters.clothed && tags.includes('clothed')) return false;
    return true;
  });
}

/** Fabrique le "pool" de choix pour un segment.
 *  >>> NOUVEAU: on met déjà une propriété "image" sur chaque entrée.
 */
function poolForSegment(data, segment, filters, actorExpected){
  if(segment === 'SEXE'){
    const items = [];
    for(const pos of data.sexe_positions || []){
      for(const tpl of applyFilters(pos.templates || [], filters)){
        const image = tpl.image || tpl.illustration || tpl.img || tpl.picture || pos.image || null;
        items.push({
          key: templateKey('SEXE', pos.id, tpl.text),
          tpl,
          actor: 'both',
          target: 'both',
          image
        });
      }
    }
    return items;
  }

  const levelNum = parseInt(segment.replace('L',''), 10);
  const level = (data.preliminaires_levels || []).find(l => l.niveau === levelNum);
  if(!level) return [];

  const items = [];
  for(const act of level.actions || []){
    if(actorExpected && act.actor && actorExpected !== 'any' && act.actor !== actorExpected) continue;
    const tpls = applyFilters(act.templates || [], filters);
    for(const tpl of tpls){
      const image = tpl.image || tpl.illustration || tpl.img || tpl.picture || act.image || null;
      items.push({
        key: templateKey(segment, act.id, tpl.text),
        tpl,
        actor: act.actor,
        target: act.target,
        image
      });
    }
  }

  // fallback si filtrage trop strict
  if(actorExpected && items.length === 0){
    for(const act of level.actions || []){
      const tpls = applyFilters(act.templates || [], filters);
      for(const tpl of tpls){
        const image = tpl.image || tpl.illustration || tpl.img || tpl.picture || act.image || null;
        items.push({
          key: templateKey(segment, act.id, tpl.text),
          tpl,
          actor: act.actor,
          target: act.target,
          image
        });
      }
    }
  }
  return items;
}

function nextActor(mode, idx){
  if(mode==='random') return 'any';
  if(mode==='female-male-both'){ const seq=['P2','P1','both']; return seq[idx % seq.length]; }
  if(mode==='just-female') return 'P2';
  if(mode==='just-male') return 'P1';
  if(mode==='just-both') return 'both';
  return 'any';
}

export function buildPlan(settings, data){
  const used = new Set();
  const plan = [];
  let actorIdx = 0;

  for(const step of settings.sequence){
    const seg = step.segment;
    let remain = Math.max(0, Math.floor(step.minutes * 60));
    const { min, max } = settings.ranges[seg];
    const segActions = [];
    let safety = 2000;

    while(remain >= min && safety-- > 0){
      const actorExpected = nextActor(settings.actorMode, actorIdx);
      let pool = poolForSegment(data, seg, settings.filters, actorExpected).filter(x => !used.has(x.key));
      if(pool.length === 0) break;

      const pick = pool[randInt(0, pool.length - 1)];
      const dur = randInt(min, max);
      const withNames = (s)=>s.replaceAll('{P1}', settings.participants.P1).replaceAll('{P2}', settings.participants.P2);

      segActions.push({
        segment: seg,
        actor: pick.actor,
        target: pick.target,
        text: withNames(pick.tpl.text),
        text_zh: withNames(pick.tpl.text_zh || ''),
        duration: dur,
        // >>> NOUVEAU: on met l'image sur l'action
        image: pick.image || null
      });

      used.add(pick.key);
      remain -= dur;
      actorIdx++;
    }
    plan.push(segActions);
  }
  return plan;
}

export function drawOne(settings, data, segment, filters){
  const picks = [];

  if(segment === 'SEXE'){
    for(const pos of (data.sexe_positions || [])){
      for(const tpl of applyFilters(pos.templates || [], filters)){
        const image = tpl.image || tpl.illustration || tpl.img || tpl.picture || pos.image || null;
        picks.push({ actor:'both', target:'both', tpl, image });
      }
    }
  } else {
    const levelNum = parseInt(segment.replace('L',''), 10);
    const level = (data.preliminaires_levels || []).find(l => l.niveau === levelNum);
    if(level){
      for(const act of level.actions || []){
        for(const tpl of applyFilters(act.templates || [], filters)){
          const image = tpl.image || tpl.illustration || tpl.img || tpl.picture || act.image || null;
          picks.push({ actor:act.actor, target:act.target, tpl, image });
        }
      }
    }
  }

  if(!picks.length) return null;
  const idx = Math.floor(Math.random() * picks.length);
  const { actor, target, tpl, image } = picks[idx];
  const withNames = (s)=>s.replaceAll('{P1}', settings.participants.P1).replaceAll('{P2}', settings.participants.P2);

  return {
    segment,
    actor,
    target,
    text: withNames(tpl.text),
    text_zh: withNames(tpl.text_zh || ''),
    // >>> NOUVEAU: renvoyer l'image pour le tirage
    image: image || null
  };
}
