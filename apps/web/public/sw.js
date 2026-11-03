// Never cache authenticated pages or API responses.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data={title:'Trusteo',body:'Un nouvel avis attend votre attention.',url:'/app/reviews'};
  try { if(event.data) data={...data,...event.data.json()}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',badge:'/icon-192.png',data:{url:data.url},tag:data.tag||'trusteo-review'}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=new URL(event.notification.data?.url||'/app/reviews',self.location.origin);if(url.origin!==self.location.origin)return;event.waitUntil(self.clients.openWindow(url.href));});
