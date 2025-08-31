export const dict = {
  fr: {
    tab_play: "Jouer", tab_settings: "Personnaliser", tab_draw:"Tirage simple",
    filter_anal: "Exclure anal", filter_hard: "Exclure hard", filter_clothed: "Exclure clothed",
    shuffle: "Nouveau tirage", start: "Démarrer", pause:"Pause", resume:"Reprendre", stop:"Stop",
    keep_awake:"Garder l’écran allumé pendant la session",
    participants:"Participants", actor_cycle:"Cycle acteurs",
    test_voices:"Tester les voix",
    filters_title:"Exclusions par défaut",
    sequence:"Séquence",
    add_step:"Ajouter",
    durations:"Durées min/max par segment (sec)",
    save:"Enregistrer", reset:"Réinitialiser", export:"Exporter", import:"Importer",
    offline_ready:"PWA hors-ligne",
    man_name:"Nom homme", woman_name:"Nom femme", play_btn:"Jouer",
    voices_title:"Voix",
    minutes_label:"Minutes",
    unit_min:"min",
    unit_s:"s",
    min_label:"min",
    max_label:"max",

    
  },
  zh: {
    tab_play: "开始", tab_settings: "自定义", tab_draw:"单次抽取",
    filter_anal: "排除 肛交", filter_hard: "排除 高强度", filter_clothed: "排除 隔衣",
    shuffle: "重新抽取", start: "开始", pause:"暂停", resume:"继续", stop:"停止",
    keep_awake:"会话期间保持屏幕常亮",
    participants:"参与者", actor_cycle:"角色循环",
    test_voices:"测试语音",
    filters_title:"默认筛选",
    sequence:"顺序",
    add_step:"添加",
    durations:"每段最小/最大时长（秒）",
    save:"保存", reset:"重置", export:"导出", import:"导入",
    offline_ready:"离线可用 PWA",
    man_name:"男性姓名", woman_name:"女性姓名", play_btn:"开始",
    voices_title:"语音",
    minutes_label:"分钟",
    unit_min:"分",
    unit_s:"秒",
    min_label:"最小",
    max_label:"最大",
  }
};
export function applyI18n(lang){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    const val = dict[lang]?.[key] ?? dict["fr"][key] ?? key;
    el.textContent = val;
  });
}
export const intensityNames = {
  fr: { L1:'Éveil', L2:'Frisson', L3:'Ardeur', L4:'Fièvre', L5:'Apogée', SEXE:'Union' },
  zh: { L1:'初醒', L2:'微颤', L3:'炽热', L4:'热潮', L5:'巅峰', SEXE:'交融' }
};
export function getIntensityName(seg, lang){ return (intensityNames[lang]||intensityNames['fr'])[seg]||seg; }
