"use strict";

/*
  Zad Al-Khair service worker — production final.
  Cache domains are intentionally separated so an interface update never forces
  a re-download of the Mushaf, and a Tafsir correction never invalidates QCF4.
*/
const SHELL_CACHE="zad-shell-v101";
const QURAN_CACHE="zad-quran-core-v1";
const TAFSIR_CACHE="zad-tafsir-alwajeez-v1";
const AUDIO_CACHE="zad-audio-v1";
const RUNTIME_CACHE="zad-runtime-v101";
const LEGACY_QURAN_CACHE="zad-quran-v80";

const QCF_BASE="https://cdn.jsdelivr.net/npm/quran-qcf4@1.0.3/";
const QUL_HEADER="https://static-cdn.tarteel.ai/qul/fonts/surah-names/surah-header/QCF_SurahHeader_COLOR-Regular.ttf";

const SHELL=[
  "./","./index.html","./reader.html","./manifest.json","./vendor/adhan-4.4.4.umd.min.js",
  "./fonts/alexandria-arabic-400-800.woff2","./fonts/alexandria-latin-400-800.woff2",
  "./fonts/amiri-arabic-400.woff2","./fonts/amiri-latin-400.woff2","./fonts/amiri-arabic-700.woff2","./fonts/amiri-latin-700.woff2",
  "./fonts/aref-ruqaa-arabic-400.woff2","./fonts/aref-ruqaa-arabic-700.woff2",
  "./icons/icon-32.png","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-512-maskable.png","./icons/zad-mark.svg","./icons/zad-mark-reverse.svg"
];
const QURAN_CORE=[QCF_BASE+"index.json",QCF_BASE+"verses.json",QCF_BASE+"fonts-woff2/QCF4_QBSML.woff2",QUL_HEADER];
const QURAN_FONTS=Array.from({length:47},(_,i)=>QCF_BASE+`fonts-woff2/QCF4_Hafs_${String(i+1).padStart(2,"0")}_W.woff2`);
const QURAN_PAGES=Array.from({length:604},(_,i)=>QCF_BASE+`pages/${String(i+1).padStart(3,"0")}.json`);
const QURAN_REQUIRED=[...QURAN_CORE,...QURAN_FONTS,...QURAN_PAGES];
const TAFSIR_REQUIRED=["./data/tafsir/al-wajeez/index.json","./data/tafsir/al-wajeez/fadl.json",...Array.from({length:114},(_,i)=>`./data/tafsir/al-wajeez/${String(i+1).padStart(3,"0")}.json`)];
const QURAN_MARKER="./__zad_quran_core_v1_ready__";
const TAFSIR_MARKER="./__zad_tafsir_alwajeez_v1_ready__";

function requestFor(url){
  return new Request(url,{credentials:url.startsWith("http")?"omit":"same-origin"});
}
function cacheable(response){
  return !!response&&(response.ok||response.type==="opaque");
}
async function putOne(cache,url){
  const req=requestFor(url);
  try{
    const hit=await cache.match(req);
    if(hit)return true;
    const response=await fetch(req);
    if(!cacheable(response))return false;
    await cache.put(req,response.clone());
    return true;
  }catch(_){return false}
}
async function allPresent(cache,urls){
  for(let i=0;i<urls.length;i+=32){
    const checks=await Promise.all(urls.slice(i,i+32).map(url=>cache.match(requestFor(url))));
    if(checks.some(item=>!item))return false;
  }
  return true;
}
async function markReady(cache,marker,value){
  await cache.put(new Request(marker),new Response(value,{headers:{"content-type":"text/plain"}}));
}
async function packState(){
  const [quran,tafsir]=await Promise.all([caches.open(QURAN_CACHE),caches.open(TAFSIR_CACHE)]);
  const [qm,tm]=await Promise.all([quran.match(QURAN_MARKER),tafsir.match(TAFSIR_MARKER)]);
  const quranReady=!!qm&&await allPresent(quran,QURAN_REQUIRED);
  const tafsirReady=!!tm&&await allPresent(tafsir,TAFSIR_REQUIRED);
  if(!quranReady&&qm)await quran.delete(QURAN_MARKER);
  if(!tafsirReady&&tm)await tafsir.delete(TAFSIR_MARKER);
  return {quranReady,tafsirReady,ready:quranReady&&tafsirReady};
}

