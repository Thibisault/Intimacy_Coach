export const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
export const randInt = (min, max)=>Math.floor(Math.random()*(max-min+1))+min;
export const clamp = (v, a, b)=>Math.max(a, Math.min(b, v));
export const formatMMSS = (s)=>{
  const m = Math.floor(s/60).toString().padStart(2,'0');
  const ss = Math.floor(s%60).toString().padStart(2,'0');
  return `${m}:${ss}`;
};
export const SEGMENTS = ["L1","L2","L3","L4","L5","SEXE"];
export const themeClass = (seg)=>({L1:"theme-level1",L2:"theme-level2",L3:"theme-level3",L4:"theme-level4",L5:"theme-level5",SEXE:"theme-sexe"}[seg]);
