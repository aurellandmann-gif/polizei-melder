self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{if(e.request.mode==="navigate")e.respondWith(fetch(e.request).catch(()=>new Response("Keine Verbindung",{status:503})))});
self.addEventListener("push",e=>{let d={};try{d=e.data.json()}catch{}e.waitUntil(self.registration.showNotification(d.title||"Neue Meldung",{body:d.body||"",icon:"/icon-192.png",badge:"/icon-192.png",data:{url:d.url||"/"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("focus"in c)return c.focus()}return clients.openWindow(e.notification.data.url||"/")}))});