async function migrateLegacyOfflinePack(){
  const names=await caches.keys();
  if(!names.includes(LEGACY_QURAN_CACHE))return;
  const legacy=await caches.open(LEGACY_QURAN_CACHE);
  const quran=await caches.open(QURAN_CACHE),tafsir=await caches.open(TAFSIR_CACHE);
  async function copySet(urls,target){
    for(let i=0;i<urls.length;i+=32){
      await Promise.all(urls.slice(i,i+32).map(async url=>{
        const req=requestFor(url);
        if(await target.match(req))return;
        const hit=await legacy.match(req);
        if(hit)await target.put(req,hit.clone());
      }));
    }
  }
  await Promise.all([copySet(QURAN_REQUIRED,quran),copySet(TAFSIR_REQUIRED,tafsir)]);
  if(await allPresent(quran,QURAN_REQUIRED))await markReady(quran,QURAN_MARKER,"quran-core-v1");
  if(await allPresent(tafsir,TAFSIR_REQUIRED))await markReady(tafsir,TAFSIR_MARKER,"tafsir-alwajeez-v1");
}
async function notifyAll(message){
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  await Promise.all(clients.map(client=>client.postMessage(message)));
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const shell=await caches.open(SHELL_CACHE);
    const results=await Promise.all(SHELL.map(url=>putOne(shell,url)));
    if(results.some(ok=>!ok))throw new Error("Zad shell precache incomplete");
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    await migrateLegacyOfflinePack();
    const keep=new Set([SHELL_CACHE,QURAN_CACHE,TAFSIR_CACHE,AUDIO_CACHE,RUNTIME_CACHE]);
    for(const key of await caches.keys()){
      if(key.startsWith("zad-")&&!keep.has(key))await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(request,primaryCache){
  const hit=await caches.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(cacheable(response)){
    const cache=await caches.open(primaryCache);
    await cache.put(request,response.clone());
  }
  return response;
}

async function networkFirst(request){
  const runtime=await caches.open(RUNTIME_CACHE);
  try{
    const response=await fetch(request);
    if(cacheable(response))await runtime.put(request,response.clone());
    return response;
  }catch(error){
    const hit=await caches.match(request);
    if(hit)return hit;
    if(request.mode==="navigate"){
      const url=new URL(request.url);
      const reader=/reader\.html$/i.test(url.pathname);
      const fallback=await caches.match(reader?"./reader.html":"./index.html");
      if(fallback)return fallback;
    }
    throw error;
  }
}

function isAudioUrl(url,request){
  return request.destination==="audio"||/\.(?:mp3|m4a|ogg|aac)(?:$|\?)/i.test(url.pathname);
}
function isAudioSupportUrl(url){
  return (url.hostname==="mp3quran.net"&&/^\/api\/v3\/ayat_timing(?:\/reads)?$/.test(url.pathname))||
    (url.hostname==="cdn.jsdelivr.net"&&/\/audio\/maher\/timestamps\/\d+\.json$/i.test(url.pathname));
}
function fullAudioRequest(request){
  return new Request(request.url,{method:"GET",mode:request.mode,credentials:request.credentials,redirect:"follow"});
}
async function rangedResponse(response,rangeHeader){
  if(!rangeHeader||response.type==="opaque")return response;
  const match=/bytes=(\d*)-(\d*)/i.exec(rangeHeader);
  if(!match)return response;
  const buffer=await response.arrayBuffer();
  const size=buffer.byteLength;
  let start=match[1]?Number(match[1]):0;
  let end=match[2]?Number(match[2]):size-1;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=size||end<start){
    return new Response(null,{status:416,headers:{"Content-Range":`bytes */${size}`}});
  }
  end=Math.min(end,size-1);
  const headers=new Headers(response.headers);
  headers.set("Accept-Ranges","bytes");
  headers.set("Content-Range",`bytes ${start}-${end}/${size}`);
  headers.set("Content-Length",String(end-start+1));
  return new Response(buffer.slice(start,end+1),{status:206,statusText:"Partial Content",headers});
}
async function audioFetch(request){
  const cache=await caches.open(AUDIO_CACHE);
  const full=fullAudioRequest(request);
  const hit=await cache.match(request.url,{ignoreVary:true})||await cache.match(full,{ignoreVary:true});
  if(hit)return rangedResponse(hit,request.headers.get("range"));
  /* Audio is never cached implicitly: large downloads must remain user initiated. */
  return fetch(request);
}
async function audioSupportFetch(request){
  const cache=await caches.open(AUDIO_CACHE);
  const hit=await cache.match(request.url,{ignoreVary:true});
  if(hit)return hit;
  return cacheFirst(request,RUNTIME_CACHE);
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);

  if(isAudioUrl(url,request)){
    event.respondWith(audioFetch(request));
    return;
  }
  if(request.mode==="navigate"){
    event.respondWith(networkFirst(request));
    return;
  }
  if(url.href.startsWith(QCF_BASE)||url.href===QUL_HEADER){
    event.respondWith(cacheFirst(request,QURAN_CACHE));
    return;
  }
  if(isAudioSupportUrl(url)){
    event.respondWith(audioSupportFetch(request));
    return;
  }
  if(url.origin===self.location.origin&&/\/data\/tafsir\/al-wajeez\//.test(url.pathname)){
    event.respondWith(cacheFirst(request,TAFSIR_CACHE));
    return;
  }
  if(url.origin===self.location.origin){
    event.respondWith(cacheFirst(request,RUNTIME_CACHE));
    return;
  }
  if(/mp3quran\.net|facilitator999|tarteel\.ai|jsdelivr\.net/.test(url.hostname)){
    event.respondWith(cacheFirst(request,RUNTIME_CACHE));
  }
});

