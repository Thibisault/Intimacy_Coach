const KEY='sx-settings-v2';
export function loadSettings(){
  try{const x = JSON.parse(localStorage.getItem(KEY)||'null'); return x || null;}catch{ return null; }
}
export function saveSettings(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
