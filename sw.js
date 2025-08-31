const CACHE='ic-v1';
const ASSETS=[
  './index.html','./styles.css',
  './js/i18n.js','./js/util.js','./js/storage.js','./js/audio.js','./js/tts.js','./js/wake-lock.js','./js/planner.js','./js/app.js',
  './manifest.webmanifest'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(url.origin===location.origin){
    e.respondWith(caches.match(e.request).then(res=>res||fetch(e.request)));
  }
});
