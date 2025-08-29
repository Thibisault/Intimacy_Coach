export type Segment = 'L1'|'L2'|'L3'|'L4'|'L5'|'SEXE'
export type Step = { segment: Segment; minutes: number }
export type Ranges = { [seg in Segment]: { min:number; max:number } }

export type Settings = {
  participants: { P1: string; P2: string }
  sequence: Step[]
  ranges: Ranges
  cooldownSec: number
  actorMode: 'random'|'p1p2both'|'p1p1p2both'
  filters: { anal: boolean; hard: boolean; clothed: boolean }
  lang: 'fr'|'zh'
}

export type TemplateLine = { text: string; text_zh?: string; tags?: string[] }
export type ActionBlock = {
  id: string
  actor: 'P1'|'P2'|'both'
  target: 'P1'|'P2'|'both'
  templates: TemplateLine[]
}
export type Level = { niveau: number; actions: ActionBlock[] }
export type DataFile = { preliminaires_levels: Level[]; sexe_positions: { id:string; templates: TemplateLine[] }[] }

export type PlannedAction = {
  segment: Segment
  actor: 'P1'|'P2'|'both'
  key: string
  text: string
  text_zh?: string
  durationSec: number
}

export const defaultSettings: Settings = {
  participants: { P1: 'P1', P2: 'P2' },
  sequence: [
    { segment: 'L1', minutes: 2 },
    { segment: 'L2', minutes: 3 },
    { segment: 'L3', minutes: 4 },
    { segment: 'L4', minutes: 4 },
    { segment: 'L5', minutes: 4 },
    { segment: 'SEXE', minutes: 5 },
  ],
  ranges: {
    L1: { min: 15, max: 35 },
    L2: { min: 20, max: 40 },
    L3: { min: 25, max: 45 },
    L4: { min: 25, max: 50 },
    L5: { min: 25, max: 55 },
    SEXE: { min: 40, max: 90 },
  },
  cooldownSec: 8,
  actorMode: 'random',
  filters: { anal: false, hard: false, clothed: false },
  lang: 'fr'
}

const LS_KEY = 'sx-settings-v2'
export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) as Settings : null
  } catch { return null }
}
export function saveSettings(s: Settings){
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}