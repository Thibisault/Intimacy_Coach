import { DataFile, PlannedAction, Settings, TemplateLine, Segment } from '../types'

type Filters = Settings['filters']
const randInt = (min:number, max:number) => Math.floor(Math.random()*(max-min+1))+min
const segToLevel = (seg:Segment) => seg==='SEXE' ? null : Number(seg.slice(1))

function poolForSegment(data:DataFile, segment:Segment, filters:Filters){
  const out: { key:string; tpl:TemplateLine; actor:'P1'|'P2'|'both' }[] = []
  if(segment==='SEXE'){
    for(const pos of data.sexe_positions || []){
      for(const tpl of pos.templates || []){
        if(excluded(tpl, filters)) continue
        const key = `${segment}|${pos.id}|${tpl.text}`
        out.push({ key, tpl, actor:'both' })
      }
    }
    return out
  }
  const lvl = segToLevel(segment)
  const level = (data.preliminaires_levels||[]).find(l => l.niveau===lvl)
  if(!level) return out
  for(const act of level.actions || []){
    for(const tpl of act.templates || []){
      if(excluded(tpl, filters)) continue
      const key = `${segment}|${act.id}|${tpl.text}`
      out.push({ key, tpl, actor: act.actor })
    }
  }
  return out
}

function excluded(tpl:TemplateLine, filters:Filters){
  if(!tpl.tags || !tpl.tags.length) return false
  const set = new Set(tpl.tags)
  if(filters.anal && set.has('anal')) return true
  if(filters.hard && set.has('hard')) return true
  if(filters.clothed && set.has('clothed')) return true
  return false
}


export type PlanResult = { bySegment: PlannedAction[][], flat: PlannedAction[] }

export function buildPlan(settings:Settings, data:DataFile): PlanResult {
  const used = new Set<string>()
  const bySegment: PlannedAction[][] = []
  const flat: PlannedAction[] = []
  const cycles = settings.actorMode==='p1p2both' ? ['P1','P2','both'] as const
               : settings.actorMode==='p1p1p2both' ? ['P1','P1','P2','both'] as const
               : ['*'] as const
  let cycleIdx = 0

  for(const step of settings.sequence){
    const { min, max } = settings.ranges[step.segment]
    let remain = Math.round(step.minutes * 60)
    const poolAll = poolForSegment(data, step.segment, settings.filters)
    const segmentPicks: PlannedAction[] = []

    while(remain >= min && poolAll.length){
      let pool = poolAll.filter(x => !used.has(x.key))
      if(!pool.length) break
      const expected = cycles[cycleIdx % cycles.length]
      if(expected!=='*'){
        const sub = pool.filter(x => x.actor===expected)
        if(sub.length) pool = sub
      }
      const i = randInt(0, pool.length-1)
      const pick = pool.splice(i,1)[0]
      const durationSec = randInt(min, max)
      used.add(pick.key)
      const planned: PlannedAction = {
        segment: step.segment,
        actor: pick.actor,
        key: pick.key,
        text: pick.tpl.text,
        text_zh: pick.tpl.text_zh,
        durationSec
      }
      segmentPicks.push(planned)
      flat.push(planned)
      remain -= durationSec
      cycleIdx++
    }
    bySegment.push(segmentPicks)
  }
  return { bySegment, flat }
}