let libraryPromise=null;
async function cacheSet(cacheName,urls,kind,offset,total){
  const cache=await caches.open(cacheName);
  let done=0,failed=0;
  for(let i=0;i<urls.length;i+=8){
    const batch=urls.slice(i,i+8);
    const results=await Promise.all(batch.map(url=>putOne(cache,url)));
    failed+=results.filter(value=>!value).length;
    done+=batch.length;
    await notifyAll({type:"OFFLINE_LIBRARY_PROGRESS",kind,done:offset+done,total});
  }
  return {cache,failed};
}
async function ensureOfflineLibrary(){
  if(libraryPromise)return libraryPromise;
  libraryPromise=(async()=>{
    const initial=await packState();
    if(initial.ready){
      await notifyAll({type:"OFFLINE_LIBRARY_READY",quran:true,tafsir:true});
      return initial;
    }
    const total=(initial.quranReady?0:QURAN_REQUIRED.length)+(initial.tafsirReady?0:TAFSIR_REQUIRED.length);
    await notifyAll({type:"OFFLINE_LIBRARY_PROGRESS",kind:"library",done:0,total});
    let offset=0,failed=0;
    if(!initial.quranReady){
      const result=await cacheSet(QURAN_CACHE,QURAN_REQUIRED,"quran",offset,total);
      failed+=result.failed;offset+=QURAN_REQUIRED.length;
      if(result.failed===0&&await allPresent(result.cache,QURAN_REQUIRED))await markReady(result.cache,QURAN_MARKER,"quran-core-v1");
    }
    if(!initial.tafsirReady){
      const result=await cacheSet(TAFSIR_CACHE,TAFSIR_REQUIRED,"tafsir",offset,total);
      failed+=result.failed;offset+=TAFSIR_REQUIRED.length;
      if(result.failed===0&&await allPresent(result.cache,TAFSIR_REQUIRED))await markReady(result.cache,TAFSIR_MARKER,"tafsir-alwajeez-v1");
    }
    const final=await packState();
    if(final.ready)await notifyAll({type:"OFFLINE_LIBRARY_READY",quran:true,tafsir:true});
    else await notifyAll({type:"OFFLINE_LIBRARY_INCOMPLETE",...final,failed});
    return final;
  })().finally(()=>{libraryPromise=null});
  return libraryPromise;
}

