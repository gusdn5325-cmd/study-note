const CACHE='hn-v10';
const ASSETS=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request, u=new URL(req.url);
  if(req.method!=='GET'||u.origin!==location.origin) return;          // API 호출은 통과
  const isDoc = req.mode==='navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/');
  if(isDoc){                                                          // 문서: 네트워크 우선 → 최신본 즉시 반영
    e.respondWith(fetch(req).then(res=>{
      const cp=res.clone(); caches.open(CACHE).then(c=>c.put(req,cp).catch(()=>{})); return res;
    }).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));
  }else{                                                              // 정적자원: 캐시 우선
    e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{
      const cp=res.clone(); caches.open(CACHE).then(c=>c.put(req,cp).catch(()=>{})); return res;
    })));
  }
});
