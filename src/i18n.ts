export type Lang = 'fr' | 'zh'

type Dict = {
  segNames: Record<string, string>
  play: string
  customize: string
  language: string
  start: string
  pause: string
  resume: string
  stop: string
  planning: string
  announcing: string
  action: string
  cooldown: string
  currentSegment: string
  next: string
  filters: string
  anal: string
  hard: string
  clothed: string
  actorCycle: string
  random: string
  p1p2both: string
  p1p1p2both: string
  participants: string
  p1: string
  p2: string
  ranges: string
  min: string
  max: string
  cooldownSec: string
  sequence: string
  addStep: string
  remove: string
  up: string
  down: string
  testVoice: string
  emptyData: string
}

const fr: Dict = {
  segNames: {
    L1: 'Éveil',
    L2: 'Chaleur',
    L3: 'Fièvre',
    L4: 'Fusion',
    L5: 'Extase',
    SEXE: 'Positions',
  },
  play: 'Jouer',
  customize: 'Personnaliser',
  language: 'Langue',
  start: 'Démarrer',
  pause: 'Pause',
  resume: 'Reprendre',
  stop: 'Stop',
  planning: 'Planification…',
  announcing: 'Annonce (CN → FR)…',
  action: 'Action',
  cooldown: 'Repos',
  currentSegment: 'Segment courant',
  next: 'Suivante',
  filters: 'Filtres (exclure)',
  anal: 'anal',
  hard: 'hard',
  clothed: 'clothed',
  actorCycle: 'Cycle d’acteurs',
  random: 'Aléatoire',
  p1p2both: 'P1 → P2 → Mutuelle',
  p1p1p2both: 'P1 → P1 → P2 → Mutuelle',
  participants: 'Participants',
  p1: 'Nom P1',
  p2: 'Nom P2',
  ranges: 'Durées (sec) par segment',
  min: 'min',
  max: 'max',
  cooldownSec: 'Cooldown (sec)',
  sequence: 'Séquence',
  addStep: 'Ajouter un step',
  remove: 'Supprimer',
  up: '↑',
  down: '↓',
  testVoice: 'Test voix',
  emptyData: 'Collez votre data.json dans /public/data.json puis rechargez.',
}

const zh: Dict = {
  segNames: {
    L1: '觉醒',
    L2: '升温',
    L3: '炽热',
    L4: '融合',
    L5: '巅峰',
    SEXE: '体位',
  },
  play: '开始',
  customize: '自定义',
  language: '语言',
  start: '开始',
  pause: '暂停',
  resume: '继续',
  stop: '停止',
  planning: '规划中…',
  announcing: '播报（中文→法语）…',
  action: '执行',
  cooldown: '休息',
  currentSegment: '当前分段',
  next: '下一条',
  filters: '过滤（排除）',
  anal: '肛交',
  hard: '激烈',
  clothed: '隔衣',
  actorCycle: '角色循环',
  random: '随机',
  p1p2both: 'P1 → P2 → 共同',
  p1p1p2both: 'P1 → P1 → P2 → 共同',
  participants: '参与者',
  p1: 'P1 名称',
  p2: 'P2 名称',
  ranges: '每段时长（秒）',
  min: '最少',
  max: '最多',
  cooldownSec: '休息（秒）',
  sequence: '顺序',
  addStep: '添加步骤',
  remove: '删除',
  up: '↑',
  down: '↓',
  testVoice: '测试语音',
  emptyData: '请将 data.json 粘贴到 /public/data.json 并刷新页面。',
}

export const t = (lang: Lang): Dict => (lang === 'zh' ? zh : fr)