async function checkOfflineLibrary(){
  const state=await packState();
  await notifyAll(state.ready
    ?{type:"OFFLINE_LIBRARY_READY",quran:true,tafsir:true}
    :{type:"OFFLINE_LIBRARY_INCOMPLETE",...state,failed:0});
  return state;
}

/* Explicit per-surah audio downloads. Audio is never bulk-downloaded and is
   never cached merely because the user streamed it. Each download is initiated
   from the Surah index and may include small timing/support JSON resources. */
let audioPackPromise=null;
function cleanAudioResources(resources){
  const out=[],seen=new Set();
  for(const item of Array.isArray(resources)?resources:[]){
    const url=String(typeof item==="string"?item:item?.url||"");
    const kind=typeof item==="object"&&item?.kind==="support"?"support":"audio";
    if(!/^https:\/\//i.test(url)||seen.has(url))continue;seen.add(url);out.push({url,kind});
  }
  return out;
}
async function fetchExplicitAudioResource(item){
  if(item.kind==="support"){
    const req=new Request(item.url,{method:"GET",mode:"cors",credentials:"omit",redirect:"follow"});
    const response=await fetch(req);if(!cacheable(response))throw new Error("support response");return {req,response};
  }
  try{
    const req=new Request(item.url,{method:"GET",mode:"cors",credentials:"omit",redirect:"follow"});
    const response=await fetch(req);if(cacheable(response))return {req,response};
  }catch(_){ }
  const req=new Request(item.url,{method:"GET",mode:"no-cors",credentials:"omit",redirect:"follow"});
  const response=await fetch(req);if(!cacheable(response))throw new Error("audio response");return {req,response};
}
async function cacheAudioResources(resources,tag=""){
  const clean=cleanAudioResources(resources);
  if(!clean.length)return {done:0,failed:0};
  if(audioPackPromise)return audioPackPromise;
  audioPackPromise=(async()=>{
    const cache=await caches.open(AUDIO_CACHE);let done=0,failed=0;
    for(const item of clean){
      try{
        const hit=await cache.match(item.url,{ignoreVary:true});
        if(!hit){const {req,response}=await fetchExplicitAudioResource(item);await cache.put(req,response.clone())}
      }catch(_){failed++}
      done++;await notifyAll({type:"AUDIO_OFFLINE_PROGRESS",tag,done,total:clean.length,failed});
    }
    await notifyAll({type:"AUDIO_OFFLINE_DONE",tag,done,total:clean.length,failed});
    return {done,failed};
  })().finally(()=>{audioPackPromise=null});
  return audioPackPromise;
}

self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type==="CHECK_OFFLINE_LIBRARY"||data.type==="CHECK_QURAN_OFFLINE")event.waitUntil(checkOfflineLibrary());
  if(data.type==="ENSURE_OFFLINE_LIBRARY"||data.type==="CACHE_QURAN_OFFLINE")event.waitUntil(ensureOfflineLibrary());
  if(data.type==="CACHE_AUDIO_PACKAGE")event.waitUntil(cacheAudioResources(data.resources,data.tag));
  if(data.type==="CACHE_AUDIO_URLS")event.waitUntil(cacheAudioResources((data.urls||[]).map(url=>({url,kind:"audio"})),data.tag));
});
