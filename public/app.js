
/* Journal d'erreurs local (Réglages → Diagnostic) : ce que l'utilisateur voit, on peut le lire. */
const ERRLOG=[]; let ERR_SENT=0;
function logErr(src,e){ try{ const msg=(e&&(e.message||e.code))||String(e); const rec={t:Date.now(),src,msg:String(msg).slice(0,300),code:e&&e.code||''}; ERRLOG.unshift(rec); ERRLOG.splice(30); localStorage.setItem('rituel.errlog',JSON.stringify(ERRLOG));
  // Remontée au serveur (collection errors) pour voir les pannes des utilisateurs sans leur demander : 20 max par session, jamais hors ligne.
  if(typeof USER!=='undefined'&&USER&&typeof fbDb!=='undefined'&&fbDb&&navigator.onLine&&ERR_SENT<20&&!/^(listen|write|resync)/.test(src)){ ERR_SENT++; fbDb.collection('errors').add({uid:USER.uid,t:rec.t,src,msg:rec.msg.slice(0,380),code:rec.code,ver:APP_VERSION,native:!!window.__RITUEL_NATIVE__,ua:navigator.userAgent.slice(0,120)}).catch(()=>{}); }
 }catch(x){} }
window.addEventListener('error',ev=>{ try{ logErr('js',ev.error||ev.message); }catch(x){} });
window.addEventListener('unhandledrejection',ev=>{ try{ logErr('promesse',ev.reason); }catch(x){} });
try{ (JSON.parse(localStorage.getItem('rituel.errlog')||'[]')||[]).forEach(x=>ERRLOG.push(x)); }catch(e){}
window.addEventListener('error',e=>logErr('js',e.error||e.message)); window.addEventListener('unhandledrejection',e=>logErr('promise',e.reason));
function humanErr(e){ const c=(e&&e.code)||''; const m=(e&&e.message)||String(e||'');
  if(/unauthenticated/.test(c)) return 'Reconnecte-toi pour utiliser le coach.';
  if(/resource-exhausted/.test(c)){ const q=/QUOTA_FREE:([^:]+):(\d+)/.exec(m); if(q){ setTimeout(()=>showPaywall(q[1],q[2]),50); return `Limite gratuite atteinte : ${q[2]} ${q[1]} par mois.`; } return m; }
  if(/failed-precondition/.test(c)){ if(/Clé API/i.test(m)) return (USER&&ADMIN_RE.test(USER.email||''))?m:'Le coach est momentanément indisponible (incident côté service). Tes séries sont enregistrées, réessaie un peu plus tard.'; return m; }
  if(/not-found/.test(c)) return 'Séance introuvable : ouvre-la depuis l\'onglet Séance puis relance.';
  if(/deadline|timeout/i.test(m)) return 'Le coach a mis trop de temps à répondre. Réessaie dans une minute.';
  if(/network|Failed to fetch|internet/i.test(m)||!navigator.onLine) return 'Pas de réseau. Le coach a besoin d\'une connexion ; tes séries sont enregistrées et partiront toutes seules.';
  if(/invalid-argument/.test(c)) return 'Le serveur n\'a pas compris la demande (version de l\'app en retard ?). Recharge l\'application depuis Réglages.';
  return m; }
const APP_VERSION='3.40.0';
const ADMIN_RE=/^(ganeme\.asloune@nexisafe\.com|gads@live\.fr)$/i;
let PROGRAM={sessions:[]};
let WEEKS = [
  {n:1,label:'S1 calibrage',from:'2026-09-07',to:'2026-09-13',rirNote:'RIR 3 · établir les références, tout noter'},
  {n:2,label:'S2 accumulation',from:'2026-09-14',to:'2026-09-20',rirNote:'RIR 2 · +1 série sur les ★ · +2,5 % ou +1 rep · partielles étirées'},
  {n:3,label:'S3 intensification',from:'2026-09-21',to:'2026-09-27',rirNote:'RIR 1 (0 sur la dernière série des isolations) · +2,5 à 5 % · drop sets, rest-pause'},
  {n:4,label:'S4 décharge',from:'2026-09-28',to:'2026-10-04',rirNote:'RIR 4 · séries −40 % · charges S2 −10 % · test tractions à froid lundi 28/9'},
];
const $ = (s,el=document)=>el.querySelector(s);
const esc = s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const todayISO = ()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const fmtD = iso=>{const [y,m,d]=iso.split('-');return `${d}/${m}`;};
/* Pont natif (coquille Expo) : présent uniquement dans l'app iOS/Android. */
let NATIVE = !!(window.ReactNativeWebView);
function native(msg){ if(!NATIVE) return; try{ window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }catch(e){} }
const BILLING={available:false,packages:null,premium:null};
function onNativeMessage(ev){ let m; try{ m=JSON.parse(ev.data); }catch(e){ return; } if(!m||!m.type) return;
  if(m.type==='billingReady'){ BILLING.available=!!m.available; if(BILLING.available&&USER) native({type:'getOfferings',uid:USER.uid}); }
  if(m.type==='offerings'){ BILLING.packages=m.packages||[]; if($('#pwOffers')) renderOffers(); }
  if(m.type==='entitlement'){ BILLING.premium=!!m.premium; }
  if(m.type==='purchaseResult'){ onPurchaseResult(m); }
  if(m.type==='healthResult'){ onHealthResult(m); }
  if(m.type==='pushToken'&&m.token){ PUSH_TOKEN=m.token; PUSH_PLATFORM=m.platform||''; savePushToken(); }
  if(m.type==='notificationOpened'){ const b=document.querySelector('.tabs button[data-tab="coach"]'); if(b&&!b.hidden) b.click(); }
  if(m.type==='resume'){ if($('#timer')&&$('#timer').classList.contains('on')) tick(); if(S.health&&Date.now()-(S.healthAt||0)>6*3600000) healthSync(); } }
let PUSH_TOKEN=null, PUSH_PLATFORM='';
function savePushToken(){ if(!PUSH_TOKEN||!USER||!fbDb) return; try{ const FV=firebase.firestore.FieldValue; col('meta').doc('push').set({expo:FV&&FV.arrayUnion?FV.arrayUnion(PUSH_TOKEN):[PUSH_TOKEN],platform:PUSH_PLATFORM,updatedAt:Date.now()},{merge:true}).catch(()=>{}); }catch(e){} }
window.addEventListener('message',onNativeMessage); document.addEventListener('message',onNativeMessage);

/* ---------- state ---------- */
const KEY='rituel.v1';
let S = {logs:{}, bw:{}, tests:{}, chats:{}, checkins:{}, overrides:{}, weekOverride:null, session:null, wake:true, openEx:null, health:false, healthAt:0};
try{ const raw=localStorage.getItem(KEY); if(raw) S=Object.assign(S,JSON.parse(raw)); }catch(e){}
for(const k of ['logs','bw','tests','chats','checkins','overrides']){ if(!S[k]||typeof S[k]!=='object') S[k]={}; }
// Pas de zoom pince ni double-tap : la mise en page de l'app n'est jamais agrandie par accident.
['gesturestart','gesturechange','gestureend'].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault(),{passive:false}));
let LAST_TOUCH=0; document.addEventListener('touchend',e=>{ const now=Date.now(); if(now-LAST_TOUCH<300&&!e.target.closest('button,a,input,textarea,select,label,[role=button],.dot,.go')) e.preventDefault(); LAST_TOUCH=now; },{passive:false});
function applyTheme(){ const t=S.theme||'auto'; const r=document.documentElement; if(t==='auto') delete r.dataset.theme; else r.dataset.theme=t; const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches); document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute('content',dark?'#0B0D10':'#F4F5F7')); native({type:'theme',dark}); }
function save(){ const j=JSON.stringify(S); try{ localStorage.setItem(KEY, j); }catch(e){} idbSet(j); }
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open('rituel',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbSet(j){ try{ idb().then(d=>{ d.transaction('kv','readwrite').objectStore('kv').put(j,KEY); }).catch(()=>{}); }catch(e){} }
function idbGet(){ return new Promise(res=>{ try{ idb().then(d=>{ const q=d.transaction('kv').objectStore('kv').get(KEY); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }).catch(()=>res(null)); }catch(e){ res(null); } }); }
try{ navigator.storage&&navigator.storage.persist&&navigator.storage.persist(); }catch(e){}

/* Semaine effective : le cycle avance quand des séances ont été faites, pas au calendrier.
   Une semaine calendaire sans séance validée (garde, maladie) ne compte pas : on reprend là où on en était. */
function weekRaw(iso){
  const start=WEEKS[0].from; if(iso<start) return 1;
  const idx=Math.floor(Math.round((new Date(iso+'T12:00:00')-new Date(start+'T12:00:00'))/86400000)/7);
  let skipped=0; for(let k=0;k<idx;k++){ const a=addDays(start,k*7), b=addDays(start,k*7+6); if(!Object.values(S.logs).some(l=>l.done&&l.date>=a&&l.date<=b)) skipped++; }
  return 1+idx-skipped;
}
function weekFor(iso){ return Math.max(1,Math.min(WEEKS.length,weekRaw(iso))); }
function cycleOver(){ return weekRaw(todayISO())>WEEKS.length; }
function curWeek(){ return S.weekOverride||weekFor(todayISO()); }
function sessionForDay(){ const d=new Date().getDay(); return PROGRAM.sessions.find(s=>s.day===d)||null; }
function curSession(){ const keep=S.sessionDate===todayISO(); return (keep&&PROGRAM.sessions.find(s=>s.id===S.session))||sessionForDay()||PROGRAM.sessions[0]; }

function rx(ex, wk, log){ // prescription for a week (cycle de 3 à 6 semaines, la dernière en décharge) ; log.day = adaptation du jour
  const L=WEEKS.length, last=wk>=L; const day=(log&&log.day)||null;
  if(ex.mode==='emom'){ const w=ex.weeks[Math.min(wk-1,ex.weeks.length-1)]; return {sets:w.sets,reps:w.reps,rir:null,rest:last?120:90,restText:last?'2 min':'90 s'}; }
  let sets=ex.sets; if(ex.star&&wk>1&&!last) sets+=1; if(last) sets=ex.s4sets||Math.max(1,Math.round(ex.sets*0.6));
  let rir=null; if(ex.rir){ rir=last?ex.rir[ex.rir.length-1]:ex.rir[Math.min(wk-1,Math.max(0,ex.rir.length-2))]; }
  if(day&&day.fatigue){ sets=Math.max(1,sets-1); if(rir!=null) rir=Math.min(4,rir+1); }
  // point hebdomadaire : une semaine allégée réduit les séries et remonte le RIR sur toutes les séances de la semaine
  const wm=weekMod(wk); if(wm&&!last){ if(wm.sets&&wm.sets!==1) sets=Math.max(1,Math.round(sets*wm.sets)); if(wm.rir&&rir!=null) rir=Math.min(4,Math.max(0,rir+wm.rir)); }
  return {sets, reps:ex.reps, rir, rest:ex.restSec, restText:ex.restText, adapted:!!(day&&day.fatigue)||!!(wm&&wm.sets&&wm.sets!==1), weekMod:wm||null};
}
function logKey(date,sid){ return date+'_'+sid; }
function getLog(date,sid){ const k=logKey(date,sid); if(!S.logs[k]) S.logs[k]={date,session:sid,week:weekFor(date),sets:{},gtg:[false,false,false],notes:'',done:false,updatedAt:0}; return S.logs[k]; }
function touch(log){ log.updatedAt=Date.now(); if(log.date===todayISO()) log.week=curWeek(); save(); writeDoc('logs',logKey(log.date,log.session),log); requestWake(); }


// history of an exercise: [{date,week,sets:[{w,r,rir}]}] newest first
function history(exId){
  return Object.values(S.logs).filter(l=>l.sets[exId]&&l.sets[exId].some(s=>s&&s.done)).map(l=>({date:l.date,week:l.week,sets:l.sets[exId].filter(s=>s&&s.done)})).sort((a,b)=>a.date<b.date?1:-1);
}
function lastRef(exId, date){ return history(exId).find(h=>h.date<date)||null; }
function e1rm(w,r){ if(!w||!r) return 0; return r===1?w:w*(1+r/30); }
function fmtSetsNice(sets){ return sets.map(s=>(s.w?s.w+'×':'')+(s.r??'?')+(s.rir!=null?' '+rirLabel(s.rir):'')).join(' · '); }
function fmtSets(sets){ return sets.map(s=>(s.w?s.w+'×':'')+(s.r??'?')+(s.rir!=null?'@'+s.rir:'')).join(' · '); }

/* ---------- Firebase : auth, Firestore hors ligne, Coach ----------
   Les données vivent dans users/{uid}/... . Firestore garde une copie locale
   (persistance IndexedDB) : l'app fonctionne sans réseau et synchronise seule.
   localStorage reste le cache de démarrage et le mode « sans compte ». */
const FB_CONFIG = {
  apiKey: "AIzaSyAh3zhRXhfqQSQ2v6d7eJjFoGwVS-rW2Ok",
  authDomain: "rituel-6b365.firebaseapp.com",
  projectId: "rituel-6b365",
  storageBucket: "rituel-6b365.firebasestorage.app",
  messagingSenderId: "119051816935",
  appId: "1:119051816935:web:35cfbb05dc893fa8a43742"
};
let fbApp=null, fbAuth=null, fbDb=null, fbFn=null, USER=null, unsubs=[], applyingRemote=false;
function fbReady(){ return !!(window.firebase && fbDb); }
function initFirebase(){
  if(!window.firebase){ setSync('off','local'); return; }
  try{
    fbApp=firebase.initializeApp(FB_CONFIG);
    fbAuth=firebase.auth(); fbDb=firebase.firestore(); fbFn=firebase.app().functions('europe-west1');
    // Banc de test local : le client parle aux émulateurs Firebase quand la page est servie par l'émulateur Hosting.
    if(location.hostname==='localhost'&&new URLSearchParams(location.search).has('emu')){ fbAuth.useEmulator('http://localhost:9099',{disableWarnings:true}); fbDb.useEmulator('localhost',8080); fbFn.useEmulator('localhost',5001); }
    fbDb.settings({ignoreUndefinedProperties:true});
    fbDb.enablePersistence({synchronizeTabs:true}).catch(()=>{});
    fbAuth.useDeviceLanguage();
    fbAuth.onAuthStateChanged(u=>{ USER=u||null; onAuth(); });
  }catch(e){ console.warn('firebase init',e); setSync('off','local'); }
}
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }
async function signOut(){ unsubs.forEach(u=>u()); unsubs=[]; await fbAuth.signOut(); }
function col(name){ return fbDb.collection('users').doc(USER.uid).collection(name); }

function showSplash(){ document.querySelector('.tabs').hidden=true; document.querySelector('.top').hidden=true; document.querySelector('main').innerHTML='<section class="splash"><div class="logo" role="img" aria-label="Rituel"></div></section>'; }
async function onAuth(){
  unsubs.forEach(u=>u()); unsubs=[];
  try{ localStorage.setItem('rituel.hadUser',USER?'1':'0'); }catch(e){}
  native({type:'ready'});
  if(!USER){ PROGRAM_LOADED=false; showGate(); syncStatusIdle(); return; }
  restoreShell(); setSync('pend','connexion…'); listenMeta(); savePushToken(); native({type:'user',uid:USER.uid}); healthStatus(); if(S.health&&Date.now()-(S.healthAt||0)>6*3600000) setTimeout(healthSync,3000);
  // 1. pousser le local vers Firestore (fusion par updatedAt, jamais d'écrasement du plus récent)
  await pushLocalToRemote();
  // 2. écouter Firestore : la source de vérité devient le cloud (copie locale gérée par Firestore)
  const listen=(name, key)=>unsubs.push(col(name).onSnapshot(snap=>{
    applyingRemote=true; let changed=false;
    snap.docChanges().forEach(ch=>{ const d=ch.doc.data(); const id=ch.doc.id;
      if(ch.type==='removed'){ delete S[key][id]; changed=true; return; }
      if(key==='chats'&&COACH.busy&&id===COACH.threadId) return; // fil en cours d'échange : la copie locale fait foi jusqu'à la réponse
      if(key==='chats'&&S[key][id]&&Array.isArray(d.messages)&&Array.isArray(S[key][id].messages)&&d.messages.length<S[key][id].messages.length) return; // jamais perdre un message local
      if(!S[key][id]||(d.updatedAt||0)>=(S[key][id].updatedAt||0)){ S[key][id]=d; changed=true; } });
    applyingRemote=false; if(changed){ save(); render(); }
    setSync(snap.metadata.hasPendingWrites?'pend':'on', snap.metadata.hasPendingWrites?'à sync':'sync ok');
  }, err=>{ console.warn(name,err); logErr('listen '+name,err); setSync('pend','sync erreur'); }));
  listen('logs','logs'); listen('bw','bw'); listen('tests','tests'); listen('chats','chats'); listen('checkins','checkins');
  unsubs.push(col('coach').orderBy('createdAt','desc').limit(30).onSnapshot(snap=>{ COACH.items=snap.docs.map(d=>({id:d.id,...d.data()})); renderCoach(); if(PROGRAM_LOADED) renderHome(); }));
  unsubs.push(col('overrides').onSnapshot(snap=>{ S.overrides={}; snap.docs.forEach(d=>S.overrides[d.id]=d.data()); save(); if(PROGRAM_LOADED) renderSeance(); }));
  renderReglages();
}
async function pushLocalToRemote(){
  const batchWrites=[];
  for(const [name,key] of [['logs','logs'],['bw','bw'],['tests','tests'],['chats','chats'],['checkins','checkins']]){
    for(const id in S[key]){ const local=S[key][id]; if(!local||!local.updatedAt) continue;
      batchWrites.push(async()=>{ const ref=col(name).doc(id); const snap=await ref.get({source:'server'}).catch(()=>ref.get()); const remote=snap.exists?snap.data():null;
        if(!remote||(local.updatedAt||0)>(remote.updatedAt||0)) await ref.set(JSON.parse(JSON.stringify(local))); });
    }
  }
  for(const w of batchWrites){ try{ await w(); }catch(e){ console.warn('push',e); } }
}
function writeDoc(name,id,data){ if(!USER||!fbDb||applyingRemote) return; col(name).doc(id).set(JSON.parse(JSON.stringify(data))).catch(e=>{ console.warn('write',e); logErr('write '+name,e); }); }

// État de synchro : un point discret, visible seulement quand ça n'est pas « sync ok » (hors ligne, en attente, erreur).
function setSync(cls,txt){ const c=$('#syncChip'); c.className='chip sync '+cls; c.textContent=cls==='on'?'':txt; c.title=txt; c.hidden=cls==='on'; }
function syncStatusIdle(){ if(!USER) return setSync('off','local'); setSync(navigator.onLine?'on':'pend', navigator.onLine?'sync ok':'hors ligne'); document.body.classList.toggle('offline',!navigator.onLine); }
function markDirty(){ save(); }
function mergeInto(local, remote){ let changed=false; for(const c of ['logs','bw','tests','chats','checkins']){ const L=local[c]||(local[c]={}), R=(remote&&remote[c])||{}; for(const k in R){ if(!L[k]||(R[k].updatedAt||0)>(L[k].updatedAt||0)){ L[k]=R[k]; changed=true; writeDoc(c,k,R[k]); } } } return changed; }
function snapshot(){ return {version:1, exportedAt:new Date().toISOString(), logs:S.logs, bw:S.bw, tests:S.tests, checkins:S.checkins||{}}; }
window.addEventListener('online',syncStatusIdle); window.addEventListener('offline',syncStatusIdle);
$('#syncChip').onclick=()=>{};

/* ---------- réglages ---------- */
/* ---------- Apple Santé : poids importé, séances exportées ---------- */
const HEALTH={available:null,busy:false,last:null};
function healthStatus(){ if(NATIVE&&HEALTH.available===null) native({type:'health',action:'status'}); }
function healthEnable(){ HEALTH.busy=true; renderReglages(); native({type:'health',action:'authorize'}); }
function healthSync(){ if(!NATIVE||!S.health||HEALTH.busy) return; HEALTH.busy=true; native({type:'health',action:'readWeight',days:120}); }
function onHealthResult(m){
  HEALTH.busy=false; HEALTH.available=!!m.available;
  if(m.action==='status'){ renderReglages(); return; }
  if(m.action==='authorize'){ if(m.ok){ S.health=true; save(); toast('Apple Santé connecté','ok'); healthSync(); } else { S.health=false; save(); toast(m.available?'Autorisation refusée':'Apple Santé indisponible'); } renderReglages(); return; }
  if(m.action==='readWeight'){ if(!m.ok){ logErr('santé',m.error||'lecture impossible'); return; } let n=0; (m.samples||[]).forEach(x=>{ if(!x.date||!x.kg) return; const cur=S.bw[x.date]; if(cur&&cur.source!=='health') return; if(cur&&cur.kg===x.kg) return; S.bw[x.date]={date:x.date,kg:x.kg,source:'health',updatedAt:Date.now()}; writeDoc('bw',x.date,S.bw[x.date]); n++; }); S.healthAt=Date.now(); save(); if(n){ toast(n===1?'1 pesée importée d\'Apple Santé':n+' pesées importées d\'Apple Santé','ok'); renderSuivi(); renderHome(); } renderReglages(); return; }
  if(m.action==='writeWorkout'){ if(m.ok) toast('Séance ajoutée à Apple Santé','ok'); else logErr('santé',m.error||'écriture impossible'); }
}
// Appelé à la fin d'une séance : durée réelle de la première série validée à la clôture.
function healthExportSession(log){ if(!NATIVE||!S.health||!log) return; const ts=Object.values(log.sets||{}).flat().filter(x=>x&&x.done&&x.t).map(x=>x.t); if(!ts.length) return; const start=Math.min(...ts)-5*60000, end=Math.max(Date.now(),Math.max(...ts)+60000); const ses=PROGRAM.sessions.find(x=>x.id===log.session); const mins=(end-start)/60000; const kcal=Math.round(mins*((PROFILE&&PROFILE.weight)||70)*0.09); native({type:'health',action:'writeWorkout',workout:{start,end,kcal,title:'Rituel · '+(ses?ses.name:log.session)}}); }
// Forfait : affiché dans Réglages, et proposé quand une limite gratuite est atteinte. Le paiement arrive avec l'étape suivante (App Store / Play).
function planInfo(){ const bd=BILLING.doc||{}; const docPrem=bd.plan==='premium'&&(!bd.expiresAt||bd.expiresAt>Date.now()); const isAdmin=!!(USER&&ADMIN_RE.test(USER.email||'')); const plan=(BILLING.premium||docPrem||isAdmin)?'premium':((USAGE&&USAGE.plan)||'free'); const lim=(USAGE&&USAGE.limits)||{program:2,analyse:8,chat:30,substitute:2,demo:4}; return {plan,lim}; }
function showPaywall(what,limit){ if(what) toast(`Limite du forfait Découverte atteinte : ${limit} ${what} par mois.`); showPlan(); return;
  const _old=()=>{
  const {lim}=planInfo();
  showSheet(`<div class="chead sm">${coachAvatar('attention')}<h3>Kai a atteint sa limite gratuite</h3></div>
    <p>${what?`Ce mois-ci tu as utilisé tes ${esc(String(limit))} ${esc(what)} gratuits.`:'Le forfait gratuit couvre la découverte.'} Avec <b>Rituel Premium</b>, Kai te suit sans compter.</p>
    <div class="plancmp"><div><b>Gratuit</b><span>${lim.analyse} analyses · ${lim.chat} questions · ${lim.program} programmes par mois</span></div><div class="pro"><b>Premium</b><span>Analyses et questions sans limite pratique (60 et 300), nouveau cycle à chaque fin de mésocycle, séances sans salle, Progrès complet, nutrition</span></div></div>
    <div id="pwOffers"></div><button class="btn" onclick="hideSheet()">Plus tard</button>`);
  renderOffers(); if(BILLING.available&&!BILLING.packages&&USER) native({type:'getOfferings',uid:USER.uid}); }; }
// Offres : prix réels de l'App Store / Google Play quand la coquille les fournit ; sinon « me prévenir ».
function renderOffers(){ const el=$('#pwOffers'); if(!el) return;
  const ios=/iPhone|iPad/.test(navigator.userAgent); const store=ios?'App Store':'Google Play';
  const live=NATIVE&&BILLING.available&&BILLING.packages&&BILLING.packages.length;
  const m=live?(BILLING.packages.find(p=>p.type==='MONTHLY')||{price:PRICING.monthly}):{price:PRICING.monthly};
  const y=live?(BILLING.packages.find(p=>p.type==='ANNUAL')||{price:PRICING.yearly}):{price:PRICING.yearly};
  const perMonth=y.priceAmount?(y.priceAmount/12).toLocaleString('fr-FR',{style:'currency',currency:y.currency||'EUR'}):PRICING.yearlyPerMonth;
  const intro=(m.intro||y.intro)?`Essai gratuit ${esc(m.intro||y.intro)}`:`Essai gratuit ${PRICING.trial}`;
  el.innerHTML=`<div class="plans"><button class="pplan ${PLAN_PERIOD==='yearly'?'sel':''}" data-period="yearly"><span class="tag2">−50 % · le plus choisi</span><span class="pl">Annuel</span><b>${esc(y.price)}</b><small>${esc(perMonth)} par mois, facturé une fois par an</small></button><button class="pplan ${PLAN_PERIOD==='monthly'?'sel':''}" data-period="monthly"><span class="pl">Mensuel</span><b>${esc(m.price)}</b><small>par mois, sans engagement</small></button></div>
    <p class="trial">${intro}, puis prélèvement par ${store}. Résiliable à tout moment, en un clic.${live?'':' Prix indicatifs : le montant exact est affiché par la boutique au moment du paiement.'}</p>
    ${live?`<button class="link" id="pwRestore">Restaurer mes achats</button>`:(NATIVE?'':`<p class="small muted center">L'abonnement se prend dans l'app iPhone ou Android.</p>`)}`;
  const setPrice=()=>{ const pp=$('#plPrice'); if(pp) pp.textContent=PLAN_PERIOD==='yearly'?`${y.price} / an`:`${m.price} / mois`; };
  el.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{ PLAN_PERIOD=b.dataset.period; el.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('sel',x===b)); setPrice(); }); setPrice();
  const cta=$('#plCta'); if(cta) cta.onclick=()=>{ const pkg=PLAN_PERIOD==='yearly'?y:m; if(live&&pkg.id){ cta.disabled=true; cta.textContent='Ouverture de '+store+'…'; native({type:'purchase',uid:USER.uid,packageId:pkg.id}); }
    else { if(USER) col('meta').doc('billing_interest').set({at:Date.now(),period:PLAN_PERIOD},{merge:true}).catch(()=>{}); toast(NATIVE?'L\'abonnement arrive dans la prochaine version. Tu seras prévenu.':'L\'abonnement se prend dans l\'app iPhone ou Android. Tu seras prévenu.','ok'); cta.disabled=true; cta.textContent='Tu seras prévenu'; } };
  const r=$('#pwRestore'); if(r) r.onclick=()=>{ native({type:'restore',uid:USER.uid}); toast('Restauration…'); };
}
function onPurchaseResult(m){ if(m.ok&&m.premium){ BILLING.premium=true; hideSheet(); const pp=document.querySelector('.premium'); if(pp){ pp.remove(); document.body.classList.remove('unlocking'); } toast(m.restored?'Abonnement restauré':'Bienvenue dans Rituel Premium','ok'); renderReglages(); }
  else if(m.ok&&!m.premium){ toast(m.restored?'Aucun abonnement actif à restaurer':'Achat non confirmé'); if($('#pwOffers')) renderOffers(); const c=$('#plCta'); if(c){ c.disabled=false; c.textContent='Essayer Premium 7 jours gratuits'; } }
  else if(m.cancelled){ if($('#pwOffers')) renderOffers(); const c=$('#plCta'); if(c){ c.disabled=false; c.textContent='Essayer Premium 7 jours gratuits'; } }
  else { toast('Paiement impossible : '+(m.error||'réessaie')); logErr('achat',m.error||'échec'); if($('#pwOffers')) renderOffers(); } }
// Écran Abonnement : forfait, consommation du mois, offres ou gestion.
const PRICING={monthly:'9,99 €',yearly:'59,99 €',yearlyPerMonth:'5 €',trial:'7 jours'}; // prix indicatifs ; les prix réels viennent de l'App Store / Google Play quand la coquille les fournit
let PLAN_PERIOD='yearly';
function showPlan(){
  const pi=planInfo(); const u=USAGE&&USAGE.month===new Date().toISOString().slice(0,7)?USAGE:{}; const bd=BILLING.doc||{}; const prem=pi.plan==='premium';
  const src=bd.source==='admin'?'offert':bd.store==='APP_STORE'?'App Store':bd.store==='PLAY_STORE'?'Google Play':bd.store?bd.store:'';
  const exp=bd.expiresAt?new Date(bd.expiresAt).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):null;
  const ios=/iPhone|iPad/.test(navigator.userAgent); const manageUrl=ios?'https://apps.apple.com/account/subscriptions':'https://play.google.com/store/account/subscriptions';
  const rows=[['Programme sur mesure par Kai','1 cycle','à chaque fin de cycle'],['Analyse après chaque séance',`${pi.lim.analyse} / mois`,'illimité*'],['Questions à Kai',`${pi.lim.chat} / mois`,'illimité*'],['Charges ajustées automatiquement','ok','ok'],['Séances sans salle',`${pi.lim.substitute} / mois`,'illimité*'],['Bilan hebdomadaire de Kai','no','ok'],['Progrès, records, médailles, défis','ok','ok'],['Apple Santé','ok','ok']];
  const cell=v=>v==='ok'?'<span class="ok"></span>':v==='no'?'<span class="no"></span>':esc(v);
  const cmp=`<details class="cmpd"><summary>Comparer Découverte et Premium</summary><div class="cmp"><div>Ce que tu as</div><div class="c2">Découverte</div><div class="c3">Premium</div>${rows.map(r=>`<div>${esc(r[0])}</div><div class="c2">${cell(r[1])}</div><div class="c3">${cell(r[2])}</div>`).join('')}</div><p class="small muted">* usage normal : 60 analyses et 300 questions par mois, bien au-delà d'un entraînement quotidien.</p></details>`;
  const quotas=(keys)=>`<div class="quotas">${keys.map(([k,l])=>{ const n=u[k]||0, m=pi.lim[k]||1; const pct=Math.min(100,Math.round(100*n/m)); return `<div class="qrow"><span>${l}</span><div class="qbar"><i style="width:${pct}%" class="${pct>=100?'full':pct>=75?'warn':''}"></i></div><b>${n}/${m}</b></div>`; }).join('')}</div>`;
  const el=document.createElement('div'); el.className='premium'; document.body.appendChild(el); document.body.classList.add('unlocking');
  const close=()=>{ el.classList.remove('on'); setTimeout(()=>{ el.remove(); document.body.classList.remove('unlocking'); },220); };
  let body, foot='';
  if(prem){ body=`<div class="phead prem"><div class="pkai">${coachAvatar('ok','lg')}</div><p class="eyebrow">Ton forfait</p><h2>Rituel Premium</h2><p>${src?`${src}${exp?(bd.cancelledAt?' · se termine le ':' · renouvellement le ')+exp:''}`:'actif'}</p></div>
      <h4>Ce mois-ci</h4>${quotas([['analyse','Analyses de séance'],['chat','Questions à Kai'],['program','Nouveaux cycles'],['substitute','Séances sans salle']])}
      <h4>Inclus</h4><div class="benefits">${[['Chaque séance analysée','Kai lit tes séries et ton ressenti, puis fixe les charges de la prochaine fois.'],['Un nouveau cycle à chaque fin de mésocycle','Construit sur ton journal, pas sur un modèle.'],['Questions sans compter','Fatigue, douleur, garde, voyage : tu demandes, il adapte.'],['Bilan du dimanche','Ce qui a marché, ce que l’on change la semaine suivante.']].map(([t,d])=>`<div class="ben"><i></i><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
      ${cmp}<div class="row2">${bd.store?`<a class="btn" href="${manageUrl}" target="_blank" rel="noopener">Gérer ou résilier</a>`:''}${NATIVE&&BILLING.available?`<button class="btn" id="plRestore">Restaurer mes achats</button>`:''}</div>${bd.store?`<p class="small muted">Résiliation en deux gestes depuis ${src||'la boutique'}, sans frais. Tu gardes Premium jusqu'au ${exp||'terme'} et tu es prévenu trois jours avant chaque renouvellement.</p>`:''}`; }
  else { body=`<div class="phead"><div class="pkai">${coachAvatar('idle','lg')}</div><p class="eyebrow">Rituel Premium</p><h2>Un coach qui te suit vraiment</h2><p>Pas un programme générique : un suivi séance après séance.</p></div>
      <div class="benefits">${[['Chaque séance analysée','Kai lit tes séries et ton ressenti, puis fixe les charges de la prochaine fois.'],['Un nouveau cycle à chaque fin de mésocycle','Construit sur ton journal, pas sur un modèle.'],['Questions sans compter','Fatigue, douleur, garde, voyage : tu demandes, il adapte.'],['Bilan du dimanche','Ce qui a marché, ce que l’on change la semaine suivante.']].map(([t,d])=>`<div class="ben"><i></i><div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
      <div id="pwOffers"></div>
      ${cmp}
      <h4>Ta consommation ce mois-ci</h4>${quotas([['analyse','Analyses'],['chat','Questions']])}<p class="small muted">Les compteurs du forfait Découverte se remettent à zéro le 1er de chaque mois.</p>`;
    foot=`<div class="pfoot"><button class="btn fill" id="plCta">Essayer Premium 7 jours gratuits</button><p class="small muted">Puis <span id="plPrice">${PRICING.yearly} / an</span> · résiliable à tout moment</p></div>`; }
  el.innerHTML=`<div class="tbar"><button class="tclose" id="plClose" aria-label="Fermer">✕</button><span></span><span></span></div><div class="tbody">${body}</div>${foot}`;
  requestAnimationFrame(()=>el.classList.add('on'));
  el.querySelector('#plClose').onclick=close; const r=el.querySelector('#plRestore'); if(r) r.onclick=()=>{ native({type:'restore',uid:USER.uid}); toast('Restauration…'); };
  if(!prem){ renderOffers(); if(BILLING.available&&!BILLING.packages&&USER) native({type:'getOfferings',uid:USER.uid}); }
}
let ADMIN_DATA=null;

// Banc d'essai : 12 profils synthétiques variés, génération réelle, contrôle de conformité et distinctivité. À lancer avant une mise en production, pas à chaque passe.
function benchHtml(b){ if(!b||!b.results) return '<p class="small muted">Jamais lancé. À faire avant une mise en production : chaque profil doit être vert.</p>';
  const s=b.summary||{}; return `<p class="small ${s.ok===s.total?'ok':'err'}"><b>${s.ok}/${s.total} profils conformes</b> · ${new Date(s.at).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · ${esc(s.model||'')}</p><div class="hl2">${b.results.map(r=>`<div class="hrow"><span class="d">${r.ok&&!(r.similar||[]).length?'🟢':'🔴'} ${esc(r.name)}${r.attempts>1?' <em class="pstar">reprise</em>':''}${r.personal===false?' <em class="pstar off">pas personnel</em>':''}</span><span class="s" style="white-space:normal">${esc((r.sessions||[]).join(' · '))}${(r.errors||[]).length?'<br>Erreur : '+esc(r.errors.join(' ')):''}${(r.warnings||[]).length?'<br>À vérifier : '+esc(r.warnings.join(' ')):''}${(r.similar||[]).length?'<br>Trop proche de '+esc(r.similar.join(', ')):''}</span><b>${Math.round((r.ms||0)/1000)} s</b></div>`).join('')}</div>`; }
async function showAdmin(){
  const sh=showSheet(`<h3>Administration</h3><p class="small muted" id="admMsg">Chargement…</p><div id="admBody"></div><button class="btn" onclick="hideSheet()">Fermer</button>`);
  try{ const fn=fbFn.httpsCallable('adminStats'); const r=await fn({}); ADMIN_DATA=r.data; const d=r.data;
    const errs=d.errors||[]; const byMsg={}; errs.forEach(e=>{ const k=e.src+' · '+e.msg.slice(0,60); byMsg[k]=(byMsg[k]||0)+1; });
    $('#admMsg').textContent='7 derniers jours · coût IA du mois';
    const hl=d.health; const hlHtml=hl?`<div class="health ${hl.ok?'ok':'ko'}"><b>${hl.ok?'Kai opérationnel':'Kai hors service'}</b><span>${hl.ok?'clé API vérifiée':esc(hl.msg||'')} · ${new Date(hl.at).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${hl.since?' · depuis le '+new Date(hl.since).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):''}</span></div>`:'';
    $('#admBody').innerHTML=hlHtml+`<div class="cs-grid adm"><div><b>${d.users}</b><span>comptes</span></div><div><b>${d.withProgram}</b><span>avec programme</span></div><div><b>${d.premium}</b><span>premium</span></div><div><b>${d.sessions7}</b><span>séances 7 j</span></div><div><b>${d.calls}</b><span>appels IA (mois)</span></div><div><b>${(d.costMonth*0.92).toFixed(2).replace('.',',')} €</b><span>coût IA (mois)</span></div></div>
      <h4>Erreurs (${errs.length})</h4>${errs.length?`<div class="hl2">${Object.entries(byMsg).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,n])=>`<div class="hrow"><span class="s" style="white-space:normal">${esc(k)}</span><b>${n}</b></div>`).join('')}</div>`:'<p class="small muted">Aucune erreur remontée.</p>'}
      <h4>Abonnés (${(d.perUser||[]).filter(u=>u.plan==='premium').length})</h4><div class="hl2">${(d.perUser||[]).filter(u=>u.plan==='premium').map(u=>`<div class="hrow"><span class="d">${esc(u.name||u.email||u.uid)}</span><span class="s">${esc(u.email||'')} · ${u.source==='admin'?'offert':esc(u.store||'')}${u.expiresAt?' · jusqu\'au '+new Date(u.expiresAt).toLocaleDateString('fr-FR'):''}</span><b></b></div>`).join('')||'<p class="small muted">Aucun abonné.</p>'}</div>
      <div class="row2"><button class="btn sm" id="purgeGeneric">Retirer les programmes génériques de tous les comptes</button></div>
      <h4>Mesure (hors administrateurs)</h4>${d.metrics?`<div class="cs-grid adm"><div><b>${d.metrics.accounts?Math.round(100*d.metrics.activated/d.metrics.accounts):0} %</b><span>activation (1 séance)</span></div><div><b>${d.metrics.c7?Math.round(100*d.metrics.r7/d.metrics.c7):'–'}${d.metrics.c7?' %':''}</b><span>retenus à J7 (${d.metrics.c7})</span></div><div><b>${d.metrics.c30?Math.round(100*d.metrics.r30/d.metrics.c30):'–'}${d.metrics.c30?' %':''}</b><span>retenus à J30 (${d.metrics.c30})</span></div></div><p class="small muted">Repères du marché : 8 % à J7, 4 % à J30. Objectif bêta : 25 % et 15 %.</p>`:''}
      <h4>Banc d'essai de personnalisation</h4><div id="benchBox">${benchHtml(d.bench)}</div><div class="row2"><button class="btn sm" id="benchRun">Lancer le banc d'essai (12 profils, ≈ 2 €)</button></div>
      <h4>Utilisateurs (${(d.perUser||[]).length})</h4><div class="hl2 admu">${(d.perUser||[]).map(u=>`<div class="hrow ucard ${u.disabled?'off':''}"><span class="d">${esc(u.name||u.email||u.uid)}${u.admin?' <em class="pstar">admin</em>':''}${u.disabled?' <em class="pstar off">bloqué</em>':''}</span><span class="s">${esc(u.email||'')}<br>${u.program?(u.generic?'<em class="pstar off">programme générique</em>':(u.checks&&u.checks.warnings&&u.checks.warnings.length?'programme · '+u.checks.warnings.length+' avertissement(s)':'programme conforme')):'sans programme'} · ${u.sessions7} séance${u.sessions7>1?'s':''} 7 j · ${u.plan}${u.cost?' · '+u.cost.toFixed(2)+' $':''}${u.created?' · inscrit le '+new Date(u.created).toLocaleDateString('fr-FR'):''}</span><b>${u.admin?'':`<button class="btn sm" data-umenu="${esc(u.uidFull)}" data-uname="${esc(u.name||u.email||u.uid)}" data-uplan="${u.plan}" data-udis="${u.disabled?1:0}">Gérer</button>`}</b></div>`).join('')}</div>`;
    const pgb=$('#purgeGeneric'); if(pgb) pgb.onclick=async()=>{ if(!confirm('Retirer le programme de chaque compte (hors admin) qui n\'a pas été construit par Kai ? Ces comptes passeront par la génération à leur prochaine ouverture.')) return; pgb.disabled=true; try{ const fn=fbFn.httpsCallable('adminAction'); const r=await fn({uid:'*',action:'purgeGeneric'}); toast((r.data.purged||0)+' programme(s) retiré(s)','ok'); }catch(e){ toast(humanErr(e)); } pgb.disabled=false; };
    const br=$('#benchRun'); if(br) br.onclick=async()=>{ if(!confirm('Lancer 12 générations réelles (environ 2 € d\'API, 2 à 4 minutes) ?')) return; br.disabled=true; br.textContent='Banc d\'essai en cours…'; try{ const fn=fbFn.httpsCallable('adminEval',{timeout:540000}); const r=await fn({}); $('#benchBox').innerHTML=benchHtml(r.data); }catch(e){ $('#benchBox').innerHTML='<p class="small err">'+esc(humanErr(e))+'</p>'; } br.disabled=false; br.textContent='Relancer le banc d\'essai (≈ 2 €)'; };
    const act=async(uid,action,extra)=>{ const fn=fbFn.httpsCallable('adminAction'); await fn(Object.assign({uid,action},extra||{})); };
    $('#admBody').querySelectorAll('[data-umenu]').forEach(b=>b.onclick=()=>{ const uid=b.dataset.umenu, name=b.dataset.uname, prem=b.dataset.uplan==='premium', dis=b.dataset.udis==='1';
      const m=document.createElement('div'); m.className='amenu'; m.innerHTML=`<div class="menu-card"><h4>${esc(name)}</h4>
        <button data-a="${prem?'free':'premium'}">${prem?'Retirer Premium':'Offrir Premium (N mois)'}</button>
        <button data-a="resetQuota">Remettre les compteurs du mois à zéro</button>
        <button data-a="push">Envoyer une notification</button>
        <button data-a="${dis?'unblock':'block'}">${dis?'Débloquer le compte':'Bloquer le compte'}</button>
        <button data-a="delete" class="danger">Supprimer le compte et ses données</button>
        <button data-a="x">Annuler</button></div>`;
      document.body.appendChild(m); requestAnimationFrame(()=>m.classList.add('on'));
      const close=()=>{ m.classList.remove('on'); setTimeout(()=>m.remove(),200); };
      m.onclick=e=>{ if(e.target===m) close(); };
      m.querySelectorAll('[data-a]').forEach(x=>x.onclick=async()=>{ const a=x.dataset.a; if(a==='x'){ close(); return; }
        try{
          if(a==='premium'){ const months=parseInt(prompt(`Offrir Premium à ${name} pour combien de mois ?`,'1'))||0; if(!months) return; const fn=fbFn.httpsCallable('adminSetPlan'); await fn({uid,plan:'premium',months}); toast('Premium offert','ok'); }
          else if(a==='free'){ if(!confirm(`Retirer Premium à ${name} ?`)) return; const fn=fbFn.httpsCallable('adminSetPlan'); await fn({uid,plan:'free',months:0}); toast('Premium retiré','ok'); }
          else if(a==='resetQuota'){ await act(uid,'resetQuota'); toast('Compteurs remis à zéro','ok'); }
          else if(a==='push'){ const text=prompt(`Message pour ${name} (notification) :`,''); if(!text) return; await act(uid,'push',{text}); toast('Notification envoyée','ok'); }
          else if(a==='block'){ if(!confirm(`Bloquer ${name} ? Il ne pourra plus se connecter.`)) return; await act(uid,'block'); toast('Compte bloqué','ok'); }
          else if(a==='unblock'){ await act(uid,'unblock'); toast('Compte débloqué','ok'); }
          else if(a==='delete'){ if(!confirm(`Supprimer définitivement le compte de ${name} et toutes ses données ?`)) return; if(prompt('Tape SUPPRIMER pour confirmer')!=='SUPPRIMER') return; await act(uid,'delete'); toast('Compte supprimé','ok'); }
          close(); showAdmin();
        }catch(e){ toast('Échec : '+(e.message||e)); }
      });
    });
  }catch(e){ $('#admMsg').textContent='Échec : '+(e.message||e); }
}
function showDiag(){ const recent=Object.values(S.logs).filter(l=>Object.keys(l.sets||{}).length||l.done).sort((a,b)=>a.date<b.date?1:-1).slice(0,8).map(l=>`${l.date} ${l.session} ${l.done?'terminée':'en cours'} ${Object.values(l.sets||{}).flat().filter(x=>x&&x.done).length} séries`).join('\n');
    const txt=`Rituel web ${APP_VERSION} · ${NATIVE?'coquille iOS/Android '+((window.__RITUEL_NATIVE__||{}).version||'?'):'navigateur'} · ${navigator.userAgent}\nSession : ${USER?USER.uid.slice(0,6)+'…':'aucune'} · réseau : ${navigator.onLine?'oui':'non'} · programme : ${PROGRAM_LOADED?'chargé':'absent'} · journal local : ${Object.keys(S.logs).length} séances\n\nDernières séances locales :\n${recent||'(aucune)'}\n\n`+(ERRLOG.length?ERRLOG.map(e=>`${new Date(e.t).toLocaleString('fr-FR')} · ${e.src} · ${e.code?e.code+' · ':''}${e.msg}`).join('\n'):'Aucune erreur enregistrée.');
    const sh=showSheet(`<h3>Diagnostic</h3><pre class="diag" id="diagTxt">${esc(txt)}</pre><div class="row2"><button class="btn" id="diagCopy">Copier</button><button class="btn sm" id="diagSync">Vérifier la synchro</button><button class="btn sm" id="diagClear">Effacer</button></div>`);
    sh.querySelector('#diagCopy').onclick=async()=>{ try{ await navigator.clipboard.writeText($('#diagTxt').textContent); toast('Copié'); }catch(e){ toast('Sélectionne le texte pour le copier'); } };
    // Compare chaque séance locale au serveur et renvoie ce qui manque, en capturant l'erreur exacte s'il y en a une.
    sh.querySelector('#diagSync').onclick=async()=>{ const b=sh.querySelector('#diagSync'); if(!USER||!navigator.onLine){ toast('Connexion et réseau nécessaires'); return; } b.disabled=true; b.textContent='Vérification…'; const lines=[]; let missing=0, sent=0, fail=0;
      for(const [k,l] of Object.entries(S.logs)){ if(!Object.keys(l.sets||{}).length&&!l.done) continue; try{ const snap=await col('logs').doc(k).get({source:'server'}); const r=snap.exists?snap.data():null; if(!r||(l.updatedAt||0)>(r.updatedAt||0)){ missing++; try{ await col('logs').doc(k).set(JSON.parse(JSON.stringify(l))); sent++; }catch(e){ fail++; lines.push(`${k} : échec envoi · ${e.code||''} ${e.message||e}`); logErr('resync '+k,e); } } }catch(e){ lines.push(`${k} : lecture serveur impossible · ${e.code||''} ${e.message||e}`); } }
      lines.unshift(`Synchro : ${Object.keys(S.logs).length} séances locales · ${missing} absentes ou plus récentes que le cloud · ${sent} renvoyées · ${fail} échec${fail>1?'s':''}`);
      $('#diagTxt').textContent=lines.join('\n')+'\n\n'+$('#diagTxt').textContent; b.textContent='Vérifié'; toast(fail?'Erreurs de synchro, copie le diagnostic':'Synchro vérifiée','ok'); };
    sh.querySelector('#diagClear').onclick=()=>{ ERRLOG.length=0; try{ localStorage.removeItem('rituel.errlog'); }catch(e){} hideSheet(); renderReglages(); }; }
function renderReglages(){
  const el=$('#tab-reglages'); if(!el) return;
  const notifState=window.Notification?({granted:'autorisées',denied:'refusées',default:'non demandées'}[Notification.permission]||Notification.permission):'non supporté';
  const usage=USAGE?`${(USAGE.analyse||0)+(USAGE.chat||0)+(USAGE.program||0)} appels · ${((USAGE.costUsd||0)*0.92).toFixed(2).replace('.',',')} €`:'aucun appel ce mois-ci';
  const pi=planInfo(); const P=PROFILE||{}; const name=P.name||USER&&USER.displayName||'';
  const LV={debutant:'Débutant',intermediaire:'Intermédiaire',confirme:'Confirmé',avance:'Avancé'};
  const bwArr=Object.values(S.bw||{}).sort((x,y)=>x.date<y.date?1:-1); const kg=bwArr[0]?bwArr[0].kg:P.weight;
  const tests=Object.values(S.tests||{}).sort((x,y)=>x.date<y.date?1:-1); const pull=tests[0]?tests[0].reps:null;
  const nDone=Object.values(S.logs).filter(l=>l.done).length;
  const goals={force:'Force',masse:'Muscle',perte:'Perte de poids',seche:'Sèche',silhouette:'Silhouette',fessiers:'Fessiers',endurance:'Endurance',cardio:'Souffle',puissance:'Puissance',tractions:'Tractions',jambes:'Jambes',bras:'Bras & pecs',sante:'Santé',perf:'Performance'};
  el.innerHTML=`<div class="phero prof"><button class="pav rk" id="profAvatar" aria-label="Mes badges">${rankSvg(progressFacts().stage,76)}</button><h2>${esc(name||'Mon profil')}</h2><p class="small muted">${P.level?LV[P.level]+' · ':''}${P.age?P.age+' ans · ':''}${P.height?P.height+' cm':''}</p>
    <div class="pills">${(P.goals||[]).slice(0,4).map(g=>`<span class="pill">${esc(goals[g]||g)}</span>`).join('')}<span class="pill ${pi.plan==='premium'?'prem':''}">${pi.plan==='premium'?'Premium':'Gratuit'}</span></div>
    ${(()=>{ const f=progressFacts(); const got=BADGES.filter(b=>f.unlocked.includes(b.id)); return got.length?`<button class="brow center" id="profBadges">${got.slice(-6).map(b=>badgeSvg(b,34,false)).join('')}${got.length>6?`<span class="small muted">+${got.length-6}</span>`:''}</button>`:''; })()}
    <div class="pstats"><div><b>${kg?String(kg).replace('.',','):'—'}</b><span>kg</span></div><div><b>${pull!=null?pull:'—'}</b><span>${esc(refTest().short.toLowerCase())}${refTest().goal?' / '+refTest().goal:''}</span></div><div><b>${nDone}</b><span>séance${nDone>1?'s':''}</span></div></div>
    <div class="row2"><button class="btn sm" id="profBtn">Modifier le profil</button></div></div>
  ${pi.plan==='premium'?`<button class="card plancard prem" id="planCard"><div class="pcin"><div class="card-h"><b>Rituel Premium</b><span>actif ›</span></div><p>Kai sans compter : analyses de chaque séance, questions, nouveaux cycles, séances sans salle.</p></div></button>`:`<button class="card plancard free" id="planCard"><div class="pcin"><b>Forfait Découverte</b><p>${USAGE?(USAGE.analyse||0):0}/${pi.lim.analyse} analyses · ${USAGE?(USAGE.chat||0):0}/${pi.lim.chat} questions ce mois-ci</p><span class="cta">Passer Premium</span></div><div class="pcbar"><i style="width:${Math.min(100,Math.round(100*(USAGE?(USAGE.analyse||0):0)/Math.max(1,pi.lim.analyse)))}%"></i></div></button>`}
  <div class="grp"><div class="grp-t">Entraînement</div>
    <button class="row" id="progBtn"><span>Programme</span><span class="muted">${esc(PROGRAM.cycleName||'—')}</span><i></i></button>
    <button class="row" id="lexBtn"><span>Lexique</span><span class="muted">RIR, tempo, décharge…</span><i></i></button>
    <label class="row"><span>Écran allumé pendant la séance</span><input type="checkbox" class="sw" id="wakeOpt" ${S.wake!==false?'checked':''}></label>
    <div class="row"><span>Apparence</span><div class="seg" id="themeSeg">${[['auto','Auto'],['light','Clair'],['dark','Sombre']].map(([v,l])=>`<button data-theme="${v}" aria-pressed="${(S.theme||'auto')===v}">${l}</button>`).join('')}</div></div>
    ${NATIVE&&HEALTH.available!==false?`<button class="row" id="healthBtn"><span>Apple Santé</span><span class="muted">${HEALTH.busy?'…':S.health?'connecté':'non connecté'}</span><i></i></button>`:''}
    ${NATIVE?`<div class="row"><span>Notifications</span><span class="muted">${PUSH_TOKEN?'activées':'gérées par le téléphone'}</span></div>`:`<button class="row" id="notifBtn"><span>Notifications de repos</span><span class="muted">${notifState}</span><i></i></button>`}
  </div>
  <div class="grp"><div class="grp-t">Compte</div>
    ${USER?`<div class="row"><span>E-mail</span><span class="muted">${esc(USER.email||'')}</span></div>${USER.providerData&&USER.providerData.some(p=>p.providerId==='password')&&!USER.emailVerified?`<button class="row" id="verifBtn"><span>E-mail non vérifié</span><span class="muted">renvoyer le lien</span><i></i></button>`:''}`:''}
    <button class="row" id="planRow"><span>Abonnement</span><span class="muted">${pi.plan==='premium'?'Premium':`Gratuit · ${USAGE?(USAGE.analyse||0):0}/${pi.lim.analyse} analyses`}</span><i></i></button>
    ${USER&&ADMIN_RE.test(USER.email||'')?`<button class="row" id="adminBtn"><span>Administration</span><span class="muted">comptes, erreurs, coûts</span><i></i></button>`:''}
    <button class="row" id="expBtn"><span>Exporter mon journal</span><i></i></button>
    <label class="row" for="impFile"><span>Importer un journal</span><i></i></label><input id="impFile" type="file" accept="application/json" hidden>
    <button class="row" id="dataBtn"><span>Tes données</span><i></i></button>
    <a class="row" href="confidentialite.html" target="_blank" rel="noopener"><span>Confidentialité</span><i></i></a>
  </div>
  <div class="grp">
    ${USER?`<button class="row" id="signOut"><span>Se déconnecter</span></button>`:''}
    <button class="row" id="diagBtn"><span>Diagnostic</span><span class="muted">${ERRLOG.length?ERRLOG.length+' erreur'+(ERRLOG.length>1?'s':''):'ok'}</span><i></i></button>
    ${USER?`<button class="row danger" id="delBtn"><span>Supprimer mon compte</span></button>`:''}
  </div>
  <p class="small muted center">Rituel ${APP_VERSION}${NATIVE&&(window.__RITUEL_NATIVE__||{}).version?' · app '+esc((window.__RITUEL_NATIVE__||{}).version):''} · <button class="link" id="reloadBtn">Recharger</button></p>
`;
  const so=$('#signOut'); if(so) so.onclick=()=>{ if(confirm('Se déconnecter ? Tes données restent sur ton compte.')) signOut(); };
  const db_=$('#delBtn'); if(db_) db_.onclick=async()=>{ if(!confirm('Supprimer définitivement ton compte, ton programme et tout ton journal ? Cette action est irréversible.')) return; if(prompt('Tape SUPPRIMER pour confirmer')!=='SUPPRIMER') return; try{ const fn=fbFn.httpsCallable('deleteAccount'); await fn({}); try{ localStorage.clear(); }catch(e){} alert('Compte supprimé.'); location.reload(); }catch(e){ alert('Échec : '+(e.message||e)+'. Si le message parle de connexion récente, déconnecte-toi, reconnecte-toi puis réessaie.'); } };
  const vb=$('#verifBtn'); if(vb) vb.onclick=async()=>{ try{ await USER.sendEmailVerification(); vb.querySelector('.muted').textContent='lien envoyé'; }catch(e){ vb.textContent='échec : '+e.message; } };
  const hb=$('#healthBtn'); if(hb) hb.onclick=()=>{ if(S.health){ showSheet(`<h3>Apple Santé</h3><p>Ton poids est importé automatiquement (les pesées saisies à la main gardent la priorité) et chaque séance terminée est enregistrée comme entraînement de force : elle compte dans tes anneaux et apparaît sur ta montre.</p><div class="row2"><button class="btn fill" id="hsNow">Synchroniser maintenant</button><button class="btn" id="hsOff">Déconnecter</button></div>`); $('#hsNow').onclick=()=>{ hideSheet(); healthSync(); toast('Synchronisation…'); }; $('#hsOff').onclick=()=>{ S.health=false; save(); hideSheet(); renderReglages(); toast('Apple Santé déconnecté'); }; } else healthEnable(); };
  const pb=$('#planBtn'); if(pb) pb.onclick=()=>showPlan(); const pc=$('#planCard'); if(pc) pc.onclick=()=>showPlan();
  const pr=$('#planRow'); if(pr) pr.onclick=()=>showPlan();
  const pa=$('#profAvatar'); if(pa) pa.onclick=()=>showBadges('rang'); const pb2=$('#profBadges'); if(pb2) pb2.onclick=()=>showBadges('medailles');
  const ts=$('#themeSeg'); if(ts) ts.querySelectorAll('button').forEach(b=>b.onclick=()=>{ S.theme=b.dataset.theme; save(); applyTheme(); renderReglages(); });
  const adb=$('#adminBtn'); if(adb) adb.onclick=showAdmin;
  $('#profBtn').onclick=()=>{ if(!USER) return; const before=JSON.stringify([PROFILE&&PROFILE.goals,PROFILE&&PROFILE.gear,PROFILE&&PROFILE.days,PROFILE&&PROFILE.level,PROFILE&&PROFILE.constraints]); document.querySelector('.tabs').hidden=true; $('#weekChip').hidden=true;
    IV.start(PROFILE||{},{step:9,onDone:()=>{ restoreShell(); render(); showTab('reglages'); toast('Profil enregistré','ok'); const after=JSON.stringify([PROFILE.goals,PROFILE.gear,PROFILE.days,PROFILE.level,PROFILE.constraints]); if(after!==before&&PROGRAM.sessions.length&&confirm('Ton profil a changé. Demander à '+COACH_NAME+' un nouveau cycle construit dessus ?')){ showTab('programme'); regenerateProgram(true); } }}); };
  $('#progBtn').onclick=()=>document.querySelector('.tabs button[data-tab="programme"]').click();
  $('#diagBtn').onclick=showDiag;
  const db=$('#dataBtn'); if(db) db.onclick=()=>showSheet(`<h3>Tes données</h3><p class="small"><b>Ce que l'app enregistre</b> : ton profil (prénom, âge, sexe, taille, poids, niveau, objectifs, matériel, jours, zones à ménager, préférences), ton programme, tes séances (charges, répétitions, ressenti, notes), ton poids et tes tests, tes échanges avec ${esc(COACH_NAME)}, ton forfait.</p><p class="small"><b>Où</b> : sur ton compte, chez notre hébergeur en Europe. Personne d'autre n'y a accès : chaque donnée est liée à l'identifiant unique de ton compte, pas à ton prénom.</p><p class="small"><b>Ce qui est envoyé au coach IA</b> : ta fiche et tes séances, sans e-mail ni identifiant, le temps de construire la réponse. Rien n'est utilisé pour entraîner un modèle.</p><p class="small"><b>Partagé avec d'autres utilisateurs</b> : rien, sauf si tu actives le classement entre amis (prénom, code ami, XP), désactivable à tout moment.</p><p class="small"><b>Durée</b> : tant que ton compte existe. Suppression du compte et de toutes ses données depuis Réglages → Compte, effet immédiat.</p><div class="row2"><button class="btn sm" id="dataExp">Exporter mes données</button><a class="btn sm" href="confidentialite.html" target="_blank" rel="noopener">Politique complète</a></div><button class="btn" onclick="hideSheet()">Fermer</button>`) && setTimeout(()=>{ const e=$('#dataExp'); if(e) e.onclick=()=>$('#expBtn').click(); },0);
  $('#lexBtn').onclick=()=>showSheet(`<h3>Lexique</h3>`+Object.entries(LEX).map(([k,v])=>`<details class="more"><summary>${esc(v[0])}</summary><p class="small">${esc(v[1])}</p></details>`).join('')+`<button class="btn" onclick="hideSheet()">Fermer</button>`);
  $('#expBtn').onclick=()=>{ const blob=new Blob([JSON.stringify(snapshot(),null,1)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rituel-journal-'+todayISO()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); };
  $('#impFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); mergeInto(S,d); save(); render(); toast('Journal importé','ok'); }catch(err){ alert('Fichier invalide.'); } }; rd.readAsText(f); };
  $('#wakeOpt').onchange=e=>{ S.wake=e.target.checked; save(); if(!S.wake) releaseWake(); };
  const nb=$('#notifBtn'); if(nb) nb.onclick=async()=>{ if(!window.Notification) return; await Notification.requestPermission(); renderReglages(); };
  $('#reloadBtn').onclick=async()=>{ if(navigator.serviceWorker){ const r=await navigator.serviceWorker.getRegistration(); if(r){ await r.update(); } } location.reload(); };
}

/* ---------- Présence du coach : identité, états visibles, barre de travail ---------- */
const COACH_NAME='Kai';
// Avatar : le loup de Rituel dans un cercle. États : idle, busy (anneau qui tourne), attention (point rouge), ok (coche).
function coachAvatar(state,size){ return `<span class="cav ${state||'idle'} ${size||''}" aria-hidden="true"><i class="mk"></i><i class="cring"></i><i class="dot"></i></span>`; }
// Barre de travail globale : ce que fait le coach, étape en cours, progression. Un seul job à la fois.
const JOB={on:false,t:0,iv:0};
function startJob(label,steps,expectMs){
  JOB.on=true; JOB.label=label; JOB.steps=steps||[]; JOB.t0=Date.now(); JOB.expect=expectMs||20000; JOB.k=0;
  let bar=$('#jobbar'); if(!bar){ bar=document.createElement('div'); bar.id='jobbar'; bar.setAttribute('role','status'); bar.setAttribute('aria-live','polite'); document.body.appendChild(bar); }
  bar.innerHTML=`${coachAvatar('busy')}<div class="jt"><b>${esc(COACH_NAME)} · ${esc(label)}</b><span id="jobStep">${esc(JOB.steps[0]||'')}</span></div><span class="jsec" id="jobSec">0 s</span><div class="jbar"><i id="jobFill"></i></div>`;
  requestAnimationFrame(()=>bar.classList.add('on')); document.body.classList.add('hasjob');
  clearInterval(JOB.iv);
  JOB.iv=setInterval(()=>{ const el=Date.now()-JOB.t0; const sec=$('#jobSec'); if(sec) sec.textContent=Math.round(el/1000)+' s';
    // progression asymptotique vers 92 % sur la durée attendue : honnête sur l'incertitude, jamais figée.
    const p=92*(1-Math.exp(-el/(JOB.expect*0.6))); const f=$('#jobFill'); if(f) f.style.width=p.toFixed(1)+'%';
    const n=JOB.steps.length; if(n>1){ const k=Math.min(n-1,Math.floor(n*el/JOB.expect)); if(k!==JOB.k){ JOB.k=k; const st=$('#jobStep'); if(st){ st.textContent=JOB.steps[k]; st.classList.remove('sw'); void st.offsetWidth; st.classList.add('sw'); } } } },250);
}
function endJob(ok,msg){
  clearInterval(JOB.iv); JOB.on=false; const bar=$('#jobbar'); if(!bar) return;
  const f=$('#jobFill'); if(f) f.style.width='100%';
  bar.querySelector('.cav').className='cav '+(ok?'ok':'attention'); const st=$('#jobStep'); if(st) st.textContent=msg||(ok?'Terminé':'Échec');
  setTimeout(()=>{ if(!JOB.on){ bar.classList.remove('on'); document.body.classList.remove('hasjob'); } },ok?1400:3000);
}
/* ---------- Coach ---------- */
const COACH={items:[], busy:false, thread:[]};
async function callCoach(payload){
  if(!USER) throw new Error('Connecte-toi pour utiliser le Coach.');
  if(!navigator.onLine) throw new Error('Le Coach a besoin du réseau.');
  const fn=fbFn.httpsCallable('coach',{timeout:120000});
  try{ const res=await fn(payload); return res.data; }
  catch(e){ const c=String((e&&e.code)||''); if(/unavailable|deadline-exceeded|internal/.test(c)&&!/Anthropic|coach a renvoyé|illisible/i.test((e&&e.message)||'')){ await new Promise(r=>setTimeout(r,1500)); const res=await fn(payload); return res.data; } throw e; }
}
async function analyseSession(logKeyStr){
  if(COACH.busy) return; COACH.busy=true; renderCoach();
  const l=S.logs[logKeyStr]; const sname=l?((PROGRAM.sessions.find(x=>x.id===l.session)||{}).name||l.session):'la séance';
  startJob(`analyse ${sname}`,['Lit tes séries et ton ressenti','Compare à ton historique','Décide les charges de la prochaine fois','Rédige le verdict'],22000);
  try{ const r=await callCoach({mode:'analyse', logKey:logKeyStr, week:curWeek()}); endJob(true,`${sname} analysée`); if(r&&r.adjustments&&r.adjustments.length) toast(`${COACH_NAME} propose ${r.adjustments.length} ajustement${r.adjustments.length>1?'s':''} de charge`,'ok'); }
  catch(e){ logErr('analyse',e); endJob(false,humanErr(e)); toast(humanErr(e)); }
  COACH.busy=false; renderCoach();
}
// Conversations : chaque fil est un document chats/{id} (messages, titre, dates), synchronisé comme le journal.
function curThread(){ if(!S.chats) S.chats={}; if(COACH.threadId&&S.chats[COACH.threadId]) return S.chats[COACH.threadId]; return null; }
function newThread(){ if(!S.chats) S.chats={}; const id='c'+Date.now().toString(36); S.chats[id]={id,createdAt:Date.now(),updatedAt:Date.now(),title:'',messages:[]}; COACH.threadId=id; COACH.thread=S.chats[id].messages; return S.chats[id]; }
function openThread(id){ const t=S.chats&&S.chats[id]; if(!t) return; COACH.threadId=id; COACH.thread=t.messages; COACH.listOpen=false; renderChatSheet(); }
function saveThread(){ const t=curThread(); if(!t||!t.messages.length) return; t.updatedAt=Date.now(); if(!t.title){ const u=t.messages.find(m=>m.role==='user'); t.title=u?u.content.slice(0,60):''; } save(); writeDoc('chats',t.id,t); }
function deleteThread(id){ if(!S.chats[id]) return; delete S.chats[id]; save(); if(USER){ try{ const r=col('chats').doc(id); if(r.delete) r.delete().catch(()=>{}); }catch(e){} } if(COACH.threadId===id){ COACH.threadId=null; COACH.thread=[]; } renderCoach(); }
// Le fil peut être remplacé par sa copie Firestore entre deux messages : on relit toujours l'objet courant, jamais une référence gardée.
function threadMsgs(){ const t=curThread()||newThread(); if(!Array.isArray(t.messages)) t.messages=[]; COACH.thread=t.messages; return t.messages; }
async function askCoach(text){
  if(!text.trim()||COACH.busy) return; COACH.busy=true; threadMsgs().push({role:'user',content:text,t:Date.now()}); saveThread(); renderCoach();
  startJob('réfléchit',['Relit ton programme et ton journal','Rédige la réponse'],10000);
  try{ const r=await callCoach({mode:'chat', messages:threadMsgs().slice(-12).map(m=>({role:m.role,content:m.content})), week:curWeek(), session:curSession().id}); threadMsgs().push({role:'assistant',content:r.text||'',t:Date.now()}); endJob(true,'Réponse prête'); }
  catch(e){ logErr('chat',e); threadMsgs().push({role:'assistant',content:humanErr(e),error:true,t:Date.now()}); endJob(false,humanErr(e)); }
  saveThread(); COACH.busy=false; renderCoach();
}
function applyOverride(item){
  if(!USER||!item.adjustments) return;
  const bySession={};
  item.adjustments.forEach(a=>{ const sid=a.exId.split('-')[0]; (bySession[sid]=bySession[sid]||{}); bySession[sid][a.exId]=a; });
  Object.entries(bySession).forEach(([sid,adj])=>col('overrides').doc(sid).set({adj, fromCoach:item.id, updatedAt:Date.now()},{merge:true}));
  col('coach').doc(item.id).set({applied:true},{merge:true});
}
function fmtRel(ts){ if(!ts) return ''; const d=new Date(ts), now=new Date(); const sameDay=d.toDateString()===now.toDateString(); if(sameDay) return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); const y=new Date(now); y.setDate(now.getDate()-1); if(d.toDateString()===y.toDateString()) return 'hier'; return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'}); }
function coachOpenChat(id,prefill){ if(id&&S.chats&&S.chats[id]){ COACH.threadId=id; COACH.thread=S.chats[id].messages; } else newThread(); COACH.view='chat'; COACH.prefill=prefill||''; renderCoach(); }
function renderCoach(){
  const el=$('#tab-coach'); if(!el||!PROGRAM_LOADED||!PROGRAM.sessions.length) return;
  document.body.classList.toggle('chatmode',COACH.view==='chat'&&!$('#tab-coach').hidden);
  if(COACH.view==='chat') return renderChatView(el);
  if(COACH.view==='chats') return renderChatList(el);
  const date=todayISO(), ses=curSession(), log=S.logs[logKey(date,ses.id)];
  const lastItem=COACH.items[0]; const lastAt=lastItem&&lastItem.createdAt?new Date(lastItem.createdAt):null;
  const stateTxt=COACH.busy?'Au travail…':lastAt?`En veille · dernier passage ${fmtRel(lastAt.getTime())}`:'En veille';
  let h=`<div class="chead">${coachAvatar(COACH.busy?'busy':'idle','lg')}<div><h2>${esc(COACH_NAME)}</h2><p class="cstate ${COACH.busy?'busy':''}">${esc(stateTxt)}</p></div></div>`;
  if(!USER){ h+=`<p class="small muted">Connecte-toi (Réglages) pour activer ${esc(COACH_NAME)}.</p>`; el.innerHTML=h; return; }
  const todayAnalysed=COACH.items.some(i=>i.logKey===logKey(date,ses.id));
  const hasSets=!!(log&&Object.values(log.sets||{}).flat().some(x=>x&&x.done));
  const pending=COACH.items.find(i=>i.adjustments&&i.adjustments.length&&!i.applied&&i.type!=='bilan');
  const missing=Object.entries(S.logs).filter(([k,l])=>l.done&&l.date>=addDays(date,-14)&&l.date<date&&Object.values(l.sets||{}).flat().some(x=>x&&x.done)&&!COACH.items.some(i=>i.logKey===k)).sort((x,y)=>x[1].date<y[1].date?-1:1).map(([k])=>k);
  // Une seule chose à faire, mise en avant
  let act=null;
  if(COACH.busy) act={cls:'busy',t:'Analyse en cours',s:'Quelques secondes.'};
  else if(missing.length) act={id:'anaMissing',t:`Analyser ${missing.length} séance${missing.length>1?'s':''}`,s:'Des séances terminées attendent leur lecture.'};
  else if(hasSets&&!todayAnalysed) act={id:'anaBtn',t:'Analyser la séance du jour',s:'Tes séries sont enregistrées, je fixe les charges suivantes.'};
  else if(pending) act={apply:pending.id,t:'Appliquer les charges',s:esc(pending.title||'')+' : ajustements prêts pour la prochaine séance.'};
  h+=`<div class="kact ${act?'on':''}">${act?`<div class="kact-t"><b>${act.t}</b><span>${act.s}</span></div>${act.cls?'':`<button class="btn fill sm" ${act.id?`id="${act.id}"`:`data-apply="${esc(act.apply)}"`}>Lancer</button>`}`:`<div class="kact-t"><b>Rien en attente</b><span>Termine ta prochaine séance, je l'analyse dans la foulée.</span></div>`}</div>`;
  // Conversations
  const threads=Object.values(S.chats||{}).filter(t=>t&&Array.isArray(t.messages)&&t.messages.length).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  h+=`<div class="ksec"><div class="ksec-h"><h3>Conversations</h3>${threads.length>2?`<button class="link" id="chatsAll">Tout voir (${threads.length})</button>`:''}</div>
    <button class="btn fill knew" id="chatNew">${coachAvatar('idle','xs')} Écrire à ${esc(COACH_NAME)}</button>
    ${threads.slice(0,2).map(t=>{ const last=t.messages[t.messages.length-1]; return `<button class="krow" data-open-thread="${esc(t.id)}"><div><b>${esc(t.title||'Conversation')}</b><span>${esc((last.role==='assistant'?COACH_NAME+' : ':'Toi : ')+String(last.content||'').replace(/\n/g,' ').slice(0,70))}</span></div><em>${fmtRel(t.updatedAt||t.createdAt)}</em></button>`; }).join('')}</div>`;
  // Analyses
  const weekAgo=Date.now()-7*86400000; const older=[]; let cards='';
  COACH.items.forEach(it=>{
    if(!it.type&&it.logKey){ const lg=S.logs[it.logKey]; if(lg&&!Object.values(lg.sets||{}).flat().some(x=>x&&x.done)) return; }
    if(it.type==='nudge'&&(it.createdAt||0)<weekAgo){ older.push(it); return; }
    const when=it.createdAt?fmtRel(it.createdAt):'';
    if(it.type==='bilan'||it.type==='cycleEnd'||it.type==='nudge'){
      cards+=`<div class="ana ${it.type}"><div class="anah"><span class="kind">${it.type==='nudge'?'Relance':it.type==='cycleEnd'?'Fin de cycle':'Bilan'}</span><b>${esc(it.title||'')}</b><em>${when}</em></div>`;
      if(it.analysis) cards+=`<div class="anab">${lexify(esc(it.analysis)).replace(/\n/g,'<br>')}</div>`;
      if(it.highlights&&it.highlights.length) cards+=`<div class="hl">${it.highlights.map(x=>`<div class="hli s-${esc(x.status||'ok')}"><span class="v">${esc(x.value)}</span><span class="l">${esc(x.label)}</span></div>`).join('')}</div>`;
      if(it.alerts&&it.alerts.length) cards+=`<div class="banner">${it.alerts.map(esc).join('<br>')}</div>`;
      if(it.nextWeek) cards+=`<p class="coachline"><b>Semaine prochaine</b> ${lexify(esc(it.nextWeek))}</p>`;
      if(it.type==='cycleEnd') cards+=`<div class="adj"><button class="btn fill" id="nextCycleBtn">Générer le cycle suivant</button></div>`;
      if(it.type==='nudge') cards+=`<div class="adj"><button class="btn sm" data-goseance>Ouvrir la séance du jour</button></div>`;
      cards+=`</div>`; return;
    }
    const adjBy={}; (it.adjustments||[]).forEach(a=>adjBy[a.exId]=a);
    const exs=(it.exercises&&it.exercises.length)?it.exercises:(it.adjustments||[]).map(a=>({exId:a.exId,name:a.name,done:'',read:a.reason,status:'up'}));
    const lbl={ok:'Conforme',up:'Charger',hold:'Plus de reps',warn:'À revoir'};
    const needs=it.adjustments&&it.adjustments.length&&!it.applied;
    cards+=`<div class="ana ${needs?'needs':''}" data-ana="${esc(it.id)}"><div class="anah"><span class="kind">Analyse</span><b>${esc(it.title||it.logKey||'')}</b><em>${when}</em></div>`;
    if(it.headline) cards+=`<div class="anahl t-${esc(it.tone||'ok')}"><i></i><b>${esc(it.headline)}</b></div>`;
    if(it.takeaways&&it.takeaways.length) cards+=`<ul class="anatk">${it.takeaways.map(t=>`<li>${lexify(esc(t))}</li>`).join('')}</ul>`;
    else if(it.analysis) cards+=`<div class="anab clamp4">${lexify(esc(it.analysis)).replace(/\n/g,'<br>')}</div>`;
    if(exs.length) cards+=`<div class="exl2">`+exs.map(e=>{ const a=adjBy[e.exId]; const fx=findEx(e.exId); return `<div class="exc ${fx&&demoId(fx)?'hasimg':''}">${fx?demoThumb(fx):''}<div class="l1"><b>${esc(e.name)}</b><span class="st s-${esc(e.status||'ok')}">${lbl[e.status]||'Conforme'}</span></div><div class="l2"><span class="done">${esc(e.done||'—')}</span>${a?`<span class="arrow">→</span><span class="next">${esc(a.change)}</span>`:''}</div></div>`; }).join('')+`</div>`;
    if(it.questions&&it.questions.length) cards+=`<div class="cq">${coachAvatar('attention','xs')}<div><b>${esc(COACH_NAME)} te demande</b>${it.questions.map(q=>`<p>${esc(q)} <button class="link" data-ask="${esc(q)}">Répondre</button></p>`).join('')}</div></div>`;
    cards+=`<div class="anaf"><button class="link" data-detail="${esc(it.id)}">Lire l'analyse complète</button>${it.adjustments&&it.adjustments.length?(it.applied?'<span class="tag ok">charges appliquées</span>':`<button class="btn sm fill" data-apply="${esc(it.id)}">Appliquer les charges</button>`):''}</div></div>`;
  });
  h+=`<div class="ksec"><div class="ksec-h"><h3>Analyses</h3></div>${cards||`<div class="empty"><b>Pas encore d'analyse</b><p class="small muted">Termine une séance : ${esc(COACH_NAME)} l'analyse et fixe les charges de la prochaine.</p></div>`}${older.length?`<details class="more"><summary>Relances passées (${older.length})</summary>${older.map(it=>`<p class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''} · ${esc(it.title||'')}</p>`).join('')}</details>`:''}</div>`;
  el.innerHTML=h;
  const ab=$('#anaBtn'); if(ab) ab.onclick=()=>analyseSession(logKey(date,ses.id));
  const am=$('#anaMissing'); if(am) am.onclick=async()=>{ for(const k of missing){ await analyseSession(k); } };
  const cn=$('#chatNew'); if(cn) cn.onclick=()=>coachOpenChat(null);
  const ca=$('#chatsAll'); if(ca) ca.onclick=()=>{ COACH.view='chats'; renderCoach(); };
  el.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>coachOpenChat(b.dataset.openThread));
  el.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>coachOpenChat(null,'Tu me demandes : « '+b.dataset.ask+' » — '));
  el.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>applyOverride(COACH.items.find(i=>i.id===b.dataset.apply)));
  el.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showAnalysisDetail(COACH.items.find(i=>i.id===b.dataset.detail)));
  const nc=$('#nextCycleBtn'); if(nc) nc.onclick=()=>{ showTab('programme'); regenerateProgram(); };
  el.querySelectorAll('[data-goseance]').forEach(b=>b.onclick=()=>showTab('seance'));
  updateCoachBadge();
}
function showAnalysisDetail(it){ if(!it) return; const adjBy={}; (it.adjustments||[]).forEach(a=>adjBy[a.exId]=a); const exs=it.exercises||[];
  showSheet(`<div class="chead sm">${coachAvatar('idle')}<h3>${esc(it.title||'')}</h3></div>${it.headline?`<div class="anahl t-${esc(it.tone||'ok')}"><i></i><b>${esc(it.headline)}</b></div>`:''}${it.takeaways&&it.takeaways.length?`<ul class="anatk">${it.takeaways.map(t=>`<li>${lexify(esc(t))}</li>`).join('')}</ul>`:''}${it.lesson?`<div class="lesson"><b>À retenir</b><p>${lexify(esc(it.lesson))}</p></div>`:''}${it.analysis?`<details class="more"><summary>Lecture détaillée</summary><p>${lexify(esc(it.analysis)).replace(/\n/g,'<br>')}</p></details>`:''}${exs.length?`<div class="exl">${exs.map(e=>{ const a=adjBy[e.exId]; return `<div class="exr s-${esc(e.status||'ok')}"><i></i><div><b>${esc(e.name)}</b><div class="read">${lexify(esc(e.read||''))}${a&&a.reason?' <span class="muted">— '+lexify(esc(a.reason))+'</span>':''}</div></div></div>`; }).join('')}</div>`:''}${it.cue?`<p class="coachline cue"><b>Point technique</b> ${lexify(esc(it.cue))}</p>`:''}${it.nextFocus?`<p class="coachline"><b>Prochaine fois</b> ${lexify(esc(it.nextFocus))}</p>`:''}<button class="btn" onclick="hideSheet()">Fermer</button>`); }
function renderChatList(el){
  const threads=Object.values(S.chats||{}).filter(t=>t&&Array.isArray(t.messages)&&t.messages.length).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  el.innerHTML=`<div class="kbar"><button class="back" id="kBack">‹ ${esc(COACH_NAME)}</button><b>Conversations</b><span></span></div>
    <button class="btn fill knew" id="chatNew">Nouvelle conversation</button>
    ${threads.length?threads.map(t=>`<div class="krow-w"><button class="krow" data-open-thread="${esc(t.id)}"><div><b>${esc(t.title||'Conversation')}</b><span>${t.messages.length} message${t.messages.length>1?'s':''}</span></div><em>${fmtRel(t.updatedAt||t.createdAt)}</em></button><button class="kdel" data-del-thread="${esc(t.id)}" aria-label="Supprimer"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`).join(''):'<p class="small muted center">Aucune conversation encore.</p>'}`;
  $('#kBack').onclick=()=>{ COACH.view='home'; renderCoach(); };
  $('#chatNew').onclick=()=>coachOpenChat(null);
  el.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>coachOpenChat(b.dataset.openThread));
  el.querySelectorAll('[data-del-thread]').forEach(b=>b.onclick=()=>{ if(confirm('Supprimer cette conversation ?')){ deleteThread(b.dataset.delThread); } });
}
function renderChatView(el){
  const cur=curThread()||newThread(); if(!Array.isArray(cur.messages)) cur.messages=[]; COACH.thread=cur.messages;
  const msgs=cur.messages.map(m=>`<div class="msgw ${m.role}">${m.role==='assistant'?coachAvatar('idle','xs'):''}<div class="msg ${m.role} ${m.error?'err':''}">${(m.role==='assistant'?lexify(esc(m.content)):esc(m.content)).replace(/\n/g,'<br>')}</div></div>`).join('');
  const typing=COACH.busy&&cur.messages.length&&cur.messages[cur.messages.length-1].role==='user'?`<div class="msgw assistant">${coachAvatar('busy','xs')}<div class="msg assistant typing"><i></i><i></i><i></i></div></div>`:'';
  const empty=!cur.messages.length?`<div class="kempty">${coachAvatar('idle','lg')}<p>Charges, douleur, garde, nutrition, remplacement d'un exercice : je connais ton programme et ton historique. Dis-moi.</p><div class="ksug">${['Je suis fatigué, j\'allège comment ce soir ?','Mon épaule tire sur le développé, je fais quoi ?','Combien de calories pour sécher sans perdre de force ?'].map(q=>`<button class="chip2" data-sug="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`:'';
  el.innerHTML=`<div class="kbar"><button class="back" id="kBack">‹</button><div class="kbar-t">${coachAvatar(COACH.busy?'busy':'idle','xs')}<b>${esc(cur.title||COACH_NAME)}</b></div><button class="ico" id="kMenu" aria-label="Options">⋯</button></div>
    <div class="chat kchat" id="kchat">${empty}${msgs}${typing}</div>
    <form class="ask kask" id="askForm"><textarea id="askInput" rows="1" placeholder="Écris à ${esc(COACH_NAME)}…" enterkeyhint="send"></textarea><button class="send" type="submit" aria-label="Envoyer" ${COACH.busy?'disabled':''}><svg viewBox="0 0 24 24"><path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>`;
  $('#kBack').onclick=()=>{ COACH.view='home'; renderCoach(); };
  $('#kMenu').onclick=()=>{ const sh=showSheet(`<h3>${esc(cur.title||'Conversation')}</h3><div class="menu"><button data-act="new">Nouvelle conversation</button><button data-act="list">Toutes les conversations</button><button data-act="del" class="danger">Supprimer cette conversation</button></div>`); sh.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ hideSheet(); const a=b.dataset.act; if(a==='new') coachOpenChat(null); else if(a==='list'){ COACH.view='chats'; renderCoach(); } else if(a==='del'&&confirm('Supprimer cette conversation ?')){ deleteThread(cur.id); COACH.view='home'; renderCoach(); } }); };
  el.querySelectorAll('[data-sug]').forEach(b=>b.onclick=()=>{ $('#askInput').value=b.dataset.sug; $('#askForm').requestSubmit(); });
  const ta=$('#askInput'), f=$('#askForm'); const grow=()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,140)+'px'; }; ta.oninput=grow;
  if(COACH.prefill){ ta.value=COACH.prefill; COACH.prefill=''; grow(); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length); }
  f.onsubmit=e=>{ e.preventDefault(); const v=ta.value; if(!v.trim()) return; ta.value=''; grow(); askCoach(v); };
  ta.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); f.requestSubmit(); } };
  window.scrollTo({top:document.body.scrollHeight});
}
function renderChatSheet(){ COACH.view='chat'; renderCoach(); }
function updateCoachBadge(){ const t=document.querySelector('.tabs button[data-tab="coach"]'); if(!t) return; const seen=S.coachSeen||0; const n=COACH.items.filter(i=>(i.createdAt||0)>seen).length; t.classList.toggle('badge',n>0&&t.getAttribute('aria-selected')!=='true'); }

/* ---------- Palier 2 : profil et programme par utilisateur ----------
   users/{uid}/meta/profile  — qui est l'athlète (saisi à la première connexion, modifiable dans Réglages)
   users/{uid}/meta/program  — son programme, généré par le coach à partir du profil (ou importé)
   Sans compte : écran d'accueil uniquement. */
let PROFILE=null, USAGE=null, PROGRAM_LOADED=false, DEFAULT_PROGRAM=null, DEFAULT_CYCLE_HTML='';
const REF_TESTS=[['tractions','Tractions strictes d\'affilée'],['pompes','Pompes d\'affilée'],['dips','Dips d\'affilée'],['squats','Squats au poids du corps en 2 min'],['burpees','Burpees en 2 min'],['gainage','Gainage en secondes']];
function refTest(){ const id=(PROFILE&&PROFILE.refTest)||'tractions'; const t=REF_TESTS.find(x=>x[0]===id)||REF_TESTS[0]; return {id:t[0],label:t[1],short:{tractions:'Tractions',pompes:'Pompes',dips:'Dips',squats:'Squats 2 min',burpees:'Burpees 2 min',gainage:'Gainage (s)'}[t[0]],unit:t[0]==='gainage'?'s':'reps',goal:(PROFILE&&(PROFILE.refGoal||PROFILE.pullGoal))||null}; }
const GOALS=[['force','Force maximale'],['masse','Prise de muscle'],['perte','Perdre du poids'],['seche','Sécher, se dessiner'],['silhouette','Tonifier, silhouette'],['fessiers','Fessiers, bas du corps'],['endurance','Endurance musculaire'],['cardio','Souffle, condition physique'],['puissance','Puissance, vitesse'],['tractions','Tractions (nombre)'],['jambes','Rattraper les jambes'],['bras','Bras et pectoraux'],['sante','Santé, mobilité, dos'],['perf','Performance sportive / opérationnelle']];
const GEAR=[['salle','Salle complète (machines, barres, poulies)'],['halteres','Haltères'],['barre','Barre olympique et disques'],['kettlebell','Kettlebells'],['elastiques','Élastiques'],['traction','Barre de traction'],['trx','TRX / sangles'],['corps','Poids du corps uniquement'],['cardio','Cardio (vélo, rameur, tapis)']];
const LEVELS=[['debutant','Débutant (moins d’un an)'],['intermediaire','Intermédiaire (1 à 3 ans)'],['confirme','Confirmé (3 ans et plus)'],['avance','Avancé, entraînement quotidien']];

function showGate(mode){
  mode=mode||'login';
  document.querySelector('.tabs').hidden=true; document.querySelector('.top').hidden=true;
  const m=document.querySelector('main');
  const head=`<div class="gateh"><div class="logo" role="img" aria-label="Rituel"></div><p class="lede">Un vrai coach dans ta poche.</p></div>`;
  const feats=`<div class="kaiintro">${coachAvatar('idle','lg')}<div><b>${esc(COACH_NAME)}</b><p>Je construis ton programme sur ton profil et ton matériel, je te guide à chaque série, et j'analyse chaque séance pour régler la suivante. Tu progresses, je m'adapte.</p></div></div>
    <div class="feats"><div><b>01</b><span>Un cycle de 3 à 6 semaines pensé pour toi, pas un programme générique.</span></div><div><b>02</b><span>La séance guidée : photos du mouvement, charges, chrono de repos. Sans réseau.</span></div><div><b>03</b><span>Après chaque séance, ${esc(COACH_NAME)} lit tes séries et ajuste les charges.</span></div></div>`;
  let form='';
  if(mode==='login') form=`<form class="form auth" id="authForm"><label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required minlength="8"></label><p class="small err" id="authMsg"></p><button class="btn fill" type="submit">Se connecter</button><p class="small"><button type="button" class="link" data-mode="reset">Mot de passe oublié</button></p></form><button type="button" class="btn" data-mode="signup">Créer un compte</button>`;
  if(mode==='signup') form=`<form class="form auth" id="authForm"><label>Prénom<input name="name" autocomplete="given-name" required></label><label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required></label><label>Mot de passe (8 caractères minimum)<input name="password" type="password" autocomplete="new-password" required minlength="8"></label><p class="small err" id="authMsg"></p><p class="small muted">En créant un compte tu acceptes que tes données d'entraînement soient stockées sur Firebase (Europe) et analysées par l'API Anthropic pour le coach. <a href="confidentialite.html" target="_blank" rel="noopener">Politique de confidentialité</a>.</p><button class="btn fill" type="submit">Créer mon compte</button></form><p class="small muted">Déjà un compte ? <button type="button" class="link" data-mode="login">Se connecter</button></p>`;
  if(mode==='reset') form=`<form class="form auth" id="authForm"><label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required></label><p class="small err" id="authMsg"></p><button class="btn fill" type="submit">Envoyer le lien de réinitialisation</button></form><p class="small muted"><button type="button" class="link" data-mode="login">Retour</button></p>`;
  m.innerHTML=`<section class="gate">${head}${mode==='login'?feats:''}${form}<p class="small muted">Un compte par personne. Chacun ne voit que ses propres données.</p></section>`;
  m.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>showGate(b.dataset.mode));
  const msg=$('#authMsg');
  $('#authForm').onsubmit=async e=>{ e.preventDefault(); const f=new FormData(e.target); const email=String(f.get('email')||'').trim(), pw=String(f.get('password')||''); const btn=e.target.querySelector('button[type=submit]'); btn.disabled=true; msg.textContent='';
    try{
      if(mode==='login'){ await fbAuth.signInWithEmailAndPassword(email,pw); }
      else if(mode==='signup'){ const cred=await fbAuth.createUserWithEmailAndPassword(email,pw); await cred.user.updateProfile({displayName:String(f.get('name')||'').trim()}); try{ await cred.user.sendEmailVerification(); }catch(x){} }
      else { await fbAuth.sendPasswordResetEmail(email); msg.textContent='Lien envoyé. Regarde ta boîte mail, y compris les indésirables.'; }
    }catch(err){ msg.textContent=authError(err); }
    btn.disabled=false; };
}
function authError(e){ const c=(e&&e.code)||''; return ({'auth/invalid-email':'Adresse e-mail invalide.','auth/user-not-found':'Aucun compte avec cet e-mail.','auth/wrong-password':'Mot de passe incorrect.','auth/invalid-credential':'E-mail ou mot de passe incorrect.','auth/email-already-in-use':'Un compte existe déjà avec cet e-mail. Connecte-toi ou utilise « Mot de passe oublié ».','auth/weak-password':'Mot de passe trop court : 8 caractères minimum.','auth/too-many-requests':'Trop de tentatives. Réessaie dans quelques minutes.','auth/network-request-failed':'Pas de réseau.','auth/popup-closed-by-user':'Connexion annulée.'})[c]||('Erreur : '+((e&&e.message)||e)); }
function restoreShell(){
  const m=document.querySelector('main');
  if(!$('#tab-seance')) m.innerHTML=`<section id="tab-home"></section><section id="tab-seance" hidden></section><section id="tab-coach" hidden></section><section id="tab-programme" hidden></section><section id="tab-suivi" hidden></section><section id="tab-reglages" hidden></section>`;
  document.querySelector('.tabs').hidden=false; document.querySelector('.top').hidden=false; const av=$('#settingsBtn'); if(av&&USER) av.textContent=(USER.displayName||USER.email||'?').slice(0,1).toUpperCase();
}
let GENERATING=false, ONB_STEP=null;
/* ---------- Entretien guidé (remplace le formulaire de profil) ----------
   Une question par écran, choix cliquables, réaction du coach à chaque étape. Produit un profil compatible
   (name, age, sex, height, weight, level, goals, days, minutes, gear, equipment, sports, constraints, experience)
   et une fiche structurée `spec` qui pilote les règles de construction et la consigne du coach. */
const IV_GOALS=[['force','Être plus fort','Charges, barres, machines lourdes','🏋️'],['masse','Prendre du muscle','Volume, dessin, bras, pecs','💪'],['perte','Perdre du gras','En gardant le muscle','🔥'],['sante','Santé, dos, mobilité','Bouger mieux, sans douleur','🧘'],['perf','Performance sportive','Pour un sport ou un métier','🏃'],['corps','Poids du corps','Tractions, dips, gainage','🤸']];
const IV_GOAL2=[['tractions','Plus de tractions'],['jambes','Rattraper les jambes'],['bras','Bras et pectoraux'],['fessiers','Fessiers'],['seche','Sécher, me dessiner'],['endurance','Endurance musculaire'],['puissance','Puissance, vitesse'],['cardio','Souffle'],['silhouette','Silhouette harmonieuse']];
const IV_YEARS=[['0','Jamais'],['1','Moins d\'un an'],['2','1 à 3 ans'],['3','Plus de 3 ans']];
const IV_SKILLS=[['pull10','10 tractions strictes'],['squat','Squat barre propre'],['dl','Soulevé de terre > mon poids'],['none','Aucun des trois']];
const IV_PLACES=[['salle','Salle','🏢'],['maison','Maison','🏠'],['deux','Les deux','🔁']];
const IV_GYM=[['machines','Machines guidées'],['poulies','Poulies'],['barres','Barres et disques'],['halteres','Haltères'],['traction','Station de traction'],['rack','Rack à squat'],['presse','Presse à cuisses'],['hack','Hack squat'],['cardio','Cardio']];
const IV_HOME=[['halteres','Haltères'],['barre','Barre et disques'],['kettlebell','Kettlebells'],['elastiques','Élastiques'],['traction','Barre de traction'],['trx','TRX / sangles'],['banc','Banc'],['corps','Rien, poids du corps']];
const IV_BRANDS=['ON AIR','Basic-Fit','Fitness Park','Keep Cool','L\'Orange Bleue','Autre'];
const IV_ZONES=[['epaule','Épaule'],['coude','Coude'],['poignet','Poignet'],['dos','Dos, lombaires'],['hanche','Hanche'],['genou','Genou'],['cheville','Cheville'],['cou','Cou, cervicales']];
const IV_SEV=[['opere','Opéré'],['douleur','Douleur'],['fragile','Fragile']];
const IV_SPORTS=['Course','Trail','Vélo','Natation','Sport co','Arts martiaux','Escalade','CrossFit','Yoga','Rugby','Football','Tennis'];
const IV_REFUSE=[['cardio','Pas de cardio long'],['burpees','Pas de burpees'],['1h','Séances jamais plus d\'une heure'],['nobar','Pas de barre, haltères seulement'],['nomachine','Pas de machines, barre seulement'],['nofail','Pas de séries à l\'échec'],['nobody','Pas de remarques sur mon physique'],['nonotif','Pas de notifications']];
const IV_LIKES=[['lourd','Charges lourdes'],['circuits','Circuits'],['tractions','Tractions'],['bras','Isolation bras'],['mobilite','Mobilité'],['explosif','Explosif, sauts'],['court','Séances courtes et intenses']];
const IV_DAYS=['L','M','M','J','V','S','D']; const IV_DAYN=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const IV_LEVEL_FR={debutant:'débutant',intermediaire:'intermédiaire',confirme:'confirmé',avance:'avancé'};
// Niveau déduit : ancienneté + compétences concrètes, jamais auto-déclaré.
function ivLevel(s){ const y=Number(s.years||0); const sk=(s.skills||[]).filter(x=>x!=='none').length; if(y===0||(y===1&&sk===0)) return 'debutant'; if(y===3&&sk===3) return 'avance'; if((y===3&&sk>=1)||(y===2&&sk>=2)) return 'confirme'; return 'intermediaire'; }
function ivGear(s){ const g=new Set(); const gym=s.gymGear||[], home=s.homeGear||[]; if(s.place==='salle'||s.place==='deux'){ g.add('salle'); if(gym.includes('halteres')) g.add('halteres'); if(gym.includes('barres')) g.add('barre'); if(gym.includes('traction')) g.add('traction'); if(gym.includes('cardio')) g.add('cardio'); } if(s.place==='maison'||s.place==='deux'){ home.forEach(h=>{ if(h==='banc') return; g.add(h); }); } if(!g.size) g.add('corps'); return [...g]; }
// Répartition de la semaine par les règles (aperçu avant la fin de l'entretien, même logique côté serveur).
function ivSplit(s){ const n=(s.daysList||[]).length||Number(s.days)||3; const g=s.goalMain||'force'; const corps=g==='corps'||(s.place==='maison'&&(s.homeGear||[]).includes('corps')&&(s.homeGear||[]).length===1);
  const T={2:[['Corps entier A','squat, développé, tirage'],['Corps entier B','charnière, dips ou pompes, tractions']],3:[['Corps entier A','jambes, poussée, tirage'],['Corps entier B','charnière, poussée verticale, tirage'],['Corps entier C','jambes, bras, gainage']],4:[['Bas du corps, force','squat, charnière, ischios'],['Haut du corps, force','développé, tractions, rowing'],['Bas du corps, volume','fentes, leg curl, mollets'],['Haut du corps, volume','incliné, tirage, bras']],5:[['Jambes','squat, presse, ischios'],['Poussée','développé, épaules, triceps'],['Tirage','tractions, rowing, biceps'],['Jambes, volume','charnière, fentes, mollets'],['Haut du corps','pecs, dos, bras']],6:[['Poussée A','développé, épaules, triceps'],['Tirage A','tractions, rowing, biceps'],['Jambes A','squat, presse, ischios'],['Poussée B','incliné, dips, épaules'],['Tirage B','tirage, rowing, arrière d\'épaule'],['Jambes B','charnière, fentes, mollets']]}[Math.max(2,Math.min(6,n))];
  const byGoal={perte:x=>[x[0].replace('force','densité').replace('volume','circuit'),x[1]+' · finisher court'],sante:x=>[x[0].replace('force','contrôle').replace('volume','mobilité'),x[1]],corps:x=>[x[0],x[1].replace('développé','pompes').replace('squat','pistol ou squat sauté').replace('presse','fentes')]};
  return T.map(x=>(byGoal[g]||(y=>y))(x)).map(([name,sub])=>({name,sub}));
}
const IV=(function(){ let d={}, i=0, mode='onb'; let onDone=null;
  const chip=(name,v,l,on,multi)=>`<button type="button" class="ivchip ${on?'on':''}" data-f="${name}" data-v="${esc(v)}" data-multi="${multi?1:0}">${esc(l)}</button>`;
  const card=(name,v,t,s,ico,on,cls)=>`<button type="button" class="ivcard ${on?'on':''} ${cls||''}" data-f="${name}" data-v="${esc(v)}"><span class="ivico">${ico||''}</span><b>${esc(t)}</b>${s?`<span>${esc(s)}</span>`:''}</button>`;
  const say=t=>`<div class="kaisay">${coachAvatar('idle')}<p>${t}</p></div>`;
  const has=(f,v)=>Array.isArray(d[f])?d[f].includes(v):d[f]===v;
  const screens=[
    {t:'Toi, en deux lignes',s:'Le minimum pour régler les charges et le volume.',h:()=>`<form class="form" id="ivForm"><label>Prénom<input name="name" value="${esc(d.name||'')}" required autocomplete="given-name"></label>
      <div class="grid2"><label>Âge<input name="age" type="number" inputmode="numeric" min="14" max="90" value="${d.age||''}" required></label><label>Sexe<div class="ivseg"><button type="button" class="ivchip ${d.sex!=='f'?'on':''}" data-f="sex" data-v="h">Homme</button><button type="button" class="ivchip ${d.sex==='f'?'on':''}" data-f="sex" data-v="f">Femme</button></div></label></div>
      <div class="grid2"><label>Taille (cm)<input name="height" type="number" inputmode="numeric" min="120" max="230" value="${d.height||''}" required></label><label>Poids (kg)<input name="weight" type="number" inputmode="decimal" step="0.1" min="30" max="250" value="${d.weight||''}" required></label></div></form>`,
      ok:()=>{ const f=$('#ivForm'); if(!f.reportValidity()) return false; const fd=new FormData(f); ['name','age','height','weight'].forEach(k=>d[k]=String(fd.get(k)||'').trim()); d.sex=d.sex||'h'; return true; }},
    {t:'Qu\'est-ce qui compte le plus pour toi ?',s:'Un seul choix. Tu ajoutes un second juste après.',h:()=>`<div class="ivgrid">${IV_GOALS.map(([v,t,s,ico])=>card('goalMain',v,t,s,ico,d.goalMain===v)).join('')}</div>`,ok:()=>{ if(!d.goalMain){ toast('Choisis un objectif'); return false; } return true; }},
    {t:'Et en second ?',s:'Facultatif. Le premier objectif gagne les arbitrages.',h:()=>`<div class="ivchips">${IV_GOAL2.filter(([v])=>v!==d.goalMain).map(([v,l])=>chip('goalSecond',v,l,d.goalSecond===v)).join('')}</div>${say(d.goalMain==='perte'?'Perdre du gras sans perdre de muscle : le programme reste un entraînement de force, avec des finishers courts. Je ne commenterai jamais ton apparence.':d.goalMain==='force'?'Objectif force : séries courtes, repos longs, charges qui montent chaque semaine. Le second objectif prend la fin des séances.':d.goalMain==='sante'?'Santé et mobilité : amplitudes contrôlées, pas de charge maximale, progression lente et régulière.':'Je construis le cycle autour du premier objectif et je place le second là où il ne le gêne pas.')}`,ok:()=>true},
    {t:'Ton niveau, en vrai',s:'Deux questions concrètes, pas d\'auto-évaluation.',h:()=>`<div class="ivq"><b>Depuis combien de temps tu t'entraînes en force, régulièrement ?</b><div class="ivopts">${IV_YEARS.map(([v,l])=>`<button type="button" class="ivopt ${d.years===v?'on':''}" data-f="years" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="ivq"><b>Aujourd'hui, tu sais faire :</b><div class="ivchips">${IV_SKILLS.map(([v,l])=>chip('skills',v,l,has('skills',v),true)).join('')}</div></div>
      <div id="ivLevelSay">${d.years?say(`Avec ça je te classe <b>${IV_LEVEL_FR[ivLevel(d)]}</b>. ${{debutant:'Trois séances maximum, mouvements simples, jamais près de l\'échec : on apprend d\'abord.',intermediaire:'16 à 22 séries par séance, on ira près de l\'échec seulement en fin de cycle.',confirme:'22 à 28 séries, techniques d\'intensification ciblées en semaine 3.',avance:'Volume et intensité d\'athlète, je ne te ménagerai pas.'}[ivLevel(d)]}`):''}</div>`,ok:()=>{ if(!d.years){ toast('Réponds à la première question'); return false; } if(!(d.skills||[]).length){ toast('Coche ce que tu sais faire, ou « aucun »'); return false; } return true; },react:()=>{ const e=$('#ivLevelSay'); if(e&&d.years) e.innerHTML=say(`Avec ça je te classe <b>${IV_LEVEL_FR[ivLevel(d)]}</b>.`); }},
    {t:'Où tu t\'entraînes ?',s:'Je ne te prescrirai que ce que tu as sous la main.',h:()=>`<div class="ivgrid three">${IV_PLACES.map(([v,t,ico])=>card('place',v,t,'',ico,d.place===v,'sm')).join('')}</div>
      ${(d.place==='salle'||d.place==='deux')?`<div class="ivq"><b>Ta salle a :</b><div class="ivchips">${IV_GYM.map(([v,l])=>chip('gymGear',v,l,has('gymGear',v),true)).join('')}</div></div><div class="ivq"><b>Enseigne (facultatif)</b><div class="ivchips">${IV_BRANDS.map(b=>chip('brand',b,b,d.brand===b)).join('')}</div></div>`:''}
      ${(d.place==='maison'||d.place==='deux')?`<div class="ivq"><b>À la maison tu as :</b><div class="ivchips">${IV_HOME.map(([v,l])=>chip('homeGear',v,l,has('homeGear',v),true)).join('')}</div></div>`:''}`,
      ok:()=>{ if(!d.place){ toast('Où tu t\'entraînes ?'); return false; } if((d.place!=='maison')&&!(d.gymGear||[]).length){ toast('Coche ce que ta salle a'); return false; } if((d.place!=='salle')&&!(d.homeGear||[]).length){ toast('Coche ton matériel à la maison'); return false; } return true; },rerender:['place']},
    {t:'Tes jours et ton temps',s:'Des vrais jours, pas des bonnes intentions. Tu changes quand tu veux.',h:()=>`<div class="ivweek">${IV_DAYS.map((l,k)=>`<button type="button" class="ivday ${has('daysList',k)?'on':''}" data-f="daysList" data-v="${k}" data-multi="1"><b>${l}</b><small>${has('daysList',k)?'séance':''}</small></button>`).join('')}</div>
      <div class="ivq"><b>Temps par séance</b><div class="ivopts">${[30,45,60,75,90].map(n=>`<button type="button" class="ivopt ${String(d.minutes||60)===String(n)?'on':''}" data-f="minutes" data-v="${n}">${n} min</button>`).join('')}</div></div>
      <div id="ivDaysSay">${(d.daysList||[]).length?say(`${(d.daysList||[]).length} jours, ${d.minutes||60} minutes : ${ {2:'deux séances corps entier, chaque muscle deux fois par semaine.',3:'trois séances corps entier, la base la plus efficace à cette fréquence.',4:'un haut / bas, chaque muscle deux fois par semaine.',5:'jambes, poussée, tirage puis deux séances de volume.',6:'un poussée / tirage / jambes doublé.'}[Math.max(2,Math.min(6,(d.daysList||[]).length))]}`):''}</div>`,
      ok:()=>{ const n=(d.daysList||[]).length; if(n<2){ toast('Choisis au moins 2 jours'); return false; } if(n>6){ toast('6 jours maximum, le corps a besoin d\'un jour'); return false; } d.minutes=Number(d.minutes||60); return true; },react:()=>{ const e=$('#ivDaysSay'); if(e){ const n=(d.daysList||[]).length; e.innerHTML=n?say(`${n} jours, ${d.minutes||60} minutes.`):''; } document.querySelectorAll('.ivday').forEach(b=>{ b.querySelector('small').textContent=b.classList.contains('on')?'séance':''; }); }},
    {t:'Voilà ta semaine',s:'Déjà construite avec tes réponses. On affine avec deux écrans de plus.',h:()=>{ const days=(d.daysList||[]).slice().sort((a,b)=>a-b); const sp=ivSplit(d); return `<div class="ivses">${sp.map((x,k)=>`<div class="ivse"><div><b>${esc(IV_DAYN[days[k]]||'')} · ${esc(x.name)}</b><span>${esc(x.sub)}</span></div><em>${d.minutes||60} min</em></div>`).join('')}</div>${say('Cycle de 4 semaines : calibrage, accumulation, intensification, décharge. Les charges viennent de ta première semaine, je les ajuste ensuite à chaque séance.')}`; },ok:()=>true,alt:['Je veux changer les jours',()=>IV.go(5)]},
    {t:'Une zone à ménager ?',s:'Les exercices qui la sollicitent seront exclus ou remplacés, pas juste « adaptés ».',h:()=>`<div class="ivchips">${IV_ZONES.map(([v,l])=>chip('zones',v,l,has('zones',v),true)).join('')}</div>
      ${(d.zones||[]).map(z=>`<div class="ivq"><b>${esc(IV_ZONES.find(x=>x[0]===z)[1])}</b><div class="ivopts">${IV_SEV.map(([v,l])=>`<button type="button" class="ivopt ${(d.zoneSev||{})[z]===v?'on':''}" data-f="zoneSev.${z}" data-v="${v}">${l}</button>`).join('')}</div><input class="ivtext" data-f="zoneNote.${z}" placeholder="Précise si tu veux (opéré en 2022, douleur en flexion…)" value="${esc((d.zoneNote||{})[z]||'')}"></div>`).join('')}
      <div class="ivq"><b>Autres sports</b><div class="ivchips">${IV_SPORTS.map(s=>chip('sports',s,s,has('sports',s),true)).join('')}</div><input class="ivtext" data-f="sportsNote" placeholder="Fréquence, volume (ex. : trail 60 km par semaine, gardes de 24 h)" value="${esc(d.sportsNote||'')}"></div>
      <p class="small muted">Rituel ne remplace pas un avis médical. En cas de douleur ou de reprise après blessure, valide ton programme avec un professionnel de santé.</p>`,ok:()=>{ for(const z of (d.zones||[])) if(!(d.zoneSev||{})[z]){ toast('Précise la gravité pour chaque zone'); return false; } return true; },rerender:['zones'],alt:['Rien à signaler',()=>{ d.zones=[]; IV.go(8); }]},
    {t:'Ce que tu ne veux pas',s:'Aussi important que le reste. Je m\'y tiendrai.',h:()=>`<div class="ivchips">${IV_REFUSE.map(([v,l])=>chip('refuse',v,l,has('refuse',v),true)).join('')}</div><div class="ivq"><b>Et ce que tu aimes</b><div class="ivchips">${IV_LIKES.map(([v,l])=>chip('likes',v,l,has('likes',v),true)).join('')}</div></div><div class="ivq"><b>Tes repères actuels (facultatif)</b><input class="ivtext" data-f="experience" placeholder="Ex. : squat 100 kg × 5, 35 tractions, développé 80 kg" value="${esc(d.experience||'')}"></div>`,ok:()=>true},
    {t:'Ta fiche',s:`C'est exactement ce que ${COACH_NAME} recevra. Corrige si quelque chose cloche.`,h:()=>`<div class="ivrecap">${ivRecapHtml(ivProfile(d))}</div><div class="ivchips small">${[['Objectifs',1],['Niveau',3],['Matériel',4],['Jours',5],['Zones',7],['Préférences',8]].map(([l,k])=>`<button type="button" class="ivchip" data-go="${k}">Modifier · ${l}</button>`).join('')}</div>`,ok:()=>true}
  ];
  function set(f,v,multi){ if(f.includes('.')){ const [a,b]=f.split('.'); d[a]=d[a]||{}; d[a][b]=v; return; } if(multi){ const arr=(d[f]||[]).slice(); const vv=/^\d+$/.test(v)&&f==='daysList'?Number(v):v; const k=arr.indexOf(vv); if(k>=0) arr.splice(k,1); else arr.push(vv); if(f==='skills'){ if(vv==='none') arr.splice(0,arr.length,'none'); else { const n=arr.indexOf('none'); if(n>=0) arr.splice(n,1); } } d[f]=arr; } else d[f]=d[f]===v?undefined:v; }
  function render(){ const sc=screens[i]; const m=document.querySelector('main'); const last=i===screens.length-1;
    m.innerHTML=`<section class="onb iv"><p class="eyebrow">${i+1} sur ${screens.length}</p><div class="onb-prog"><i style="width:${Math.round(100*(i+1)/screens.length)}%"></i></div><h2>${sc.t}</h2><p class="sub">${sc.s}</p><div id="ivBody">${sc.h()}</div>
      <div class="row2 onb-nav">${i>0?'<button type="button" class="btn" id="ivBack">Retour</button>':''}<button type="button" class="btn fill" id="ivNext">${last?(COACH_NAME+', construis mon programme'):'Continuer'}</button></div>${sc.alt?`<p class="small center"><button type="button" class="link" id="ivAlt">${esc(sc.alt[0])}</button></p>`:''}</section>`;
    window.scrollTo({top:0});
    const body=$('#ivBody');
    body.addEventListener('click',e=>{ const b=e.target.closest('[data-f]'); if(!b||b.tagName==='INPUT') return; const f=b.dataset.f, v=b.dataset.v, multi=b.dataset.multi==='1';
      if(f==='sex'){ d.sex=v; b.parentElement.querySelectorAll('.ivchip').forEach(x=>x.classList.toggle('on',x===b)); return; }
      set(f,v,multi||f==='daysList');
      if((sc.rerender||[]).includes(f.split('.')[0])){ body.innerHTML=sc.h(); return; }
      if(b.classList.contains('ivopt')||b.classList.contains('ivcard')||(!multi&&f!=='daysList')){ b.parentElement.querySelectorAll('[data-f="'+f+'"]').forEach(x=>x.classList.toggle('on',x===b&&d[f.split('.')[0]]!==undefined&&(f.includes('.')?true:d[f]===v))); } else b.classList.toggle('on');
      if(f==='skills') body.querySelectorAll('[data-f="skills"]').forEach(x=>x.classList.toggle('on',(d.skills||[]).includes(x.dataset.v)));
      if(sc.react) sc.react(); });
    body.addEventListener('input',e=>{ const t=e.target; if(t.classList.contains('ivtext')) set(t.dataset.f,t.value.trim()); });
    body.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>IV.go(Number(b.dataset.go)));
    const bk=$('#ivBack'); if(bk) bk.onclick=()=>IV.go(i-1);
    const al=$('#ivAlt'); if(al) al.onclick=sc.alt[1];
    $('#ivNext').onclick=async()=>{ if(!sc.ok()) return; if(!last){ IV.go(i+1); return; } await finish(); };
  }
  async function finish(){ const out=ivProfile(d); out.updatedAt=Date.now(); out.createdAt=(PROFILE&&PROFILE.createdAt)||Date.now(); if(PROFILE&&PROFILE.friends) out.friends=PROFILE.friends; if(PROFILE&&PROFILE.social!==undefined) out.social=PROFILE.social; if(PROFILE&&PROFILE.pullGoal) out.pullGoal=PROFILE.pullGoal;
    PROFILE=out; try{ await fbDb.collection('users').doc(USER.uid).collection('meta').doc('profile').set(out); }catch(err){ alert('Enregistrement impossible : '+err.message); return; }
    if(onDone) onDone(); else showOnboarding('program'); }
  return { start(seed,opts){ d=ivSeed(seed||{}); i=(opts&&opts.step)||0; onDone=(opts&&opts.onDone)||null; render(); }, go(k){ i=Math.max(0,Math.min(screens.length-1,k)); render(); }, draft(){ return d; } };
})();
// Profil existant (ancien formulaire ou fiche) → brouillon d'entretien.
function ivSeed(p){ const s=p.spec?Object.assign({},p.spec):{}; if(Array.isArray(s.zones)&&s.zones.length&&typeof s.zones[0]==='object'){ const zs=s.zones; s.zones=zs.map(z=>z.zone); s.zoneSev={}; s.zoneNote={}; zs.forEach(z=>{ s.zoneSev[z.zone]=z.sev; s.zoneNote[z.zone]=z.note||''; }); } ['name','age','sex','height','weight','experience'].forEach(k=>{ if(p[k]!==undefined&&s[k]===undefined) s[k]=p[k]; });
  if(!s.goalMain&&(p.goals||[]).length){ const g=p.goals[0]; s.goalMain=IV_GOALS.some(x=>x[0]===g)?g:({tractions:'corps',jambes:'force',bras:'masse',fessiers:'masse',seche:'perte',endurance:'perf',puissance:'perf',cardio:'perte',silhouette:'masse'}[g]||'force'); if(p.goals[1]&&IV_GOAL2.some(x=>x[0]===p.goals[1])) s.goalSecond=p.goals[1]; }
  if(!s.place&&(p.gear||[]).length){ s.place=p.gear.includes('salle')?'salle':'maison'; if(s.place==='salle') s.gymGear=['machines','poulies','barres','halteres','traction']; else s.homeGear=p.gear.filter(g=>g!=='cardio'); }
  if(!s.daysList&&p.days){ s.daysList=[[0,2],[0,2,4],[0,2,4,5],[0,1,3,4,5],[0,1,2,3,4,5]][Math.max(2,Math.min(6,Number(p.days)))-2]; }
  if(!s.minutes&&p.minutes) s.minutes=p.minutes; if(!s.years&&p.level) s.years={debutant:'1',intermediaire:'2',confirme:'3',avance:'3'}[p.level];
  if(!s.sportsNote&&p.sports) s.sportsNote=p.sports; if(!s.constraintsNote&&p.constraints) s.constraintsNote=p.constraints; return s; }
// Brouillon → profil enregistré (champs compatibles + fiche structurée).
function ivProfile(s){ const days=(s.daysList||[]).slice().sort((a,b)=>a-b); const goals=[s.goalMain].concat(s.goalSecond?[s.goalSecond]:[]).filter(Boolean).map(g=>g==='corps'?'tractions':g);
  const zones=(s.zones||[]).map(z=>({zone:z,sev:(s.zoneSev||{})[z]||'fragile',note:(s.zoneNote||{})[z]||''}));
  const constraints=zones.map(z=>`${IV_ZONES.find(x=>x[0]===z.zone)[1].toLowerCase()} (${IV_SEV.find(x=>x[0]===z.sev)[1].toLowerCase()}${z.note?' : '+z.note:''})`).concat(s.constraintsNote?[s.constraintsNote]:[]).join(' ; ');
  const sports=(s.sports||[]).join(', ')+(s.sportsNote?(s.sports&&s.sports.length?' — ':'')+s.sportsNote:'');
  const equipment=[s.brand&&s.brand!=='Autre'?s.brand:'',(s.place!=='maison')?'salle : '+(s.gymGear||[]).map(v=>(IV_GYM.find(x=>x[0]===v)||[])[1]).filter(Boolean).join(', '):'',(s.place!=='salle')?'maison : '+(s.homeGear||[]).map(v=>(IV_HOME.find(x=>x[0]===v)||[])[1]).filter(Boolean).join(', '):''].filter(Boolean).join(' · ');
  const refuse=(s.refuse||[]).map(v=>(IV_REFUSE.find(x=>x[0]===v)||[])[1]).filter(Boolean), likes=(s.likes||[]).map(v=>(IV_LIKES.find(x=>x[0]===v)||[])[1]).filter(Boolean);
  return { name:String(s.name||'').trim(), age:Number(s.age)||null, sex:s.sex||'h', height:Number(s.height)||null, weight:Number(s.weight)||null, level:ivLevel(s), goals, goalsText:[refuse.length?'Refuse : '+refuse.join(', '):'',likes.length?'Aime : '+likes.join(', '):''].filter(Boolean).join('. '), days:days.length, daysList:days, minutes:Number(s.minutes)||60, gear:ivGear(s), equipment, sports, constraints, experience:s.experience||'', refTest:'tractions',
    spec:{ goalMain:s.goalMain, goalSecond:s.goalSecond||null, years:s.years, skills:s.skills||[], place:s.place, gymGear:s.gymGear||[], homeGear:s.homeGear||[], brand:s.brand||'', daysList:days, minutes:Number(s.minutes)||60, zones, sports:s.sports||[], sportsNote:s.sportsNote||'', refuse:s.refuse||[], likes:s.likes||[], experience:s.experience||'', name:s.name, age:s.age, sex:s.sex, height:s.height, weight:s.weight, v:1 } }; }
function ivRecapHtml(p){ const s=p.spec||{}; const gm=IV_GOALS.find(x=>x[0]===s.goalMain), g2=IV_GOAL2.find(x=>x[0]===s.goalSecond);
  return `<p><b>${esc(p.name||'')}</b>, ${p.age||'?'} ans, ${p.height||'?'} cm, ${p.weight||'?'} kg · <b>${IV_LEVEL_FR[p.level]||p.level}</b> (${esc((IV_YEARS.find(x=>x[0]===s.years)||['',''])[1].toLowerCase())}${(s.skills||[]).filter(x=>x!=='none').length?', '+(s.skills||[]).filter(x=>x!=='none').map(v=>(IV_SKILLS.find(x=>x[0]===v)||[])[1].toLowerCase()).join(', '):''})</p>
    <p>Objectif n°1 <b>${esc(gm?gm[1].toLowerCase():'')}</b>${g2?' · n°2 <b>'+esc(g2[1].toLowerCase())+'</b>':''} · <b>${p.days} jours</b> ${(p.daysList||[]).map(k=>IV_DAYS[k]).join(' ')} · <b>${p.minutes} min</b> maxi</p>
    <p>${esc(p.equipment||'')}</p>
    ${(s.zones||[]).length?`<p><b>${esc(p.constraints)}</b></p>`:'<p>Aucune zone à ménager</p>'}
    ${p.sports?`<p>${esc(p.sports)}</p>`:''}
    ${(s.refuse||[]).length?`<p>Refuse : ${esc((s.refuse||[]).map(v=>(IV_REFUSE.find(x=>x[0]===v)||[])[1]).join(', ').toLowerCase())}</p>`:''}
    ${(s.likes||[]).length?`<p>Aime : ${esc((s.likes||[]).map(v=>(IV_LIKES.find(x=>x[0]===v)||[])[1]).join(', ').toLowerCase())}</p>`:''}
    ${p.experience?`<p>Repères : ${esc(p.experience)}</p>`:''}`; }

function showOnboarding(step){ ONB_STEP=step;
  restoreShell(); document.querySelector('.tabs').hidden=true; $('#weekChip').hidden=true;
  const m=document.querySelector('main');
  if(step==='profile'||!PROFILE){ IV.start(PROFILE||{name:(USER&&USER.displayName?USER.displayName.split(' ')[0]:'')}); return; }
  m.innerHTML=`<section class="onb"><div class="onb-prog"><i style="width:100%"></i></div><h2>Ton programme</h2>
    <div class="kaisay">${coachAvatar('idle')}<p>J'ai ce qu'il me faut. Je construis ton premier cycle : les séances, chaque exercice avec pourquoi il est là et comment l'exécuter, les séries, les repos, la progression semaine par semaine. Ensuite on le fait évoluer ensemble.</p></div>
    <div class="row2"><button class="btn fill" id="genBtn">${esc(COACH_NAME)}, construis mon programme</button></div>
    <div id="genWait" hidden><div class="wait">${coachAvatar('busy')}<div><b id="genStep">${esc(COACH_NAME)} lit ton profil…</b><p class="small muted">Une à deux minutes. Tu peux garder l'écran ouvert ou revenir plus tard, le programme t'attendra.</p></div></div></div>
    <p class="small err" id="genMsg"></p>
    <p class="small muted"><button class="link" id="onbDiag">Un problème ? Voir le diagnostic</button></p>
    ${DEFAULT_PROGRAM&&USER&&ADMIN_RE.test(USER.email||'')?`<div id="genAlt" ${GEN_STATE&&GEN_STATE.status==='error'?'':'hidden'}><p class="small">Si ${esc(COACH_NAME)} n'y arrive pas, tu peux démarrer avec le programme de base « ${esc(DEFAULT_PROGRAM.cycleName||'Fondations')} » (4 semaines, force et hypertrophie) : il l'adaptera ensuite à tes retours.</p><button class="btn sm" id="importBtn">Démarrer avec le programme de base</button></div>`:''}
    <p class="small muted"><button class="link" id="backProf">Modifier mon profil</button></p>
  </section>`;
  $('#genBtn').onclick=()=>generateProgram(); const od=$('#onbDiag'); if(od) od.onclick=showDiag;
  if(GEN_STATE&&GEN_STATE.status==='running'&&Date.now()-(GEN_STATE.startedAt||0)<8*60000){ $('#genBtn').hidden=true; $('#genWait').hidden=false; GENERATING=true; }
  else if(GEN_STATE&&GEN_STATE.status==='error'&&!GENERATING){ $('#genMsg').textContent='La dernière tentative a échoué : '+GEN_STATE.message+'. Réessaie, le programme est construit uniquement à partir de ton profil.'; $('#genBtn').textContent='Réessayer'; }
  $('#backProf').onclick=()=>IV.start(PROFILE||{},{step:9});
  const ib=$('#importBtn'); if(ib) ib.onclick=async()=>{ ib.disabled=true; try{ await saveProgram(DEFAULT_PROGRAM, DEFAULT_CYCLE_HTML); toast('Programme de base installé','ok'); }catch(e){ ib.disabled=false; $('#genMsg').textContent=humanErr(e); logErr('import',e); } };
}
const ONB_DRAFT={};
function onbStep(i){
  const p=Object.assign({},PROFILE||{},ONB_DRAFT); const m=document.querySelector('main');
  const steps=[
    {t:'Qui es-tu ?',s:'Le coach adapte tout à ton gabarit et à ton niveau.',f:`<label>Prénom<input name="name" value="${esc(p.name||(USER&&USER.displayName?USER.displayName.split(' ')[0]:''))}" required autofocus></label>
      <div class="grid2"><label>Âge<input name="age" type="number" inputmode="numeric" min="14" max="90" value="${p.age||''}" required></label><label>Sexe<select name="sex"><option value="h" ${p.sex==='h'?'selected':''}>Homme</option><option value="f" ${p.sex==='f'?'selected':''}>Femme</option></select></label></div>
      <div class="grid2"><label>Taille (cm)<input name="height" type="number" inputmode="numeric" value="${p.height||''}" required></label><label>Poids (kg)<input name="weight" type="number" inputmode="decimal" step="0.1" value="${p.weight||''}" required></label></div>
      <label>Niveau<select name="level">${LEVELS.map(([v,l])=>`<option value="${v}" ${p.level===v?'selected':''}>${l}</option>`).join('')}</select></label>`},
    {t:'Tes objectifs',s:'Coche 2 à 4 objectifs, le premier coché compte le plus.',f:`<fieldset><div class="chks">${GOALS.map(([v,l])=>`<label class="chk"><input type="checkbox" name="goals" value="${v}" ${(p.goals||[]).includes(v)?'checked':''}> ${l}</label>`).join('')}</div></fieldset>
      <label>En une phrase, ce que tu veux vraiment<textarea name="goalsText" rows="2" placeholder="Ex. : passer de 35 à 70 tractions, rattraper des jambes faibles, rester sec">${esc(p.goalsText||'')}</textarea></label>`},
    {t:'Ton cadre',s:'Où, combien de fois, combien de temps.',f:`<div class="grid2"><label>Séances par semaine<select name="days">${[2,3,4,5,6].map(n=>`<option ${String(p.days||4)===String(n)?'selected':''}>${n}</option>`).join('')}</select></label><label>Durée (min)<select name="minutes">${[45,60,75,90].map(n=>`<option ${String(p.minutes||60)===String(n)?'selected':''}>${n}</option>`).join('')}</select></label></div>
      <fieldset><legend>Matériel disponible</legend><div class="chks">${GEAR.map(([v,l])=>`<label class="chk"><input type="checkbox" name="gear" value="${v}" ${(p.gear||[]).includes(v)?'checked':''}> ${l}</label>`).join('')}</div></fieldset>
      <label>Précisions sur ta salle ou ton matériel<textarea name="equipment" rows="2" placeholder="Ex. : ON AIR Lyon, parc Technogym et Hammer Strength. Ou : garage, haltères jusqu'à 30 kg, élastiques 15-40 kg.">${esc(p.equipment||'')}</textarea></label>
      <label>Autres pratiques à intégrer<textarea name="sports" rows="2" placeholder="Ex. : course à pied 2 fois par semaine, escalade, rugby le samedi, yoga, rééducation du genou">${esc(p.sports||'')}</textarea></label>`},
    {t:'Ce que le coach doit savoir',s:'Blessures, contraintes, repères. Plus c\'est précis, plus le programme est juste.',f:`<label>Contraintes, douleurs, métier<textarea name="constraints" rows="2" placeholder="Ex. : gardes de 24 h, épaule droite sensible, pas de squat lourd">${esc(p.constraints||'')}</textarea></label>
      <label>Repères actuels<textarea name="experience" rows="3" placeholder="Ex. : squat 100 kg × 5, 35 tractions, développé couché 80 kg, 3 ans d'entraînement">${esc(p.experience||'')}</textarea></label>
      <p class="small muted">Rituel ne remplace pas un avis médical. En cas de douleur, de pathologie ou de reprise après blessure, valide ton programme avec un professionnel de santé.</p>`},
  ];
  const st=steps[i];
  const say=['Je règle l\'exigence sur ton niveau et ton gabarit. Sois précis, je m\'adapte ensuite.','Dis-moi ce que tu veux vraiment. Je fais les arbitrages entre tes objectifs, et je te dirai lesquels.','Je ne te proposerai que des exercices faisables avec ce que tu as, où que tu t\'entraînes.','Blessures, gardes, douleurs : je construis autour, pas contre. Rien de ce que tu écris ici n\'est jugé.'][i]||'';
  m.innerHTML=`<section class="onb"><div class="onb-prog"><i style="width:${Math.round(100*(i+1)/(steps.length+1))}%"></i></div><p class="eyebrow">Étape ${i+1} sur ${steps.length}</p><h2>${st.t}</h2><div class="kaisay">${coachAvatar('idle')}<p>${esc(say||st.s)}</p></div>
    <form class="form" id="onbForm">${st.f}<div class="row2 onb-nav">${i>0?'<button type="button" class="btn" id="onbBack">Retour</button>':''}<button class="btn fill" type="submit">${i<steps.length-1?'Continuer':'Terminer'}</button></div></form></section>`;
  window.scrollTo({top:0});
  const back=$('#onbBack'); if(back) back.onclick=()=>{ collect(); onbStep(i-1); };
  function collect(){ const f=new FormData($('#onbForm')); const d={}; for(const [k,v] of f.entries()){ if(k==='goals'||k==='gear') (d[k]=d[k]||[]).push(v); else d[k]=String(v).trim(); } if($('#onbForm input[name=goals]')&&!d.goals) d.goals=[]; if($('#onbForm input[name=gear]')&&!d.gear) d.gear=[]; Object.assign(ONB_DRAFT,d); }
  $('#onbForm').onsubmit=async e=>{ e.preventDefault(); collect();
    if(i===1&&(ONB_DRAFT.goals||[]).length<1){ toast('Coche au moins un objectif'); return; }
    if(i===2&&(ONB_DRAFT.gear||[]).length<1){ toast('Coche ton matériel'); return; }
    if(i<steps.length-1){ onbStep(i+1); return; }
    const out=Object.assign({},PROFILE||{},ONB_DRAFT); ['age','height','weight','days','minutes'].forEach(k=>out[k]=Number(out[k])); out.updatedAt=Date.now(); out.createdAt=(PROFILE&&PROFILE.createdAt)||Date.now();
    PROFILE=out; try{ await fbDb.collection('users').doc(USER.uid).collection('meta').doc('profile').set(out); }catch(err){ alert('Enregistrement impossible : '+err.message); return; }
    showOnboarding('program');
  };
}
function profileForm(p){
  const chk=(arr,sel)=>arr.map(([v,l])=>`<label class="chk"><input type="checkbox" name="goals" value="${v}" ${(sel||[]).includes(v)?'checked':''}> ${l}</label>`).join('');
  return `<form class="form" id="profForm">
    <label>Prénom<input name="name" value="${esc(p.name||(USER&&USER.displayName?USER.displayName.split(' ')[0]:''))}" required></label>
    <div class="grid2"><label>Âge<input name="age" type="number" inputmode="numeric" min="14" max="90" value="${p.age||''}" required></label>
    <label>Sexe<select name="sex"><option value="h" ${p.sex==='h'?'selected':''}>Homme</option><option value="f" ${p.sex==='f'?'selected':''}>Femme</option></select></label></div>
    <div class="grid2"><label>Taille (cm)<input name="height" type="number" inputmode="numeric" value="${p.height||''}" required></label>
    <label>Poids (kg)<input name="weight" type="number" inputmode="decimal" step="0.1" value="${p.weight||''}" required></label></div>
    <label>Niveau<select name="level">${LEVELS.map(([v,l])=>`<option value="${v}" ${p.level===v?'selected':''}>${l}</option>`).join('')}</select></label>
    <div class="grid2"><label>Test de référence<select name="refTest">${REF_TESTS.map(([v,l])=>`<option value="${v}" ${(p.refTest||'tractions')===v?'selected':''}>${l}</option>`).join('')}</select></label>
    <label>Objectif sur ce test<input name="refGoal" type="number" inputmode="numeric" min="1" value="${p.refGoal||p.pullGoal||''}" placeholder="ex. 70"></label></div>
    <fieldset><legend>Objectifs (2 à 4, par ordre d'importance en cochant)</legend><div class="chks">${chk(GOALS,p.goals)}</div></fieldset>
    <label>Précision sur tes objectifs<textarea name="goalsText" rows="2" placeholder="Ex. : passer de 35 à 70 tractions, rattraper des jambes faibles, rester à 69 kg">${esc(p.goalsText||'')}</textarea></label>
    <div class="grid2"><label>Séances par semaine<select name="days">${[2,3,4,5,6].map(n=>`<option ${String(p.days||4)===String(n)?'selected':''}>${n}</option>`).join('')}</select></label>
    <label>Durée par séance (min)<select name="minutes">${[45,60,75,90].map(n=>`<option ${String(p.minutes||60)===String(n)?'selected':''}>${n}</option>`).join('')}</select></label></div>
    <fieldset><legend>Matériel disponible</legend><div class="chks">${GEAR.map(([v,l])=>`<label class="chk"><input type="checkbox" name="gear" value="${v}" ${(p.gear||[]).includes(v)?'checked':''}> ${l}</label>`).join('')}</div></fieldset>
    <label>Précisions sur ta salle ou ton matériel<textarea name="equipment" rows="2">${esc(p.equipment||'')}</textarea></label>
    <label>Autres pratiques à intégrer<textarea name="sports" rows="2" placeholder="Ex. : course à pied, escalade, sport collectif, rééducation">${esc(p.sports||'')}</textarea></label>
    <label>Contraintes, blessures, métier<textarea name="constraints" rows="2" placeholder="Ex. : gardes de 24 h, épaule droite sensible, pas de squat lourd, entraînement le matin">${esc(p.constraints||'')}</textarea></label>
    <label>Expérience et repères actuels<textarea name="experience" rows="2" placeholder="Ex. : squat 100 kg × 5, 35 tractions, développé couché 80 kg, 3 ans de PPL">${esc(p.experience||'')}</textarea></label>
    <div class="row2"><button class="btn fill" type="submit">Enregistrer</button></div></form>`;
}
function bindProfileForm(after,root){
  $('#profForm',root||document).onsubmit=async e=>{ e.preventDefault(); const f=new FormData(e.target); const p={}; for(const [k,v] of f.entries()){ if(k==='goals'||k==='gear') (p[k]=p[k]||[]).push(v); else p[k]=String(v).trim(); } if(!p.gear) p.gear=[];
    ['age','height','weight','days','minutes'].forEach(k=>p[k]=Number(p[k])); p.refGoal=p.refGoal?Number(p.refGoal):null; if(!p.refGoal) delete p.refGoal; if(PROFILE&&PROFILE.pullGoal&&!p.refGoal&&(p.refTest||'tractions')==='tractions') p.refGoal=PROFILE.pullGoal; p.updatedAt=Date.now(); if(!PROFILE||!PROFILE.createdAt) p.createdAt=Date.now(); else p.createdAt=PROFILE.createdAt;
    PROFILE=p; try{ await fbDb.collection('users').doc(USER.uid).collection('meta').doc('profile').set(p); }catch(err){ alert('Enregistrement impossible : '+err.message); return; }
    after&&after(); };
}
async function generateProgram(){
  if(GENERATING) return; GENERATING=true;
  const msg=$('#genMsg'), btn=$('#genBtn'), wait=$('#genWait'); if(btn) btn.hidden=true; if(wait) wait.hidden=false; if(msg) msg.textContent='';
  const stepsTxt=[COACH_NAME+' lit ton profil…','Il choisit les exercices pour ton matériel…','Il règle séries, repos et progression…','Il rédige les explications de chaque exercice…','Dernières vérifications…']; let k=0; startJob('construit ton programme',stepsTxt.map(x=>x.replace(/…$/,'')),90000);
  const iv=setInterval(()=>{ k=Math.min(k+1,stepsTxt.length-1); const e=$('#genStep'); if(e) e.textContent=stepsTxt[k]; },18000);
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); await fn({mode:'program'}); }
  catch(e){ logErr('program',e); const m=(e&&e.message)||''; const cut=/deadline|timeout|network|Failed to fetch|internal|unavailable/i.test(m+' '+(e&&e.code||''));
    if(cut){ // la connexion a lâché mais le serveur continue : on attend le programme par Firestore (jusqu'à 8 min), puis on propose le repli
      let n=0; const poll=setInterval(()=>{ n++; if(PROGRAM_LOADED){ clearInterval(poll); clearInterval(iv); GENERATING=false; endJob(true,'Programme prêt'); return; } if(GEN_STATE&&GEN_STATE.status==='error'){ clearInterval(poll); clearInterval(iv); GENERATING=false; endJob(false,GEN_STATE.message); if(msg) msg.textContent=GEN_STATE.message; if(btn){ btn.hidden=false; btn.textContent='Réessayer'; } if(wait) wait.hidden=true; const ga=$('#genAlt'); if(ga) ga.hidden=false; } else if(n>96){ clearInterval(poll); clearInterval(iv); GENERATING=false; endJob(false,'Trop long'); if(msg) msg.textContent='Le coach met trop de temps. Réessaie dans une minute, ton profil est enregistré.'; if(btn){ btn.hidden=false; btn.textContent='Réessayer'; } if(wait) wait.hidden=true; const ga=$('#genAlt'); if(ga) ga.hidden=false; } },5000); return; }
    GENERATING=false; endJob(false,humanErr(e)); if(msg) msg.textContent=humanErr(e); if(btn){ btn.hidden=false; btn.textContent='Réessayer'; } if(wait) wait.hidden=true; const ga=$('#genAlt'); if(ga) ga.hidden=false; clearInterval(iv); return; }
  clearInterval(iv); GENERATING=false; endJob(true,'Programme prêt');
}
async function saveProgram(prog, cycleHtml){
  const doc=JSON.parse(JSON.stringify(prog)); doc.cycleHtml=cycleHtml||doc.cycleHtml||''; doc.savedAt=Date.now();
  await fbDb.collection('users').doc(USER.uid).collection('meta').doc('program').set(doc);
}
// Une séance d'un jour passé avec des séries enregistrées mais jamais « terminée » est clôturée automatiquement :
// elle compte pour la semaine, le coach la voit, et l'analyse est lancée si le réseau le permet.
function autoCloseLogs(){
  const today=todayISO(); let n=0; const keys=[];
  Object.entries(S.logs).forEach(([k,l])=>{ if(!l.done&&l.date<today&&Object.keys(l.sets||{}).length){ l.done=true; l.autoClosed=true; l.updatedAt=Date.now(); n++; keys.push(k); writeDoc('logs',k,l); } });
  if(n){ save(); toast(n===1?'Séance d\'hier clôturée':n+' séances clôturées'); if(USER&&navigator.onLine) keys.slice(-2).forEach(k=>{ if(!COACH.items.some(i=>i.logKey===k)) analyseSession(k); }); }
  return n;
}
function applyProgram(p){
  PROGRAM=p; if(p.weeks&&p.weeks.length) WEEKS=p.weeks; PROGRAM_LOADED=true; ONB_STEP=null;
  const sm=document.querySelector('.brand small'); if(sm) sm.textContent=p.cycleName||'';
  restoreShell(); autoCloseLogs(); renderCycle(); render(); ensureDemos(); prefetchDemos();
}
function cycleHtml(){
  if(PROGRAM.cycleHtml) return PROGRAM.cycleHtml;
  let h=`<h2>${esc(PROGRAM.cycleName||'Cycle')}</h2>`;
  if(PROGRAM.rationale) h+=mdToHtml(PROGRAM.rationale);
  if(PROGRAM.weeks) h+=`<h3>Semaines</h3><div class="tw"><table><thead><tr><th>Semaine</th><th>Dates</th><th>Consigne</th></tr></thead><tbody>${PROGRAM.weeks.map(w=>`<tr><td>${esc(w.label)}</td><td class="num">${fmtD(w.from)}–${fmtD(w.to)}</td><td>${esc(w.rirNote||'')}</td></tr>`).join('')}</tbody></table></div>`;
  if(PROGRAM.nutrition) h+=`<h3>Nutrition</h3>${mdToHtml(PROGRAM.nutrition)}`;
  if(PROGRAM.generatedAt) h+=`<p class="small muted">Programme généré par le coach le ${new Date(PROGRAM.generatedAt).toLocaleDateString('fr-FR')}.</p>`;
  return h;
}
function renderCycle(){}
function mdToHtml(md){ return String(md||'').split(/\n{2,}/).map(par=>{ par=par.trim(); if(!par) return ''; if(/^#+\s/.test(par)) return `<h3>${esc(par.replace(/^#+\s*/,''))}</h3>`; if(/^[-*]\s/m.test(par)) return `<ul>${par.split(/\n/).map(l=>`<li>${inline(l.replace(/^[-*]\s*/,''))}</li>`).join('')}</ul>`; return `<p>${inline(par).replace(/\n/g,'<br>')}</p>`; }).join(''); function inline(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); } }

/* écoute du profil et du programme après connexion */
function listenMeta(){
  unsubs.push(fbDb.collection('users').doc(USER.uid).collection('meta').onSnapshot(snap=>{
    let prof=null, prog=null; snap.docs.forEach(d=>{ if(d.id==='profile') prof=d.data(); if(d.id==='program') prog=d.data(); if(d.id==='usage') USAGE=d.data(); if(d.id==='billing') BILLING.doc=d.data(); if(d.id==='genstate') GEN_STATE=d.data(); });
    PROFILE=prof;
    const isAdm=!!(USER&&ADMIN_RE.test(USER.email||'')); if(prog&&prog.sessions&&prog.sessions.length&&!prog.generatedAt&&!isAdm) prog=null; // copie d'un programme de base : jamais affichée, on génère le sien
    if(prog&&prog.sessions&&prog.sessions.length){ GENERATING=false; applyProgram(prog); }
    else if(snap.metadata.fromCache&&!snap.docs.length){ /* première ouverture hors ligne : attendre le serveur */ }
    else if(GENERATING){ /* génération en cours : l'écriture du compteur d'usage ne doit pas réinitialiser l'écran d'attente */ }
    else { PROGRAM_LOADED=false; const step=prof?'program':'profile'; if(ONB_STEP!==step||!document.querySelector('.onb')) showOnboarding(step); }
  }, err=>{ console.warn('meta',err); logErr('listen meta',err); }));
}
async function regenerateProgram(force){
  if(force!==true&&!confirm('Générer un nouveau mésocycle ? Le programme actuel est remplacé, ton journal est conservé.')) return;
  if(GENERATING) return; GENERATING=true;
  const el=$('#tab-programme'); const old=$('#regenMsg'); if(old) old.remove(); if(el) el.insertAdjacentHTML('afterbegin','<div class="banner info" id="regenMsg">'+esc(COACH_NAME)+' rédige le nouveau cycle, une à deux minutes. Tu peux changer d\'onglet, le programme s\'affichera tout seul.</div>');
  startJob('construit ton nouveau cycle',['Lit ta fiche','Choisit les exercices pour ton matériel','Règle séries, repos et progression','Vérifie la conformité'],90000);
  const fail=msg=>{ GENERATING=false; endJob(false,msg); const m=$('#regenMsg'); if(m){ m.className='banner'; m.innerHTML='<b>Génération refusée.</b> '+esc(msg)+' <button class="link" id="regenDiag">Voir le diagnostic</button>'; const d=$('#regenDiag'); if(d) d.onclick=showDiag; } logErr('regen',new Error(msg)); };
  const done=()=>{ GENERATING=false; endJob(true,'Nouveau cycle prêt'); const m=$('#regenMsg'); if(m) m.remove(); PROG_OPEN=undefined; render(); toast('Nouveau cycle prêt','ok'); };
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); const r=await fn({mode:'program'}); if(r&&r.data&&r.data.running){ /* déjà en cours côté serveur : on attend Firestore */ } else { done(); return; } }
  catch(e){ const m=(e&&e.message)||String(e); const cut=/deadline|timeout|network|Failed to fetch|unavailable/i.test(m+' '+(e&&e.code||'')); if(!cut){ fail(humanErr(e)); return; } }
  // appel coupé ou génération déjà en cours : le résultat arrive par Firestore (meta/program et meta/genstate)
  const t0=Date.now(); const poll=setInterval(()=>{ if(PROGRAM.generatedAt&&PROGRAM.generatedAt>t0-60000&&PROGRAM.generatedAt>(GEN_STATE&&GEN_STATE.startedAt||0)-1){ clearInterval(poll); done(); return; } if(GEN_STATE&&GEN_STATE.status==='error'&&GEN_STATE.at>t0){ clearInterval(poll); fail(GEN_STATE.message||'erreur'); return; } if(Date.now()-t0>8*60000){ clearInterval(poll); fail('Le coach met trop de temps, réessaie dans une minute.'); } },4000);
}

/* ---------- wake lock ---------- */
let wakeLock=null;
async function requestWake(){ if(S.wake===false) return; native({type:'keepAwake',on:true}); try{ if('wakeLock' in navigator && !wakeLock){ wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{wakeLock=null;}); } }catch(e){} }
function releaseWake(){ native({type:'keepAwake',on:false}); try{ wakeLock&&wakeLock.release(); }catch(e){} wakeLock=null; }
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&sessionActive()) requestWake(); });
function sessionActive(){ if(!PROGRAM.sessions.length) return false; const l=S.logs[logKey(todayISO(),curSession().id)]; return !!(l&&!l.done&&Object.keys(l.sets).length); }

/* ---------- timer ---------- */
let T={end:0,total:0,raf:0,label:'',fired:false};
let audioCtx=null;
function unlockAudio(){ try{ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }catch(e){} }
function beep(n=3){ try{ if(!audioCtx) return; let t=audioCtx.currentTime; for(let i=0;i<n;i++){ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='square'; o.frequency.value=880; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.4,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.22); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.25); t+=0.32; } }catch(e){} }
function startTimer(sec,l1,l2){ unlockAudio(); T.end=Date.now()+sec*1000; T.total=sec; T.fired=false; native({type:'restTimer',seconds:sec,title:'Repos terminé',body:(l2||l1||'Série suivante')}); $('#tL1').textContent=l1; $('#tL2').textContent=l2||''; $('#timer').classList.add('on'); cancelAnimationFrame(T.raf); tick(); }
function stopTimer(){ native({type:'cancelTimer'}); cancelAnimationFrame(T.raf); $('#timer').classList.remove('on'); document.title='Rituel'; }
function tick(){
  const left=Math.round((T.end-Date.now())/1000); const a=Math.abs(left);
  $('#tT').textContent=(left<0?'+':'')+Math.floor(a/60)+':'+String(a%60).padStart(2,'0');
  $('#tT').classList.toggle('over',left<0);
  $('#tBar').style.width=Math.max(0,Math.min(100,100*(1-left/T.total)))+'%';
  document.title=(left<=0?'GO · ':Math.floor(a/60)+':'+String(a%60).padStart(2,'0')+' · ')+'Rituel';
  if(left<=0&&!T.fired){ T.fired=true; native({type:'haptic',kind:'success'}); beep(3); try{navigator.vibrate&&navigator.vibrate([200,100,200,100,400]);}catch(e){} if(document.hidden&&window.Notification&&Notification.permission==='granted'){ try{ new Notification('Repos terminé',{body:T.label||'Série suivante'}); }catch(e){} } }
  if(left<=-60){ stopTimer(); return; }
  T.raf=requestAnimationFrame(()=>setTimeout(tick,250));
}
$('#tStop').onclick=stopTimer; $('#tPlus').onclick=()=>{T.end+=30000;T.total+=30; native({type:'restTimer',seconds:Math.max(1,Math.round((T.end-Date.now())/1000)),title:'Repos terminé'});}; $('#tMinus').onclick=()=>{T.end-=15000; native({type:'restTimer',seconds:Math.max(1,Math.round((T.end-Date.now())/1000)),title:'Repos terminé'});};
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&$('#timer').classList.contains('on')) tick(); });


/* ---------- Rang et badges : récompenses sur des jalons réels (séances, records, tractions, régularité) ---------- */
const RANKS=[{xp:0,name:'Recrue'},{xp:60,name:'Solide'},{xp:180,name:'Costaud'},{xp:400,name:'Athlète'},{xp:800,name:'Élite'},{xp:1500,name:'Vétéran'},{xp:2500,name:'Légende'},{xp:4000,name:'Titan'}];
// Palette par famille : séances = rouge, records = or, tractions = bleu, régularité = vert, cycle = violet.
const BADGES=[
  {id:'s1',name:'Première séance',how:'1 séance terminée',fam:'ses',icon:'bolt',test:f=>f.sessions>=1,prog:f=>[f.sessions,1]},
  {id:'s10',name:'Dix séances',how:'10 séances terminées',fam:'ses',icon:'bolt',tier:2,test:f=>f.sessions>=10,prog:f=>[f.sessions,10]},
  {id:'s25',name:'Vingt-cinq',how:'25 séances terminées',fam:'ses',icon:'bolt',tier:3,test:f=>f.sessions>=25,prog:f=>[f.sessions,25]},
  {id:'s50',name:'Cinquante',how:'50 séances terminées',fam:'ses',icon:'bolt',tier:4,test:f=>f.sessions>=50,prog:f=>[f.sessions,50]},
  {id:'s100',name:'Centurion',how:'100 séances terminées',fam:'ses',icon:'bolt',tier:5,test:f=>f.sessions>=100,prog:f=>[f.sessions,100]},
  {id:'pr1',name:'Premier record',how:'1 record personnel',fam:'pr',icon:'trophy',test:f=>f.prs>=1,prog:f=>[f.prs,1]},
  {id:'pr5',name:'Cinq records',how:'5 records personnels',fam:'pr',icon:'trophy',tier:3,test:f=>f.prs>=5,prog:f=>[f.prs,5]},
  {id:'pr15',name:'Collectionneur',how:'15 records personnels',fam:'pr',icon:'trophy',tier:5,test:f=>f.prs>=15,prog:f=>[f.prs,15]},
  {id:'t1',name:'Premier test',how:'1 test de référence noté',fam:'pull',icon:'bar',test:f=>f.tests>=1,prog:f=>[f.tests,1]},
  {id:'tp10',name:'+10 %',how:'10 % de mieux que ton premier test',fam:'pull',icon:'bar',tier:2,test:f=>f.gain>=10,prog:f=>[Math.max(0,f.gain),10]},
  {id:'tp25',name:'+25 %',how:'25 % de mieux que ton premier test',fam:'pull',icon:'bar',tier:3,test:f=>f.gain>=25,prog:f=>[Math.max(0,f.gain),25]},
  {id:'tp50',name:'+50 %',how:'50 % de mieux que ton premier test',fam:'pull',icon:'bar',tier:4,test:f=>f.gain>=50,prog:f=>[Math.max(0,f.gain),50]},
  {id:'tp100',name:'Doublé',how:'Deux fois ton premier test',fam:'pull',icon:'bar',tier:5,test:f=>f.gain>=100,prog:f=>[Math.max(0,f.gain),100]},
  {id:'w1',name:'Semaine pleine',how:'1 semaine complète',fam:'reg',icon:'flame',test:f=>f.fullWeeks>=1,prog:f=>[f.fullWeeks,1]},
  {id:'w4',name:'Un mois sans faille',how:'4 semaines complètes',fam:'reg',icon:'flame',tier:3,test:f=>f.fullWeeks>=4,prog:f=>[f.fullWeeks,4]},
  {id:'w12',name:'Trimestre de fer',how:'12 semaines complètes',fam:'reg',icon:'flame',tier:5,test:f=>f.fullWeeks>=12,prog:f=>[f.fullWeeks,12]},
  {id:'c1',name:'Cycle bouclé',how:'1 mésocycle terminé',fam:'cyc',icon:'star',tier:2,test:f=>f.cycles>=1,prog:f=>[f.cycles,1]},
  {id:'ton',name:'Dix tonnes',how:'10 t soulevées en une semaine',fam:'cyc',icon:'star',tier:4,test:f=>f.maxTon>=10000,prog:f=>[Math.round(f.maxTon/100)/10,10]}
];
const BADGE_FAM={ses:['#FF7A5C','#C8321F'],pr:['#FFD86B','#C98A00'],pull:['#6FB4FF','#1E55C8'],reg:['#5FE0A0','#167A4A'],cyc:['#C08BFF','#6A2DD1']};
// Médailles : rendus 3D (public/badges/*.webp, générés par tools/render-badges.py), anneau de progression SVG par-dessus les non obtenues.
const BADGE_BASE='badges/';
function badgeSvg(b,size,locked,facts){
  const [c1]=BADGE_FAM[b.fam]||BADGE_FAM.ses; let ring='';
  if(locked){ const pr=b.prog&&facts?b.prog(facts):null; const pct=pr?Math.max(0,Math.min(1,pr[0]/pr[1])):0; const L=2*Math.PI*46;
    if(pct>0) ring=`<svg viewBox="0 0 100 100" class="bring" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="${c1}" stroke-opacity=".18" stroke-width="3"/><circle cx="50" cy="50" r="46" fill="none" stroke="${c1}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(L*pct).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`; }
  return `<span class="badge ${locked?'lock':''}" style="width:${size}px;height:${size}px"><img src="${BADGE_BASE}${b.id}${locked?'_lock':''}.webp" alt="" loading="lazy" decoding="async">${ring}</span>`;
}
function rankSvg(stage,size){ return `<span class="rank" style="width:${size}px;height:${size}px"><img src="${BADGE_BASE}rank${Math.max(1,Math.min(8,stage))}.webp" alt="" decoding="async"></span>`; }
function progressFacts(){
  const logs=Object.values(S.logs).filter(l=>l.done); const sessions=logs.length;
  let fullWeeks=0, maxTon=0; try{ const ws=suiviStats().weeks.filter(w=>!w.future); fullWeeks=ws.filter(w=>w.done>=w.planned).length; maxTon=Math.max(0,...ws.map(w=>w.tonnage||0)); }catch(e){}
  let prs=0; const best={}; Object.values(S.logs).sort((x,y)=>x.date<y.date?-1:1).forEach(l=>Object.entries(l.sets||{}).forEach(([exId,arr])=>{ let day=0; (arr||[]).forEach(st=>{ if(!st||!st.done||!st.w||!st.r) return; const v=e1rm(st.w,st.r); if(v>day) day=v; }); if(!day) return; if(best[exId]==null) best[exId]=day; else if(day>best[exId]+0.01){ best[exId]=day; prs++; } }));
  const tests=Object.values(S.tests||{}).sort((x,y)=>x.date<y.date?-1:1); const pull=tests.length?Math.max(...tests.map(t=>t.reps||0)):0; const first=tests.length?(tests[0].reps||0):0; const gain=first>0?Math.round(100*(pull-first)/first):0;
  const cycles=(S.cyclesDone||0)+(cycleOver()?1:0);
  const xp=sessions*10+prs*15+tests.length*5+fullWeeks*25+challengeXp();
  let stage=1; RANKS.forEach((st,i)=>{ if(xp>=st.xp) stage=i+1; });
  const next=RANKS[stage]||null, prev=RANKS[stage-1];
  const f={sessions,prs,pull,first,gain,fullWeeks,maxTon,tests:tests.length,cycles,xp,stage,stageName:RANKS[stage-1].name,next,pct:next?Math.round(100*(xp-prev.xp)/(next.xp-prev.xp)):100};
  f.unlocked=BADGES.filter(b=>b.test(f)).map(b=>b.id); f.nextBadge=BADGES.find(b=>!f.unlocked.includes(b.id))||null;
  S.badgeDates=S.badgeDates||{}; let nd=false; f.unlocked.forEach(id=>{ if(!S.badgeDates[id]){ S.badgeDates[id]=todayISO(); nd=true; } }); if(nd) save(); return f;
}
// Cérémonie de déblocage : écran plein, médaille qui tombe en tournant, confettis, partage. Un badge à la fois.
let UNLOCK_QUEUE=[], UNLOCK_BUSY=false;
function checkUnlocks(){ syncChallenges(); const f=progressFacts(); const seen=S.badgesSeen||[]; const fresh=f.unlocked.filter(id=>!seen.includes(id));
  if(S.rankSeen==null){ S.rankSeen=f.stage; save(); } else if(f.stage>S.rankSeen&&!UNLOCK_QUEUE.includes('rank')){ UNLOCK_QUEUE.push('rank'); }
  if(!fresh.length&&!UNLOCK_QUEUE.length) return;
  if(!S.badgesSeen||S.badgesSeenV!==2){ S.badgesSeen=f.unlocked.slice(); S.badgesSeenV=2; save(); return; } // premier passage (ou anciens identifiants) : l'historique est acquis sans cérémonie
  fresh.forEach(id=>{ if(!UNLOCK_QUEUE.includes(id)) UNLOCK_QUEUE.push(id); }); if(!UNLOCK_BUSY) nextUnlock(); }
function nextUnlock(){ const id=UNLOCK_QUEUE.shift(); if(!id){ UNLOCK_BUSY=false; return; } UNLOCK_BUSY=true; if(id==='rank'){ const f=progressFacts(); S.rankSeen=f.stage; save(); showRankUp(f,nextUnlock); return; } const b=BADGES.find(x=>x.id===id); S.badgesSeen=(S.badgesSeen||[]).concat(id); save(); showUnlock(b,nextUnlock); }
function showUnlock(b,done){
  const f=progressFacts(); const got=f.unlocked.length;
  const el=document.createElement('div'); el.className='unlock'; el.innerHTML=`<canvas class="confetti"></canvas><div class="uwrap"><p class="eyebrow">Nouveau badge · ${got}/${BADGES.length}</p><div class="ubadge" id="uBadge">${badgeSvg(b,240,false,f)}</div><h2>${esc(b.name)}</h2><p class="uhow">${esc(b.how)}</p><div class="row2"><button class="btn fill" id="uShare">Partager</button><button class="btn" id="uClose">Continuer</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add('unlocking'); native({type:'haptic',kind:'success'}); try{ navigator.vibrate&&navigator.vibrate([30,40,60]); }catch(e){}
  requestAnimationFrame(()=>el.classList.add('on'));
  confetti(el.querySelector('.confetti'),BADGE_FAM[b.fam]||BADGE_FAM.ses);
  tilt(el.querySelector('#uBadge'));
  const close=()=>{ el.classList.remove('on'); setTimeout(()=>{ el.remove(); document.body.classList.remove('unlocking'); renderHome(); if(done) done(); },260); };
  el.querySelector('#uClose').onclick=close; el.querySelector('#uShare').onclick=()=>shareBadge(b);
}
// Écran de fin de séance : durée, séries, tonnage, records, XP gagnée, défis, puis cérémonies éventuelles.
function showSessionSummary(log){
  const ses=PROGRAM.sessions.find(x=>x.id===log.session)||{name:log.session}; const sets=Object.values(log.sets||{}).flat().filter(x=>x&&x.done);
  const ts=sets.map(x=>x.t).filter(Boolean); const mins=ts.length>1?Math.max(1,Math.round((Math.max(...ts)-Math.min(...ts))/60000)):null;
  const ton=sets.reduce((t,x)=>t+(x.w||0)*(x.r||0),0); const prs=[]; Object.entries(log.sets||{}).forEach(([exId,arr])=>{ if((arr||[]).some(x=>x&&x.pr)){ const ex=ses.exercises&&ses.exercises.find(e=>e.id===exId); const best=Math.max(...arr.filter(x=>x&&x.done).map(x=>e1rm(x.w,x.r))); prs.push({name:ex?ex.name:exId,v:Math.round(best)}); } });
  const before=weeklyChallenges(log.date); syncChallenges(); const ch=weeklyChallenges(log.date);
  const xp=10+prs.length*15+ch.list.filter(c=>c.ok&&!(before.list.find(b=>b.id===c.id)||{}).ok).length*20;
  const st=dayStreak();
  const el=document.createElement('div'); el.className='unlock summary'; el.innerHTML=`<canvas class="confetti"></canvas><div class="uwrap"><p class="eyebrow">Séance terminée</p><h2>${esc(ses.name)}</h2>
    <div class="sstats"><div><b>${mins!=null?mins:'—'}</b><span>min</span></div><div><b>${sets.length}</b><span>séries</span></div><div><b>${ton>=1000?(ton/1000).toFixed(1).replace('.',','):Math.round(ton)}</b><span>${ton>=1000?'tonnes':'kg soulevés'}</span></div></div>
    <div class="sxp"><b>+${xp} XP</b><span>séance ${prs.length?`· ${prs.length} record${prs.length>1?'s':''}`:''}${ch.list.some(c=>c.ok&&!(before.list.find(b=>b.id===c.id)||{}).ok)?' · défi tenu':''}</span></div>
    ${prs.length?`<div class="sprs">${prs.map(r=>`<div><i>★</i><span>${esc(r.name)}</span><b>e1RM ${r.v} kg</b></div>`).join('')}</div>`:''}
    <div class="sstreak ${st.days>0?'on':''}"><i>🔥</i><span>${st.days} jour${st.days>1?'s':''} d'affilée</span></div>
    <div class="srow">${ch.list.map(c=>`<div class="${c.ok?'ok':''}"><small>${esc(c.name)}</small><em><u style="width:${c.pct}%"></u></em></div>`).join('')}</div>
    <div class="row2"><button class="btn fill" id="uKai">Analyse de Kai</button><button class="btn" id="uClose">Fermer</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add('unlocking'); native({type:'haptic',kind:'success'}); try{ navigator.vibrate&&navigator.vibrate([30,40,60]); }catch(e){}
  requestAnimationFrame(()=>el.classList.add('on')); if(prs.length) confetti(el.querySelector('.confetti'),['#FFD86B','#FFFFFF']);
  const close=(goKai)=>{ el.classList.remove('on'); setTimeout(()=>{ el.remove(); document.body.classList.remove('unlocking'); if(goKai&&USER&&navigator.onLine){ analyseSession(logKey(log.date,log.session)); document.querySelector('.tabs button[data-tab="coach"]').click(); } renderHome(); setTimeout(checkUnlocks,300); },260); };
  el.querySelector('#uClose').onclick=()=>close(false); el.querySelector('#uKai').onclick=()=>close(true);
}
function showRankUp(f,done){
  const el=document.createElement('div'); el.className='unlock rankup'; el.innerHTML=`<canvas class="confetti"></canvas><div class="uwrap"><p class="eyebrow">Nouveau rang · ${f.stage} sur ${RANKS.length}</p><div class="ubadge" id="uBadge">${rankSvg(f.stage,240)}</div><h2>${esc(f.stageName)}</h2><p class="uhow">${f.xp} XP${f.next?` · prochain rang « ${esc(f.next.name)} » à ${f.next.xp} XP`:' · rang maximal'}</p><div class="row2"><button class="btn fill" id="uClose">Continuer</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add('unlocking'); native({type:'haptic',kind:'success'}); try{ navigator.vibrate&&navigator.vibrate([30,40,60,40,90]); }catch(e){}
  requestAnimationFrame(()=>el.classList.add('on')); confetti(el.querySelector('.confetti'),['#FFD86B','#FFFFFF']); tilt(el.querySelector('#uBadge'));
  el.querySelector('#uClose').onclick=()=>{ el.classList.remove('on'); setTimeout(()=>{ el.remove(); document.body.classList.remove('unlocking'); renderHome(); if(done) done(); },260); };
}
function confetti(cv,colors){ const ctx=cv.getContext('2d'); const W=cv.width=innerWidth*devicePixelRatio, H=cv.height=innerHeight*devicePixelRatio; const cols=[colors[0],colors[1],'#FFD86B','#FFFFFF','#CFD4DC']; const P=[...Array(140)].map(()=>({x:W/2+(Math.random()-.5)*W*0.3,y:H*0.35,vx:(Math.random()-.5)*18*devicePixelRatio,vy:(-14-Math.random()*12)*devicePixelRatio,r:(3+Math.random()*5)*devicePixelRatio,c:cols[Math.floor(Math.random()*cols.length)],a:Math.random()*6.28,va:(Math.random()-.5)*.3,sh:Math.random()<.5}));
  let t=0; const step=()=>{ t++; ctx.clearRect(0,0,W,H); P.forEach(p=>{ p.vy+=0.55*devicePixelRatio; p.vx*=.985; p.x+=p.vx; p.y+=p.vy; p.a+=p.va; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.a); ctx.fillStyle=p.c; ctx.globalAlpha=Math.max(0,1-t/150); if(p.sh) ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); else { ctx.beginPath(); ctx.arc(0,0,p.r/1.6,0,6.28); ctx.fill(); } ctx.restore(); }); if(t<160&&cv.isConnected) requestAnimationFrame(step); }; setTimeout(()=>requestAnimationFrame(step),350); }
// Inclinaison 3D au doigt (ou au gyroscope si autorisé), avec reflet qui suit.
function tilt(el){ if(!el) return; el.classList.add('tilt'); const img=el.querySelector('.badge')||el; let raf=null;
  const set=(dx,dy)=>{ const rx=(-dy*14).toFixed(2), ry=(dx*18).toFixed(2); img.style.transform=`perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`; el.style.setProperty('--gx',(50+dx*40)+'%'); el.style.setProperty('--gy',(50+dy*40)+'%'); };
  const onMove=e=>{ const t=e.touches?e.touches[0]:e; const r=el.getBoundingClientRect(); const dx=Math.max(-1,Math.min(1,((t.clientX-r.left)/r.width-.5)*2)), dy=Math.max(-1,Math.min(1,((t.clientY-r.top)/r.height-.5)*2)); if(raf) cancelAnimationFrame(raf); raf=requestAnimationFrame(()=>set(dx,dy)); };
  const reset=()=>{ img.style.transition='transform .5s cubic-bezier(.2,.8,.2,1)'; set(0,0); setTimeout(()=>img.style.transition='',500); };
  el.addEventListener('pointermove',onMove); el.addEventListener('touchmove',onMove,{passive:true}); el.addEventListener('pointerleave',reset); el.addEventListener('touchend',reset);
  if(window.DeviceOrientationEvent&&typeof DeviceOrientationEvent.requestPermission!=='function'){ const h=e=>{ if(!el.isConnected){ removeEventListener('deviceorientation',h); return; } if(e.gamma==null) return; set(Math.max(-1,Math.min(1,e.gamma/25)),Math.max(-1,Math.min(1,(e.beta-40)/25))); }; addEventListener('deviceorientation',h); }
}
// Carte de partage : image générée (médaille, nom, date, marque) → partage natif, sinon téléchargement.
async function shareBadge(b){ try{ const c=document.createElement('canvas'); c.width=1080; c.height=1350; const x=c.getContext('2d'); x.fillStyle='#0F1216'; x.fillRect(0,0,1080,1350); const g=x.createRadialGradient(540,520,80,540,520,700); const [c1]=BADGE_FAM[b.fam]||BADGE_FAM.ses; g.addColorStop(0,c1+'66'); g.addColorStop(1,'#0F1216'); x.fillStyle=g; x.fillRect(0,0,1080,1350);
  const im=new Image(); im.src=BADGE_BASE+b.id+'.webp'; await new Promise((r,j)=>{ im.onload=r; im.onerror=j; }); x.drawImage(im,240,220,600,600);
  x.fillStyle='#fff'; x.textAlign='center'; x.font='900 76px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'; x.fillText(b.name,540,940); x.font='500 40px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'; x.fillStyle='rgba(255,255,255,.75)'; x.fillText(b.how,540,1010); const d=S.badgeDates&&S.badgeDates[b.id]?new Date(S.badgeDates[b.id]+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):''; x.fillText(d,540,1070); x.font='800 34px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'; x.fillStyle='rgba(255,255,255,.5)'; x.fillText('RITUEL',540,1250);
  const blob=await new Promise(r=>c.toBlob(r,'image/png')); const file=new File([blob],'rituel-'+b.id+'.png',{type:'image/png'});
  if(navigator.canShare&&navigator.canShare({files:[file]})) await navigator.share({files:[file],title:b.name,text:`${b.name} · ${b.how} · Rituel`});
  else { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.name; a.click(); } }catch(e){ if(!/abort/i.test(String(e))) toast('Partage impossible ici'); } }
// Meilleur e1RM d'un exercice avant une date (pour détecter un record en direct).
function bestBefore(exId,date){ let best=0; Object.values(S.logs).forEach(l=>{ if(l.date>=date) return; (l.sets&&l.sets[exId]||[]).forEach(st=>{ if(st&&st.done&&st.w&&st.r){ const v=e1rm(st.w,st.r); if(v>best) best=v; } }); }); return best; }
// Série de jours : chaque jour planifié honoré (séance terminée) prolonge la série ; les jours de repos du programme comptent ; un joker par semaine couvre un jour manqué.
function dayStreak(){
  const today=todayISO(); const planned=new Set(PROGRAM.sessions.map(s=>s.day)); const doneDays=new Set(Object.values(S.logs).filter(l=>l.done).map(l=>l.date));
  if(!doneDays.size) return {days:0,today:planned.has(new Date().getDay())?(doneDays.has(today)?'done':'due'):'rest',jokers:0,atRisk:false};
  let d=today, days=0, jokers=0, jokerWeek=null; const todayDone=doneDays.has(today); const todayDue=planned.has(new Date().getDay())&&!todayDone;
  if(todayDue) d=addDays(today,-1); // aujourd'hui est encore ouvert
  for(let i=0;i<400;i++){ const dow=new Date(d+'T12:00:00').getDay(); const isPlanned=planned.has(dow);
    if(doneDays.has(d)||!isPlanned){ days++; }
    else { const wk=weekKeyOf(d); if(jokerWeek!==wk&&jokers<9){ jokerWeek=wk; jokers++; days++; } else break; }
    d=addDays(d,-1); }
  // on ne compte pas les jours de repos avant la toute première séance
  const first=[...doneDays].sort()[0]; const span=Math.round((new Date(today+'T12:00:00')-new Date(first+'T12:00:00'))/86400000)+1; days=Math.min(days,span);
  return {days,today:todayDone?'done':todayDue?'due':'rest',jokers,atRisk:todayDue&&new Date().getHours()>=17};
}
// Défis de la semaine : trois objectifs courts calculés sur la semaine calendaire, +20 XP chacun quand ils sont tenus.
function weekKeyOf(iso){ const dow=(new Date(iso+'T12:00:00').getDay()+6)%7; return addDays(iso,-dow); }
function weeklyChallenges(iso){
  const monday=weekKeyOf(iso||todayISO()), sunday=addDays(monday,6); const logs=Object.values(S.logs).filter(l=>l.date>=monday&&l.date<=sunday);
  const planned=Math.max(2,Math.min(PROGRAM.sessions.length||3,5)); const done=logs.filter(l=>l.done).length;
  const bestBefore={}; Object.values(S.logs).filter(l=>l.date<monday).forEach(l=>Object.entries(l.sets||{}).forEach(([ex,arr])=>(arr||[]).forEach(st=>{ if(st&&st.done&&st.w&&st.r){ const v=e1rm(st.w,st.r); if(!bestBefore[ex]||v>bestBefore[ex]) bestBefore[ex]=v; } })));
  let prs=0; logs.forEach(l=>Object.entries(l.sets||{}).forEach(([ex,arr])=>{ let day=0; (arr||[]).forEach(st=>{ if(st&&st.done&&st.w&&st.r){ const v=e1rm(st.w,st.r); if(v>day) day=v; } }); if(day&&bestBefore[ex]&&day>bestBefore[ex]+0.01){ prs++; bestBefore[ex]=day; } }));
  const sets=logs.reduce((t,l)=>t+Object.values(l.sets||{}).flat().filter(x=>x&&x.done).length,0);
  const bw=Object.values(S.bw||{}).filter(b=>b.date>=monday&&b.date<=sunday).length; const tests=Object.values(S.tests||{}).filter(t=>t.date>=monday&&t.date<=sunday).length;
  const wk=Math.round((new Date(monday+'T12:00:00')-new Date('2026-01-05T12:00:00'))/604800000);
  const rot=[{id:'bw',name:'Deux pesées',how:'noter ton poids deux fois',cur:bw,goal:2},{id:'test',name:'Un test',how:'noter un test de référence',cur:tests,goal:1},{id:'sets',name:`${planned*20} séries`,how:'séries validées dans la semaine',cur:sets,goal:planned*20}][Math.abs(wk)%3];
  const list=[{id:'ses',name:`${planned} séances`,how:'séances terminées cette semaine',cur:done,goal:planned},{id:'pr',name:'Un record',how:'battre un de tes meilleurs e1RM',cur:prs,goal:1},rot];
  list.forEach(c=>{ c.ok=c.cur>=c.goal; c.pct=Math.min(100,Math.round(100*c.cur/c.goal)); });
  return {monday,sunday,list};
}
function challengeXp(){ let n=0; Object.values(S.challengesDone||{}).forEach(arr=>n+=(arr||[]).length); return n*20; }
function syncChallenges(){ const w=weeklyChallenges(); S.challengesDone=S.challengesDone||{}; const prev=S.challengesDone[w.monday]||[]; const now=w.list.filter(c=>c.ok).map(c=>c.id); const fresh=now.filter(id=>!prev.includes(id)); if(fresh.length){ S.challengesDone[w.monday]=Array.from(new Set(prev.concat(now))); save(); fresh.forEach(id=>{ const c=w.list.find(x=>x.id===id); toast(`Défi tenu : ${c.name} · +20 XP`,'ok'); }); native({type:'haptic',kind:'success'}); } }
// Classement entre amis : chacun publie une fiche minimale (prénom, code ami, XP de la semaine, rang) ; on suit ses amis par leur code.
function friendCode(uid){ let h=0; for(const ch of uid) h=(h*31+ch.charCodeAt(0))>>>0; const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<6;i++){ c+=A[h%A.length]; h=Math.floor(h/A.length)+i*7; } return c; }
function weekXp(){ const monday=weekKeyOf(todayISO()), sunday=addDays(monday,6); const logs=Object.values(S.logs).filter(l=>l.done&&l.date>=monday&&l.date<=sunday); let xp=logs.length*10; let prs=0; logs.forEach(l=>Object.values(l.sets||{}).forEach(arr=>{ if((arr||[]).some(x=>x&&x.pr)) prs++; })); xp+=prs*15; xp+=Object.values(S.tests||{}).filter(t=>t.date>=monday&&t.date<=sunday).length*5; xp+=((S.challengesDone||{})[monday]||[]).length*20; return xp; }
let PUB_LAST='';
// Fiche publique (prénom, code ami, XP) : uniquement si l'utilisateur a activé le partage entre amis. Rien n'est publié par défaut.
function socialOn(){ return !!(PROFILE&&(PROFILE.social===true||(PROFILE.friends||[]).length)); }
function publishPublic(){ if(!USER||!fbDb||!socialOn()) return; const f=progressFacts(); const doc={name:(PROFILE&&PROFILE.name)||(USER.displayName||'').split(' ')[0]||'Athlète',code:friendCode(USER.uid),weekXp:weekXp(),weekKey:weekKeyOf(todayISO()),stage:f.stage,xp:f.xp,updatedAt:Date.now()}; const sig=JSON.stringify([doc.name,doc.weekXp,doc.weekKey,doc.stage,doc.xp]); if(sig===PUB_LAST) return; PUB_LAST=sig; try{ const r=fbDb.collection('public').doc(USER.uid); if(r&&typeof r.set==='function') r.set(doc).catch(e=>logErr('public',e)); }catch(e){} }
async function addFriendByCode(code){ code=String(code||'').trim().toUpperCase(); if(code.length!==6) throw new Error('Code à 6 caractères'); if(code===friendCode(USER.uid)) throw new Error('C\'est ton propre code'); const q=await fbDb.collection('public').where('code','==',code).limit(1).get(); if(q.empty) throw new Error('Aucun athlète avec ce code (il doit avoir activé le partage entre amis)'); const uid=q.docs[0].id; const friends=(PROFILE&&PROFILE.friends)||[]; if(friends.includes(uid)) return q.docs[0].data(); const nf=friends.concat(uid); PROFILE.friends=nf; await col('meta').doc('profile').set({friends:nf},{merge:true}); return q.docs[0].data(); }
async function loadFriends(){ const ids=((PROFILE&&PROFILE.friends)||[]).slice(0,30); const out=[]; for(const uid of ids){ try{ const d=await fbDb.collection('public').doc(uid).get(); if(d.exists) out.push(Object.assign({uid},d.data())); }catch(e){} } return out; }
async function renderFriends(el){
  const f=progressFacts(); const me={uid:USER?USER.uid:'me',name:(PROFILE&&PROFILE.name)||'Toi',weekXp:weekXp(),stage:f.stage,xp:f.xp,me:true}; const wk=weekKeyOf(todayISO());
  el.innerHTML=`<p class="tsub center">Chargement…</p>`; let friends=[]; try{ friends=await loadFriends(); }catch(e){}
  const rows=[me].concat(friends.map(x=>Object.assign({},x,{weekXp:x.weekKey===wk?(x.weekXp||0):0}))).sort((a,b)=>b.weekXp-a.weekXp);
  const myPos=rows.findIndex(r=>r.me)+1;
  if(!socialOn()){ el.innerHTML=`<div class="frhead"><p class="eyebrow">Entre amis</p><h2>Classement hebdomadaire</h2><p class="tsub">Pour te comparer à des amis, tu partages ton prénom, ton code ami et tes XP avec les comptes connectés. Rien n'est partagé tant que tu n'actives pas.</p></div><button class="btn fill" id="socialOn">Activer le partage entre amis</button><p class="small muted center">Désactivable à tout moment ici. Tes séances, ton programme et tes charges ne sont jamais partagés.</p>`; $('#socialOn',el).onclick=async()=>{ PROFILE.social=true; await col('meta').doc('profile').set({social:true},{merge:true}); PUB_LAST=''; publishPublic(); renderFriends(el); }; return; }
  el.innerHTML=`<div class="frhead"><p class="eyebrow">Cette semaine</p><h2>${friends.length?`${myPos}${myPos===1?'er':'e'} sur ${rows.length}`:'Ton classement'}</h2><p class="tsub">${friends.length?'XP gagnée depuis lundi, entre amis.':'Ajoute des amis avec leur code pour vous comparer chaque semaine.'}</p></div>
    <div class="ladder">${rows.map((r,i)=>`<div class="lrow ${r.me?'now':''}"><span class="pos">${i+1}</span><div><b>${esc(r.name||'Athlète')}${r.me?' (toi)':''}</b><small>${RANKS[(r.stage||1)-1]?RANKS[(r.stage||1)-1].name:''} · ${r.xp||0} XP au total</small></div><span><b>${r.weekXp||0}</b> XP</span></div>`).join('')}</div>
    <div class="fcode"><p class="eyebrow">Ton code ami</p><b>${USER?friendCode(USER.uid):'------'}</b><div class="row2"><button class="btn sm" id="fShare">Partager mon code</button></div></div>
    <form class="qf fadd" id="fAdd"><input placeholder="Code d'un ami" maxlength="6" autocapitalize="characters" aria-label="Code ami"><button class="btn sm fill" type="submit">Ajouter</button></form>
    ${friends.length?`<p class="small muted">Pour retirer un ami, appuie longuement sur sa ligne.</p>`:''}<p class="small muted center"><button class="link" id="socialOff">Ne plus partager mon score</button></p>`;
  const so=$('#socialOff',el); if(so) so.onclick=async()=>{ PROFILE.social=false; PROFILE.friends=[]; await col('meta').doc('profile').set({social:false,friends:[]},{merge:true}); try{ await fbDb.collection('public').doc(USER.uid).delete(); }catch(e){} renderFriends(el); };
  const sh=el.querySelector('#fShare'); if(sh) sh.onclick=async()=>{ const code=friendCode(USER.uid); const text=`Rejoins-moi sur Rituel et ajoute mon code ami : ${code}`; try{ if(navigator.share) await navigator.share({text}); else { await navigator.clipboard.writeText(code); toast('Code copié','ok'); } }catch(e){} };
  const fa=el.querySelector('#fAdd'); if(fa) fa.onsubmit=async e=>{ e.preventDefault(); const inp=fa.querySelector('input'); try{ const d=await addFriendByCode(inp.value); toast(`${d.name} ajouté`,'ok'); renderFriends(el); }catch(err){ toast(err.message||'Ajout impossible'); } };
  el.querySelectorAll('.lrow:not(.now)').forEach((row,i)=>{ let t=null; const uid=rows.filter(r=>!r.me)[0]?null:null; row.addEventListener('touchstart',()=>{ t=setTimeout(()=>{ const r=rows[Array.from(el.querySelectorAll('.lrow')).indexOf(row)]; if(r&&!r.me&&confirm(`Retirer ${r.name} de tes amis ?`)){ PROFILE.friends=(PROFILE.friends||[]).filter(x=>x!==r.uid); col('meta').doc('profile').set({friends:PROFILE.friends},{merge:true}); renderFriends(el); } },700); },{passive:true}); row.addEventListener('touchend',()=>clearTimeout(t)); row.addEventListener('touchmove',()=>clearTimeout(t)); });
}
// Trophées : écran plein avec deux volets, Rang (échelle des 5 rangs, XP) et Médailles (collection) ; détail d'une médaille en écran dédié.
const FAM_NAME={ses:'Séances',pr:'Records',pull:'Progression',reg:'Régularité',cyc:'Cycle'};
const FAM_DESC={ses:'Chaque séance terminée compte. La médaille est un disque de musculation.',pr:'Un record, c\'est une charge ou un nombre de répétitions jamais atteint sur un exercice. La médaille est une kettlebell.',pull:'Ta progression sur ton test de référence (choisi dans ton profil : tractions, pompes, dips, squats, burpees ou gainage ; noté depuis l\'accueil), mesurée par rapport à ton premier test : elle vaut pour tout le monde, quel que soit le niveau de départ. La médaille est une tête d\'haltère suspendue à la barre.',reg:'Une semaine complète, c\'est toutes les séances du programme faites dans la semaine. La médaille est un chronomètre.',cyc:'Les mésocycles bouclés et les gros volumes. La médaille est un écusson.'};
let TROPHY_VIEW='rang';
function showBadges(view){ if(view) TROPHY_VIEW=view; showTrophies(); }
function showTrophies(){
  const f=progressFacts(); let el=document.querySelector('.trophies'); const fresh=!el;
  if(fresh){ el=document.createElement('div'); el.className='trophies'; document.body.appendChild(el); document.body.classList.add('unlocking'); requestAnimationFrame(()=>el.classList.add('on')); }
  const dateOf=b=>S.badgeDates&&S.badgeDates[b.id]?new Date(S.badgeDates[b.id]+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):'';
  let body='';
  if(TROPHY_VIEW==='amis'){ body='<div id="friendsBox"></div>'; }
  else if(TROPHY_VIEW==='rang'){
    body=`<div class="thero"><div class="tilt" id="tRank">${rankSvg(f.stage,180)}</div><p class="eyebrow">Rang ${f.stage} sur ${RANKS.length}</p><h2>${esc(f.stageName)}</h2><div class="xpbar"><i style="width:${f.pct}%"></i></div><p class="tsub">${f.xp} XP${f.next?` · encore ${f.next.xp-f.xp} XP pour devenir « ${esc(f.next.name)} »`:' · rang maximal'}</p></div>
      <h4>L'échelle des rangs</h4><div class="ladder">${RANKS.map((r,i)=>{ const st=i+1; const cls=st===f.stage?'now':st<f.stage?'done':'todo'; return `<div class="lrow ${cls}">${rankSvg(st,48)}<div><b>${esc(r.name)}</b><small>${st<f.stage?'acquis':st===f.stage?'ton rang actuel':`à ${r.xp} XP · il te manque ${r.xp-f.xp}`}</small></div><span>${r.xp} XP</span></div>`; }).join('')}</div>
      <h4>Comment gagner de l'XP</h4><div class="xprules"><div><b>+10</b><span>séance terminée</span></div><div><b>+15</b><span>record personnel</span></div><div><b>+5</b><span>test de référence</span></div><div><b>+25</b><span>semaine complète</span></div><div><b>+20</b><span>défi de la semaine</span></div></div>
      <p class="small muted">Ton compte : ${f.sessions} séance${f.sessions>1?'s':''}, ${f.prs} record${f.prs>1?'s':''}, ${f.tests} test${f.tests>1?'s':''}, ${f.fullWeeks} semaine${f.fullWeeks>1?'s':''} complète${f.fullWeeks>1?'s':''}.</p>`;
  } else {
    body=`<p class="tsub center">${f.unlocked.length} médaille${f.unlocked.length>1?'s':''} sur ${BADGES.length}. Touche une médaille pour la voir en grand.</p>`+['ses','pr','pull','reg','cyc'].map(fam=>`<h4>${FAM_NAME[fam]}</h4><p class="small muted famd">${FAM_DESC[fam]}</p><div class="bgrid">${BADGES.filter(b=>b.fam===fam).map((b,i)=>{ const ok=f.unlocked.includes(b.id); const pr=b.prog?b.prog(f):null; return `<button class="bcell ${ok?'':'lock'}" data-badge="${b.id}" style="animation-delay:${i*60}ms">${badgeSvg(b,84,!ok,f)}<b>${esc(b.name)}</b><small>${ok?esc(dateOf(b)):(pr?`${String(pr[0]).replace('.',',')} / ${pr[1]}`:esc(b.how))}</small></button>`; }).join('')}</div>`).join('');
  }
  el.innerHTML=`<div class="tbar"><button class="tclose" id="tClose" aria-label="Fermer">✕</button><div class="seg"><button data-tv="rang" aria-selected="${TROPHY_VIEW==='rang'}">Rang</button><button data-tv="medailles" aria-selected="${TROPHY_VIEW==='medailles'}">Médailles</button><button data-tv="amis" aria-selected="${TROPHY_VIEW==='amis'}">Amis</button></div><span></span></div><div class="tbody">${body}</div>`;
  el.querySelector('#tClose').onclick=()=>{ el.classList.remove('on'); setTimeout(()=>{ el.remove(); document.body.classList.remove('unlocking'); },250); };
  el.querySelectorAll('[data-tv]').forEach(b=>b.onclick=()=>{ TROPHY_VIEW=b.dataset.tv; showTrophies(); el.querySelector('.tbody').scrollTop=0; });
  el.querySelectorAll('[data-badge]').forEach(b=>b.onclick=()=>showBadgeDetail(BADGES.find(x=>x.id===b.dataset.badge)));
  const tr=el.querySelector('#tRank'); if(tr) tilt(tr); const fb=el.querySelector('#friendsBox'); if(fb) renderFriends(fb);
  if(!UNLOCK_BUSY&&f.unlocked.some(id=>!(S.badgesSeen||[]).includes(id))){ S.badgesSeen=f.unlocked.slice(); save(); renderHome(); }
}
function showBadgeDetail(b){
  const f=progressFacts(); const ok=f.unlocked.includes(b.id); const pr=b.prog?b.prog(f):null; const pct=pr?Math.min(100,Math.round(100*pr[0]/pr[1])):0;
  const d=S.badgeDates&&S.badgeDates[b.id]?new Date(S.badgeDates[b.id]+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}):'';
  const el=document.createElement('div'); el.className='bdetail'; el.innerHTML=`<button class="tclose" id="bdClose" aria-label="Fermer">✕</button><div class="bdwrap"><p class="eyebrow">${FAM_NAME[b.fam]} · ${b.tier>=5?'or':b.tier>=3?'argent':'bronze'}</p><div class="bdbadge tilt" id="bdBadge">${badgeSvg(b,250,!ok,f)}</div><h2>${esc(b.name)}</h2><p class="bdhow">${esc(b.how)}</p>
    ${ok?`<p class="bdok">Obtenue le ${esc(d)}</p>`:pr?`<div class="xpbar"><i style="width:${pct}%"></i></div><p class="bdprog">${String(pr[0]).replace('.',',')} / ${pr[1]} · ${pr[1]-pr[0]>0?`encore ${String(Math.round((pr[1]-pr[0])*10)/10).replace('.',',')}`:'à portée'}</p>`:`<p class="bdprog">Pas encore obtenue</p>`}
    <p class="small muted">${esc(FAM_DESC[b.fam])}</p>
    <div class="row2">${ok?`<button class="btn fill" id="bdShare">Partager</button>`:''}<button class="btn" id="bdBack">Retour</button></div></div>`;
  document.body.appendChild(el); requestAnimationFrame(()=>el.classList.add('on')); native({type:'haptic'});
  const close=()=>{ el.classList.remove('on'); setTimeout(()=>el.remove(),220); };
  el.querySelector('#bdClose').onclick=close; el.querySelector('#bdBack').onclick=close; const sh=el.querySelector('#bdShare'); if(sh) sh.onclick=()=>shareBadge(b);
  tilt(el.querySelector('#bdBadge'));
}

/* ---------- Aujourd'hui ---------- */
// Point hebdomadaire : sommeil, fatigue, courbatures, motivation (1 à 5) + poids. Un score de forme module la semaine entière.
function weekMod(wk){ const W=WEEKS[wk-1]; if(!W||!W.from) return null; const c=(S.checkins||{})[W.from]; return c&&c.mod?c.mod:null; }
function checkinFor(weekKey){ return (S.checkins||{})[weekKey]||null; }
function checkinDue(){ const wkKey=weekKeyOf(todayISO()); if(!PROGRAM.sessions.length) return false; if(checkinFor(wkKey)) return false; const first=WEEKS[0]&&WEEKS[0].from; if(first&&wkKey<first) return false; return true; }
function readinessOf(c){ return Math.round(((c.sleep||3)+(6-(c.fatigue||3))+(6-(c.soreness||3))+(c.motivation||3))/4*10)/10; }
function modFor(r,c){ if(r<2.6||(c.sleep<=2&&c.fatigue>=4)) return {sets:0.8,rir:1,label:'semaine allégée',why:'forme basse au point du lundi : −20 % de séries, RIR +1, on protège la progression'}; if(r<3.2) return {sets:0.9,rir:0,label:'semaine prudente',why:'forme moyenne : −10 % de séries, charges inchangées'}; return {sets:1,rir:0,label:'semaine normale',why:r>=4.2?'forme haute : on garde le plan, pousse les charges quand le haut de fourchette est atteint':'forme correcte : plan normal'}; }
function checkinHtml(){
  if(!checkinDue()) return '';
  const q=[['sleep','Sommeil cette semaine','Mauvais','Excellent'],['fatigue','Fatigue générale','Aucune','Épuisé'],['soreness','Courbatures, raideurs','Aucune','Partout'],['motivation','Envie de t\'entraîner','Zéro','À fond']];
  return `<div class="card checkin" id="checkin"><div class="eyebrow">Point du lundi · 30 secondes</div><p class="small muted">Comme un coach qui te regarde arriver : ce que tu réponds règle la semaine entière.</p>${q.map(([k,l,a,b])=>`<div class="ckq"><b>${l}</b><div class="ckscale" data-k="${k}">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" aria-pressed="${v===3}">${v}</button>`).join('')}</div><span class="small muted">${a} → ${b}</span></div>`).join('')}<div class="ckq"><b>Poids ce matin (kg, facultatif)</b><input type="number" step="0.1" min="30" max="250" id="ckBw" inputmode="decimal"></div><button class="btn fill sm" id="ckSave">Valider le point</button></div>`;
}
function bindCheckin(){
  const el=$('#checkin'); if(!el) return;
  el.querySelectorAll('.ckscale button').forEach(b=>b.onclick=()=>{ b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b)); });
  $('#ckSave').onclick=()=>{ const c={weekKey:weekKeyOf(todayISO()),date:todayISO(),updatedAt:Date.now()}; el.querySelectorAll('.ckscale').forEach(sc=>{ const on=sc.querySelector('[aria-pressed="true"]'); c[sc.dataset.k]=on?Number(on.dataset.v):3; }); const bw=parseFloat($('#ckBw').value); if(bw>30){ S.bw[c.date]={date:c.date,kg:bw,updatedAt:Date.now()}; writeDoc('bw',c.date,S.bw[c.date]); c.bw=bw; } c.readiness=readinessOf(c); c.mod=modFor(c.readiness,c); S.checkins=S.checkins||{}; S.checkins[c.weekKey]=c; save(); writeDoc('checkins',c.weekKey,c); toast(c.mod.label.charAt(0).toUpperCase()+c.mod.label.slice(1)+' : '+c.mod.why,'ok',6000); render(); };
}
function renderHome(){
  const el=$('#tab-home'); if(!el||!PROGRAM.sessions.length) return;
  const date=todayISO(), wk=curWeek(), W=WEEKS[wk-1]; const ses=curSession(); const log=S.logs[logKey(date,ses.id)];
  const subDoc=((S.overrides||{})[ses.id]||{}).substitute; const sub=subDoc&&subDoc.date===date?subDoc:null;
  const exs=sub?sub.exercises:ses.exercises; const nSets=log?Object.values(log.sets||{}).flat().filter(x=>x&&x.done).length:0; const started=nSets>0&&!(log&&log.done); const done=!!(log&&log.done);
  const nDone=exs.filter(ex=>{ const p=rx(ex,wk); const d=(log&&log.sets[ex.id]||[]).filter(x=>x&&x.done).length; const f=(log&&log.flags||{})[ex.id]||{}; return d>=p.sets||f.skip; }).length;
  const hour=new Date().getHours(); const hello=hour<5?'Bonne nuit':hour<12?'Bonjour':hour<18?'Bon après-midi':'Bonsoir';
  const name=(PROFILE&&PROFILE.name)||(USER&&USER.displayName&&USER.displayName.split(' ')[0])||'';
  const dayLabel=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const isRest=!PROGRAM.sessions.find(x=>x.day===new Date().getDay());
  const over=cycleOver(); const af=progressFacts(); const newB=af.unlocked.filter(id=>!(S.badgesSeen||[]).includes(id)); const SK=dayStreak();
  let h=`<div class="hello"><div><p class="eyebrow">${esc(dayLabel)}</p><h2>${esc(hello)}${name?' '+esc(name):''}</h2><p class="streak ${SK.today==='due'?'due':''} ${SK.days?'':'zero'}"><i>🔥</i>${SK.days?`${SK.days} jour${SK.days>1?'s':''} d'affilée${SK.today==='due'?' · séance du jour à faire':''}`:'Commence ta série aujourd\'hui'}</p></div><button class="avbtn ${newB.length?'new':''}" id="homeAvatar" aria-label="Mes badges">${rankSvg(af.stage,44)}</button></div>`;
  if(over) h+=`<div class="card cycend"><div class="card-h"><b>Cycle terminé</b><span class="muted">${fmtD(WEEKS[WEEKS.length-1].to)}</span></div><p>Les ${WEEKS.length} semaines de « ${esc(String(PROGRAM.cycleName||'').split(' · ')[0])} » sont faites. Kai construit le suivant à partir de ton journal.</p><div class="row2"><button class="btn fill sm" id="homeNewCycle">Nouveau cycle avec Kai</button></div></div>`;
  if(!over) h+=checkinHtml();
  { const wm=weekMod(wk); if(wm&&wm.sets!==1) h+=`<div class="banner info">${esc(wm.label.charAt(0).toUpperCase()+wm.label.slice(1))} : ${esc(wm.why)}.</div>`; }
  // carte séance du jour
  h+=`<div class="today ${done?'done':''}"><div class="t-top"><span class="eyebrow">${isRest&&!started&&!done?'Pas de séance prévue':'Séance du jour'} · S${wk} ${esc(String(W.label||'').replace(/^S\d+\s*/,''))}</span>${sub?'<span class="tag">sans salle</span>':''}</div>
    <div class="t-name">${esc(sub?sub.name:ses.name)}</div><div class="t-meta">${esc(ses.sub)} · ${exs.length} exercices · ${esc(ses.duration||'')}</div>
    ${started||done?`<div class="prog"><div class="bar"><i style="width:${Math.round(100*nDone/Math.max(1,exs.length))}%"></i></div><span>${nDone}/${exs.length} exercices · ${nSets} séries</span></div>`:''}
    <div class="t-actions">${done?`<button class="btn" id="homeOpen">Revoir la séance</button>`:`<button class="btn fill" id="homeStart">${started?'Reprendre':'Démarrer'}</button><button class="btn" id="homeOpen">Voir le plan</button>`}</div>
    ${!started&&!done?`<button class="link t-nogym" id="homeNogym">Pas de salle aujourd'hui ?</button>`:''}</div>`;
  // semaine : pastilles (semaine calendaire courante, lundi → dimanche)
  const dow=(new Date(date+'T12:00:00').getDay()+6)%7; const a=addDays(date,-dow);
  const dn=['L','M','M','J','V','S','D']; let dots='';
  for(let i=0;i<7;i++){ const d=addDays(a,i); const dayIdx=(i+1)%7; const planned=PROGRAM.sessions.find(x=>x.day===dayIdx); const did=Object.values(S.logs).some(l=>l.done&&l.date===d); const cls=did?'ok':d<date?(planned?'miss':'rest'):d===date?'now':(planned?'plan':'rest'); dots+=`<button class="dot ${cls}" data-day="${planned?planned.id:''}" data-date="${d}"><i></i><span>${dn[i]}</span></button>`; }
  const weekDone=Object.values(S.logs).filter(l=>l.done&&l.date>=a&&l.date<=addDays(a,6)).length;
  h+=`<div class="card wk"><div class="card-h"><b>Cette semaine</b><span class="muted">${weekDone}/${PROGRAM.sessions.length} séances · ${fmtD(a)} au ${fmtD(addDays(a,6))}</span></div><div class="dots">${dots}</div></div>`;
  // défis de la semaine
  const CH=weeklyChallenges(date); const chDone=CH.list.filter(c=>c.ok).length;
  h+=`<div class="card chal"><div class="card-h"><b>Défis de la semaine</b><span class="muted">${chDone}/3 · +20 XP chacun</span></div>${CH.list.map(c=>`<div class="crow ${c.ok?'ok':''}"><i></i><div><b>${esc(c.name)}</b><small>${esc(c.how)}</small></div><span>${c.ok?'tenu':`${c.cur}/${c.goal}`}</span><div class="cbar"><em style="width:${c.pct}%"></em></div></div>`).join('')}</div>`;
  // avatar + progression
  const recent=BADGES.filter(b=>af.unlocked.includes(b.id)).slice(-4);
  h+=`<button class="card avcard" id="homeAvatar2"><div class="card-h"><b>${rankSvg(af.stage,22)} Rang ${af.stage} · ${esc(af.stageName)}${newB.length?` <em class="pstar">${newB.length} nouveau${newB.length>1?'x':''}</em>`:''}</b><span class="muted">${af.unlocked.length}/${BADGES.length} médailles · ${weekXp()} XP cette semaine</span></div><div class="xpbar"><i style="width:${af.pct}%"></i></div><div class="brow">${recent.map(b=>badgeSvg(b,40,false)).join('')}${af.nextBadge?badgeSvg(af.nextBadge,40,true,af):''}<span class="small muted">${af.nextBadge?`Prochain : ${esc(af.nextBadge.name.toLowerCase())} · ${esc(af.nextBadge.how)}`:'Tous les badges obtenus'}</span></div></button>`;
  // chiffres : mois, tonnage semaine, série
  const month=date.slice(0,7); const nMonth=Object.values(S.logs).filter(l=>l.done&&l.date.startsWith(month)).length;
  let ton=0; Object.values(S.logs).filter(l=>l.date>=a&&l.date<=addDays(a,6)).forEach(l=>Object.values(l.sets||{}).flat().forEach(x=>{ if(x&&x.done) ton+=(x.w||0)*(x.r||0); }));
  let streak=0; try{ const ws=suiviStats().weeks.filter(w=>!w.future); for(let i=ws.length-1;i>=0;i--){ if(ws[i].done>0) streak++; else if(i<ws.length-1) break; } }catch(e){}
  h+=`<div class="tiles3"><button class="tr" data-view="forme"><span class="l">Ce mois</span><b>${nMonth}</b><small>séance${nMonth>1?'s':''}</small></button><button class="tr" data-view="force"><span class="l">Tonnage</span><b>${ton>=1000?(ton/1000).toFixed(1).replace('.',',')+' t':ton+' kg'}</b><small>cette semaine</small></button><button class="tr" data-view="forme"><span class="l">Série</span><b>${streak}</b><small>semaine${streak>1?'s':''} d'affilée</small></button></div>`;
  // poids et tractions : saisie rapide
  const bws=Object.values(S.bw||{}).sort((x,y)=>x.date<y.date?-1:1); const lastBw=bws[bws.length-1]; const ago=bws.filter(x=>x.date<=addDays(date,-7)).pop(); const dBw=lastBw&&ago?Math.round((lastBw.kg-ago.kg)*10)/10:null;
  const tests=Object.values(S.tests||{}).sort((x,y)=>x.date<y.date?-1:1); const lastT=tests[tests.length-1]; const RT=refTest(); const goal=RT.goal;
  h+=`<div class="tiles2"><div class="card qk"><div class="card-h"><b>Poids</b>${dBw!=null?`<i class="${dBw<0?'down':dBw>0?'up':'flat'}">${dBw>0?'+':''}${String(dBw).replace('.',',')} kg / 7 j</i>`:''}</div><div class="qv"><b>${lastBw?String(lastBw.kg).replace('.',','):'—'}</b><span>kg${lastBw?' · '+fmtD(lastBw.date):''}</span></div><form class="qf" id="bwQuick"><input type="number" step="0.1" inputmode="decimal" placeholder="${lastBw?String(lastBw.kg):'69,0'}" aria-label="Poids du jour"><button class="btn sm fill" type="submit">OK</button></form></div>
    <div class="card qk"><div class="card-h"><b>${esc(RT.short)}</b>${goal?`<span class="muted">objectif ${goal}</span>`:''}</div><div class="qv"><b>${lastT?lastT.reps:'—'}</b><span>${lastT?'le '+fmtD(lastT.date):'pas encore testé'}</span></div>${goal&&lastT?`<div class="xpbar ok"><i style="width:${Math.min(100,Math.round(100*lastT.reps/goal))}%"></i></div>`:''}<form class="qf" id="tQuick"><input type="number" inputmode="numeric" placeholder="${RT.unit}" aria-label="${esc(RT.label)}"><button class="btn sm" type="submit">Noter</button></form></div></div>`;
  // dernier mot du coach
  const last=COACH.items[0];
  if(last){ const txt=last.type==='bilan'||last.type==='cycleEnd'?(last.nextWeek||last.analysis):last.type==='nudge'?last.analysis:(last.nextFocus||last.analysis); h+=`<div class="card coachcard" id="homeCoach" role="button" tabindex="0"><div class="card-h"><b>${coachAvatar(last.adjustments&&last.adjustments.length&&!last.applied?'attention':'idle','xs')} ${esc(COACH_NAME)}</b><span class="muted">${last.createdAt?new Date(last.createdAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):''}</span></div><p>${lexify(esc(String(txt||'').slice(0,180)))}${String(txt||'').length>180?'…':''}</p>${last.adjustments&&last.adjustments.length&&!last.applied?'<span class="tag">charges à appliquer</span>':''}</div>`; }
  else h+=`<div class="card"><div class="card-h"><b>${coachAvatar('idle','xs')} ${esc(COACH_NAME)}</b></div><p class="muted">Ton coach. Après ta première séance terminée, il l'analyse et fixe les charges suivantes.</p></div>`;
  // prochaine séance
  const nextS=[1,2,3,4,5,6,7].map(i=>{ const d=(new Date().getDay()+i)%7; return PROGRAM.sessions.find(x=>x.day===d); }).find(Boolean);
  if(nextS&&nextS.id!==ses.id) h+=`<p class="small muted center">Prochaine : ${esc(nextS.dayName)} · ${esc(nextS.name)}</p>`;
  if(isGenericProgram()) h=builtForHtml()+h;
  el.innerHTML=h; bindCheckin(); const hg=$('#genericBtn',el); if(hg) hg.onclick=()=>{ showTab('programme'); regenerateProgram(true); };
  const go=()=>{ S.session=ses.id; S.sessionDate=todayISO(); save(); showTab('seance'); };
  const st=$('#homeStart'); if(st) st.onclick=()=>{ S.session=ses.id; S.sessionDate=todayISO(); save(); showTab('seance'); enterFocus(); };
  const op=$('#homeOpen'); if(op) op.onclick=go;
  const ng=$('#homeNogym'); if(ng) ng.onclick=()=>{ go(); setTimeout(()=>{ const b=$('#subBtn'); if(b) b.click(); },50); };
  const hc=$('#homeCoach'); if(hc) hc.onclick=()=>showTab('coach');
  const nc=$('#homeNewCycle'); if(nc) nc.onclick=regenerateProgram;
  const ha=$('#homeAvatar'); if(ha) ha.onclick=()=>showBadges('rang'); const ha2=$('#homeAvatar2'); if(ha2) ha2.onclick=()=>showBadges('medailles');
  el.querySelectorAll('.tr[data-view]').forEach(b=>b.onclick=()=>{ SUIVI_VIEW=b.dataset.view; renderSuivi(); showTab('suivi'); });
  el.querySelectorAll('.dot[data-day]').forEach(b=>b.onclick=()=>{ if(!b.dataset.day) return; S.session=b.dataset.day; S.sessionDate=todayISO(); save(); showTab('seance'); });
  const bq=$('#bwQuick'); if(bq) bq.onsubmit=e=>{ e.preventDefault(); const kg=parseFloat(bq.querySelector('input').value.replace(',','.')); if(isNaN(kg)||kg<30||kg>250) return; S.bw[date]={date,kg,updatedAt:Date.now()}; save(); writeDoc('bw',date,S.bw[date]); toast('Pesée notée','ok'); renderHome(); renderSuivi(); };
  const tq=$('#tQuick'); if(tq) tq.onsubmit=e=>{ e.preventDefault(); const r=parseInt(tq.querySelector('input').value); if(isNaN(r)||r<0||r>200) return; S.tests[date]={date,reps:r,updatedAt:Date.now()}; save(); writeDoc('tests',date,S.tests[date]); toast('Test noté','ok'); renderHome(); renderSuivi(); setTimeout(checkUnlocks,400); };
}
/* ---------- mode séance plein écran ---------- */
let FOCUS=false;
function enterFocus(){ FOCUS=true; document.body.classList.add('focus'); renderSeance(); window.scrollTo({top:0}); requestWake(); }
function exitFocus(){ if(!FOCUS) return; FOCUS=false; document.body.classList.remove('focus'); renderSeance(); }


/* ---------- Démos visuelles des mouvements ---------- */
// Photos servies par l'app elle-même (style uniforme, 480 px, WebP) : mises en cache par le service worker, préchargées pour le programme → disponibles hors ligne.
const DEMO={base:window.__DEMO_BASE||'demo/img/',index:null,loading:null,asked:false,prefetched:new Set()};
// Choix de l'utilisateur d'abord (meta/program.demosUser), puis association du coach, puis repli par mots-clés.
// Choix de l'utilisateur d'abord, puis association faite par le coach (même geste, même matériel, sinon rien). Jamais de devinette par mots-clés : une image fausse est pire que pas d'image.
function demoId(ex){ if(!ex) return null; const u=(PROGRAM.demosUser||{})[ex.id]; if(u) return u==='none'?null:u; if(ex.demo) return ex.demo; const m=(PROGRAM.demos||{})[ex.id]; if(m) return m; const g=patternDemo(ex); return g||null; }
// Repli universel : l'illustration du schéma de mouvement (squat, charnière, tirage…), toujours étiquetée « geste proche » dans l'app, jamais présentée comme la machine exacte.
const PATTERN_DEMO={squat:'Barbell_Full_Squat',hinge:'Romanian_Deadlift',lunge:'Dumbbell_Lunges',kneeflex:'Seated_Leg_Curl',kneeext:'Leg_Extensions',calf:'Standing_Calf_Raises',hpush:'Barbell_Bench_Press_-_Medium_Grip',vpush:'Dumbbell_Shoulder_Press',hpull:'Seated_Cable_Rows',vpull:'Pullups',latdelt:'Seated_Side_Lateral_Raise',reardelt:'Seated_Bent-Over_Rear_Delt_Raise',biceps:'Dumbbell_Bicep_Curl',triceps:'Triceps_Pushdown_-_Rope_Attachment',core:'Plank',carry:'Farmers_Walk',cond:'One-Arm_Kettlebell_Swings'};
const PATTERN_GUESS=[[/traction|pull[- ]?up|chin|tirage.*(vertical|haut)|lat ?pull/i,'vpull'],[/rowing|row\b|tirage|face ?pull/i,'hpull'],[/d[ée]velopp[ée].*(militaire|[ée]paule|overhead)|shoulder|press.*[ée]paule/i,'vpush'],[/d[ée]velopp[ée]|bench|pompes?|push[- ]?up|dips?\b|presse.*(pec|inclin|convergent)|[ée]cart[ée]|fly|crossover/i,'hpush'],[/hack|pendulum|squat|presse|leg press|belt/i,'squat'],[/soulev[ée]|deadlift|rdl|roumain|good ?morning|hip thrust|reverse hyper|hyperext|nordic/i,'hinge'],[/fente|lunge|split|step[- ]?up/i,'lunge'],[/leg curl|ischio/i,'kneeflex'],[/leg ext|extension.*(jambe|quad)/i,'kneeext'],[/mollet|calf|tibial/i,'calf'],[/[ée]l[ée]vation.*lat|lateral raise/i,'latdelt'],[/oiseau|rear delt|reverse fly|rotation ext/i,'reardelt'],[/curl.*(poignet|avant)|avant[- ]bras|wrist|grip/i,'carry'],[/curl/i,'biceps'],[/triceps|pushdown|skull|kick ?back|french/i,'triceps'],[/gainage|planche|plank|crunch|abdo|relev[ée]|hollow/i,'core'],[/farmer|port[ée]/i,'carry'],[/swing|rameur|v[ée]lo|circuit|finisher|cardio|saut|jump|burpee/i,'cond']];
function patternOf(ex){ if(ex.pattern) return ex.pattern; const t=(ex.name||'')+' '+(ex.machine||''); const g=PATTERN_GUESS.find(([re])=>re.test(t)); return g?g[1]:null; }
function patternDemo(ex){ const pt=patternOf(ex); return pt&&PATTERN_DEMO[pt]||null; }
function demoExact(ex){ if(!ex) return false; const u=(PROGRAM.demosUser||{})[ex.id]; if(u&&u!=='none') return true; if(ex.demo) return true; return !!(PROGRAM.demos||{})[ex.id]; }
// Illustrations dessinées (style BD, personnage unique) pour les mouvements du programme ; photos du catalogue en repli.
const ILLUS=new Set(["Band_Assisted_Pull-Up", "Barbell_Bench_Press_-_Medium_Grip", "Barbell_Deadlift", "Barbell_Full_Squat", "Barbell_Hip_Thrust", "Barbell_Incline_Bench_Press_-_Medium_Grip", "Barbell_Lunge", "Bent_Over_Barbell_Row", "Calf_Press_On_The_Leg_Press_Machine", "Chin-Up", "Decline_Barbell_Bench_Press", "Dips_-_Triceps_Version", "Dumbbell_Bench_Press", "Dumbbell_Bicep_Curl", "Dumbbell_Flyes", "Dumbbell_Lunges", "Dumbbell_Shoulder_Press", "Dumbbell_Shrug", "External_Rotation_with_Cable", "Farmers_Walk", "Front_Barbell_Squat", "Front_Dumbbell_Raise", "Goblet_Squat", "Good_Morning", "Hack_Squat", "Hyperextensions_Back_Extensions", "Incline_Dumbbell_Press", "Leg_Extensions", "Leg_Press", "Leverage_Incline_Chest_Press", "Lying_Leg_Curls", "Lying_Triceps_Press", "Machine_Preacher_Curls", "Natural_Glute_Ham_Raise", "One-Arm_Dumbbell_Row", "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench", "Preacher_Curl", "Pullups", "Reverse_Hyperextension", "Romanian_Deadlift", "Seated_Cable_Rows", "Seated_Calf_Raise", "Seated_Leg_Curl", "Seated_Side_Lateral_Raise", "Standing_Calf_Raises", "Straight-Arm_Dumbbell_Pullover", "Trap_Bar_Deadlift", "Triceps_Pushdown_-_Rope_Attachment", "Upright_Barbell_Row", "Weighted_Pull_Ups", "Wide-Grip_Lat_Pulldown"]);
function demoImg(id,i){ if(ILLUS.has(id)&&!window.__DEMO_BASE) return 'illus/'+encodeURIComponent(id)+'_'+i+'.webp'; return DEMO.base+encodeURIComponent(id)+'_'+i+'.webp'; }
// Précharge les deux photos de chaque exercice du programme (et des séances sans salle) pour qu'elles soient là sans réseau.
function prefetchDemos(){ if(!PROGRAM.sessions.length||window.__DEMO_BASE) return; const ids=new Set(); PROGRAM.sessions.forEach(se=>se.exercises.forEach(ex=>{ const id=demoId(ex); if(id) ids.add(id); })); Object.values(S.overrides||{}).forEach(o=>((o.substitute||{}).exercises||[]).forEach(ex=>{ const id=demoId(ex); if(id) ids.add(id); }));
  const todo=[...ids].filter(id=>!DEMO.prefetched.has(id)); if(!todo.length) return; const run=async()=>{ for(const id of todo){ DEMO.prefetched.add(id); for(const k of [0,1]){ try{ await fetch(demoImg(id,k),{cache:'force-cache'}); }catch(e){} } } }; if('requestIdleCallback' in window) requestIdleCallback(run,{timeout:4000}); else setTimeout(run,1500); }
function loadDemoIndex(){ if(DEMO.index) return Promise.resolve(DEMO.index); if(!DEMO.loading) DEMO.loading=fetch('demo/index.json').then(r=>r.json()).then(a=>{ DEMO.index={}; a.forEach(x=>DEMO.index[x.i]=x); return fetch('illus/extra.json').then(r=>r.json()).then(b=>{ b.forEach(x=>DEMO.index[x.i]=x); return DEMO.index; }).catch(()=>DEMO.index); }).catch(()=>{ DEMO.loading=null; return {}; }); return DEMO.loading; }
// Programme généré avant les fiches : on demande l'association au coach une seule fois, elle est enregistrée dans le programme.
const DEMO_CATALOG_AT=1791900000000; // date du catalogue illustré : une association plus ancienne est refaite une fois (sans quota)
async function ensureDemos(){ if(DEMO.asked||!USER||!navigator.onLine||!PROGRAM_LOADED||!PROGRAM.sessions.length) return; if(PROGRAM.demosAt&&PROGRAM.demosAt>=DEMO_CATALOG_AT) return; if(PROGRAM.demosAt&&PROGRAM.demos&&Object.keys(PROGRAM.demos).length>=PROGRAM.sessions.flatMap(s=>s.exercises).length*0.8&&PROGRAM.demosAt>=DEMO_CATALOG_AT) return; if(S.demoTriedAt&&Date.now()-S.demoTriedAt<24*3600e3&&S.demoTriedFor===(PROGRAM.generatedAt||0)) return; S.demoTriedAt=Date.now(); S.demoTriedFor=PROGRAM.generatedAt||0; save(); DEMO.asked=true; startJob('associe les illustrations des mouvements',['Parcourt ton programme','Choisit la fiche la plus proche pour chaque exercice'],15000); try{ await callCoach({mode:'demo'}); endJob(true,'Photos associées'); }catch(e){ logErr('demo',e); endJob(false,'Photos : association impossible'); } }
function demoStrip(ex,cls){ const id=demoId(ex); if(!id) return ''; const ap=!demoExact(ex); return `<button class="demo ${cls||''}" data-demo="${esc(ex.id)}" aria-label="Voir le mouvement"><img src="${demoImg(id,0)}" alt="" loading="lazy"><i class="arr">›</i><img src="${demoImg(id,1)}" alt="" loading="lazy"><span>${ap?'Geste proche':'Voir le mouvement'}</span></button>`; }
function demoThumb(ex){ const id=demoId(ex); if(!id) return ''; return `<button class="dthumb" data-demo="${esc(ex.id)}" aria-label="Voir le mouvement"><img src="${demoImg(id,1)}" alt="" loading="lazy"></button>`; }
function findEx(exId){ for(const s of PROGRAM.sessions){ const e=s.exercises.find(x=>x.id===exId); if(e) return e; const sub=((S.overrides||{})[s.id]||{}).substitute; if(sub){ const e2=(sub.exercises||[]).find(x=>x.id===exId); if(e2) return e2; } } return null; }
// Mauvaise photo : l'utilisateur choisit lui-même la fiche (recherche par nom, filtre par muscle). Enregistré dans son programme.
async function pickDemo(ex){
  const idx=await loadDemoIndex(); const all=Object.values(idx); const MUS={quadriceps:'Quadriceps',hamstrings:'Ischios',glutes:'Fessiers',calves:'Mollets',chest:'Pectoraux',lats:'Dos',"middle back":'Dos',"lower back":'Lombaires',shoulders:'Épaules',traps:'Trapèzes',biceps:'Biceps',triceps:'Triceps',forearms:'Avant-bras',abdominals:'Abdos',abductors:'Abducteurs',adductors:'Adducteurs',neck:'Cou'};
  const FR={traction:'pull up chin up',tirage:'pulldown row',rowing:'row',développé:'press',couché:'bench',incliné:'incline',épaule:'shoulder',poulie:'cable',haltère:'dumbbell',barre:'barbell',presse:'press',squat:'squat',fente:'lunge',mollet:'calf',curl:'curl',extension:'extension',dips:'dip',pompe:'push up',gainage:'plank',élévation:'raise',écarté:'fly',oiseau:'rear delt',soulevé:'deadlift',ischio:'leg curl',cuisse:'leg',pectoraux:'chest',dos:'back lat',biceps:'biceps',triceps:'triceps',abdos:'crunch'};
  const guessQ=()=>{ const words=(ex.name||'').toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean); const en=words.map(w=>Object.entries(FR).find(([k])=>w.startsWith(k.slice(0,5)))).filter(Boolean).map(x=>x[1]); return (en.join(' ')||words.join(' ')); };
  const sheet=showSheet(`<h3>Choisir la photo</h3><p class="small muted">${esc(ex.name)} · tape un mot (en français ou en anglais) ou filtre par muscle.</p><input id="dpQ" placeholder="Rechercher…" value="${esc(guessQ())}"><div class="chips dpm" id="dpM"><button class="chip2 on" data-m="">Tous</button>${Object.entries(MUS).filter(([k])=>!/middle|lower/.test(k)).map(([k,l])=>`<button class="chip2" data-m="${k}">${l}</button>`).join('')}</div><div class="dpgrid" id="dpG"></div><button class="btn" id="dpNone">Aucune photo pour cet exercice</button>`);
  let mus=''; const q=$('#dpQ');
  const score=(x,terms)=>{ const n=x.n.toLowerCase(); let sc=0; terms.forEach(t=>{ if(n.includes(t)) sc+=2; else if(n.split(/\W+/).some(w=>w.startsWith(t))) sc+=1; }); return sc; };
  const draw=()=>{ const terms=q.value.toLowerCase().split(/\s+/).filter(t=>t.length>1); let list=all.filter(x=>!mus||x.p.includes(mus)||x.s.includes(mus)); if(terms.length) list=list.map(x=>[x,score(x,terms)]).filter(([,sc])=>sc>0).sort((a,b)=>b[1]-a[1]).map(([x])=>x); list=list.slice(0,40);
    $('#dpG').innerHTML=list.length?list.map(x=>`<button class="dpc" data-id="${esc(x.i)}"><img src="${demoImg(x.i,1)}" alt="" loading="lazy"><span>${esc(x.n)}</span></button>`).join(''):'<p class="small muted center">Rien ne correspond, essaie un autre mot.</p>';
    sheet.querySelectorAll('.dpc').forEach(b=>b.onclick=()=>setDemoUser(ex,b.dataset.id)); };
  q.oninput=draw; sheet.querySelectorAll('#dpM .chip2').forEach(b=>b.onclick=()=>{ mus=b.dataset.m; sheet.querySelectorAll('#dpM .chip2').forEach(x=>x.classList.toggle('on',x===b)); draw(); }); $('#dpNone').onclick=()=>setDemoUser(ex,'none'); draw();
}
function setDemoUser(ex,id){ PROGRAM.demosUser=PROGRAM.demosUser||{}; PROGRAM.demosUser[ex.id]=id; if(USER&&fbDb) col('meta').doc('program').set({demosUser:{[ex.id]:id}},{merge:true}).catch(()=>{}); hideSheet(); toast(id==='none'?'Photo retirée':'Photo enregistrée','ok'); render(); if(id!=='none') showDemo(ex); }
let demoAnim=0;
async function showDemo(ex){
  if(!ex) return; const id=demoId(ex);
  const yt='https://www.youtube.com/results?search_query='+encodeURIComponent((ex.name||'')+' '+(ex.machine||'').split('·')[0]+' exécution');
  let d='<dl class="dl">'; if(ex.note) d+=`<dt>${esc(COACH_NAME)} pour toi</dt><dd>${esc(ex.note)}</dd>`; if(ex.target) d+=`<dt>Cible</dt><dd>${esc(ex.target)}</dd>`; if(ex.exec) d+=`<dt>Exécution</dt><dd>${esc(ex.exec)}</dd>`; if(ex.why) d+=`<dt>Pourquoi</dt><dd>${esc(ex.why)}</dd>`; if(ex.seek) d+=`<dt class="seek">Ce qu'on cherche</dt><dd>${esc(ex.seek)}</dd>`; if(ex.rule) d+=`<dt>Règle de progression</dt><dd>${esc(ex.rule)}</dd>`; if(ex.reco) d+=`<dt>Reconnaître la machine</dt><dd>${esc(ex.reco)}</dd>`; d+='</dl>';
  const links=`<div class="row2 dlinks">${ex.url?`<a class="btn sm" href="${esc(ex.url)}" target="_blank" rel="noopener" data-ext>Photo de la machine ↗</a>`:''}<a class="btn sm" href="${yt}" target="_blank" rel="noopener" data-ext>Vidéo ↗</a></div>`;
  const p=rx(ex,curWeek()); const rxh=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}</b>${p.rir!=null?`<b data-lex="rir"><i>RIR</i>${p.rir}</b>`:''}<b data-lex="tempo"><i>tempo</i>${esc(ex.tempo||'')}</b><b><i>repos</i>${esc(p.restText||'')}</b></div>`;
  const sheet=showSheet(`<h3>${esc(ex.name)}</h3><p class="small muted">${esc(ex.machine||'')}${ex.alt?' · alternative : '+esc(ex.alt):''}</p>${id?`<div class="dplay ${demoExact(ex)?'':'approx'}" id="dplay"><img src="${demoImg(id,0)}" alt="Position de départ" class="on"><img src="${demoImg(id,1)}" alt="Position d'arrivée"><div class="dcap"><span class="on">Départ</span><span>Arrivée</span></div>${demoExact(ex)?'':'<em class="dapprox">Geste proche, pas la machine exacte</em>'}</div><div class="mmap-slot" id="mslot"></div>`:`<p class="hint">Pas d'illustration pour ce mouvement exact. <button class="link" id="dpPick">En choisir une</button></p>`}${id?`<p class="small center"><button class="link" id="dpPick">Pas le bon mouvement ? En choisir un autre</button></p>`:''}${rxh}${links}${d}<button class="btn" onclick="hideSheet()">Fermer</button>`);
  const pk=$('#dpPick'); if(pk) pk.onclick=()=>pickDemo(ex);
  sheet.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
  clearInterval(demoAnim);
  if(id){ let k=0; demoAnim=setInterval(()=>{ const p=$('#dplay'); if(!p||!sheet.classList.contains('on')){ clearInterval(demoAnim); return; } k=1-k; p.querySelectorAll('img').forEach((im,i)=>im.classList.toggle('on',i===k)); p.querySelectorAll('.dcap span').forEach((c,i)=>c.classList.toggle('on',i===k)); },1100);
    const idx=await loadDemoIndex(); const info=idx[id]; const slot=$('#mslot'); if(info&&slot&&window.muscleMap) slot.innerHTML=muscleMap(info.p,info.s); }
}
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-demo]'); if(b){ e.preventDefault(); e.stopPropagation(); showDemo(findEx(b.dataset.demo)); } },true);

/* ---------- render: séance ---------- */
function render(){ if(!PROGRAM.sessions.length||!PROGRAM_LOADED||!$('#tab-seance')) return; renderHome(); setTimeout(publishPublic,1200); if(!RENDER_UNLOCK_T){ RENDER_UNLOCK_T=setTimeout(()=>{ if(!document.querySelector('.onb')&&!document.querySelector('#sheet.on')) checkUnlocks(); },2500); } renderSeance(); renderProgramme(); renderSuivi(); renderReglages(); renderCoach(); const w=WEEKS[curWeek()-1]; $('#weekChip').textContent=`Semaine ${w.n}`; }

function shortName(n){ n=String(n||''); if(n.length<=9) return n; const w=n.split(/\s+/); return w[0]+(w.length>1&&/^[A-Z]$/.test(w[w.length-1])?' '+w[w.length-1]:''); }
const LEX={
  rir:['RIR — répétitions en réserve','Le nombre de répétitions que tu aurais encore pu faire quand tu as arrêté la série. RIR 3 : il t\'en restait trois. RIR 0 : impossible d\'en faire une de plus. Repère simple : quand la barre ralentit franchement, tu es vers RIR 2.'],
  ressenti:['Ressenti de la série','F = facile, il restait 3 répétitions ou plus. J = juste, il en restait 1 ou 2. É = échec ou presque, 0 en réserve. Le coach s\'en sert pour décider des charges de la prochaine séance : réponds honnêtement.'],
  tempo:['Tempo','Quatre chiffres : descente, pause en bas, montée, pause en haut, en secondes. « X » = explosif. 3-1-X-0 : trois secondes de descente, une seconde d\'arrêt, montée explosive, pas de pause en haut. Le tempo contrôle le temps sous tension et protège les articulations.'],
  emom:['EMOM','« Every minute on the minute » : une série au début de chaque intervalle, le reste de l\'intervalle est ton repos. Plus tu es rapide, plus tu récupères.'],
  gtg:['GTG — grease the groove','Des séries de tractions très loin de l\'échec, réparties dans la séance, pour accumuler du volume technique sans fatigue. Jamais forcé.'],
  semaine:['Les semaines du cycle','Un mésocycle dure 3 à 6 semaines selon ton profil, la dernière en décharge. Calibrage : on pose les charges (RIR 3). Accumulation : on ajoute du volume. Intensification : on va près de l\'échec. Décharge : 40 % de séries en moins pour récupérer. La semaine avance quand tu as fait tes séances, pas au calendrier.'],
  mesocycle:['Mésocycle','Un bloc d\'entraînement de 3 à 6 semaines avec une progression organisée, terminé par une semaine de décharge. Le coach choisit la durée selon ton niveau et ton objectif, puis génère le suivant à partir de tes résultats.'],
  calibrage:['Semaine de calibrage','Première semaine du cycle : tu poses les charges avec de la marge (RIR 3) et tu notes tout. C\'est la référence pour les semaines suivantes.'],
  accumulation:['Accumulation','Semaines où le volume augmente : une série de plus sur les exercices prioritaires ★, charges +2,5 % ou +1 rep quand la fourchette haute est atteinte.'],
  intensification:['Intensification','Semaine où l\'on va près de l\'échec (RIR 1, parfois 0 sur les isolations) avec des techniques comme le drop set ou le rest-pause. C\'est là que se construit la force.'],
  decharge:['Décharge (deload)','Dernière semaine du cycle : 40 % de séries en moins, charges −10 %. Le corps assimile, les articulations récupèrent, tu repars plus fort sur le cycle suivant. Ne la saute pas.'],
  star:['Exercice prioritaire ★','Il reçoit une série de plus pendant les semaines d\'accumulation. C\'est là que se joue ta progression sur ce cycle.'],
  e1rm:['e1RM — 1RM estimé','La charge maximale que tu pourrais soulever une fois, estimée à partir d\'une série (formule d\'Epley). Permet de comparer des séries à reps différentes et de suivre la force sans tester le max.'],
  fourchette:['Fourchette de répétitions','« 6-8 » : tu vises entre 6 et 8 reps. Bas de fourchette atteint partout au RIR prescrit → même charge, on cherche plus de reps. Haut de fourchette atteint partout → +2,5 % la prochaine fois.'],
  volume:['Volume','Le nombre de séries sérieuses par groupe musculaire et par semaine. Repère : 10 à 20 pour progresser, moins pour entretenir.'],
  tonnage:['Tonnage','Charge × répétitions, additionné sur toute la séance ou la semaine. Un indicateur brut du travail total.'],
  dropset:['Drop set','À la fin d\'une série, on baisse la charge de 20 à 30 % et on enchaîne sans repos jusqu\'au RIR visé. Technique d\'intensification, réservée aux isolations.'],
  restpause:['Rest-pause','Après une série proche de l\'échec, 10 à 15 secondes de repos puis on repart avec la même charge pour quelques reps. Une ou deux fois.'],
  superset:['Superset','Deux exercices enchaînés sans repos, souvent des muscles opposés (biceps / triceps). Gain de temps et de densité.'],
  partielles:['Partielles étirées','Après l\'échec sur l\'amplitude complète, on continue sur la moitié basse du mouvement (muscle étiré). Efficace pour l\'hypertrophie, à utiliser en fin de série.'],
  isolateral:['Iso-latéral','Machine où chaque côté travaille indépendamment (deux leviers). Corrige les déséquilibres droite / gauche.'],
  compound:['Exercice polyarticulaire (compound)','Mouvement qui mobilise plusieurs articulations et groupes musculaires : squat, développé, tirage. Base de la force, placé en début de séance.'],
  isolation:['Exercice d\'isolation','Une articulation, un muscle ciblé : curl, extension, élévation. Placé en fin de séance, on peut y aller plus près de l\'échec.'],
};
const LEX_TERMS=[['rir',/\bRIR\b/g],['tempo',/\btempo\b/gi],['emom',/\bEMOM\b/g],['gtg',/\bGTG\b/g],['e1rm',/\be1RM\b/g],['mesocycle',/\bm[ée]socycles?\b/gi],['decharge',/\bd[ée]charge\b/gi],['calibrage',/\bcalibrage\b/gi],['accumulation',/\baccumulation\b/gi],['intensification',/\bintensification\b/gi],['dropset',/\bdrop[- ]?sets?\b/gi],['restpause',/\brest[- ]?pause\b/gi],['superset',/\bsupersets?\b/gi],['partielles',/\bpartielles\b/gi],['isolateral',/\biso-?lat[ée]rale?s?\b/gi],['compound',/\bcompounds?\b/gi],['fourchette',/\bfourchette\b/gi],['tonnage',/\btonnage\b/gi],['volume',/\bvolume\b/gi]];
function lexify(escapedHtml){ let h=String(escapedHtml||''); LEX_TERMS.forEach(([k,re])=>{ h=h.replace(re,m=>`<button class="lx" data-lex="${k}">${m}</button>`); }); return h; }
// Liens externes : dans la coquille, on ouvre Safari (la WebView est limitée aux domaines de l'app et afficherait une page d'erreur).
document.addEventListener('click',e=>{ const a=e.target.closest&&e.target.closest('a[href]'); if(!a||!NATIVE) return; const href=a.getAttribute('href')||''; if(/^https?:/i.test(href)&&!href.startsWith(location.origin)){ e.preventDefault(); native({type:'open',url:href}); } },true);
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('.lx[data-lex]'); if(b){ e.preventDefault(); e.stopPropagation(); showLex(b.dataset.lex); } },true);
function showSheet(html){ let s=$('#sheet'); if(!s){ s=document.createElement('div'); s.id='sheet'; s.innerHTML='<div class="sheet-bg"></div><div class="sheet-card" role="dialog"><button class="sheet-grip" aria-label="Fermer"></button><div class="sheet-body"></div></div>'; document.body.appendChild(s); s.querySelector('.sheet-bg').onclick=hideSheet; s.querySelector('.sheet-grip').onclick=hideSheet;
    // Glisser vers le bas pour fermer : depuis la poignée, ou depuis le contenu quand il est en haut de son défilement.
    const card=s.querySelector('.sheet-card'); let y0=null, dy=0, drag=false;
    card.addEventListener('touchstart',e=>{ const fromGrip=e.target.closest('.sheet-grip,.chead'); const atTop=card.scrollTop<=0&&!(e.target.closest('.chat')&&e.target.closest('.chat').scrollTop>0); if(!fromGrip&&!atTop) return; y0=e.touches[0].clientY; dy=0; drag=false; },{passive:true});
    card.addEventListener('touchmove',e=>{ if(y0==null) return; dy=e.touches[0].clientY-y0; if(dy>8){ drag=true; card.style.transition='none'; card.style.transform=`translateY(${dy}px)`; } },{passive:true});
    card.addEventListener('touchend',()=>{ if(y0==null) return; card.style.transition=''; if(drag&&dy>90){ card.style.transform=''; hideSheet(); } else card.style.transform=''; y0=null; drag=false; },{passive:true}); } s.querySelector('.sheet-body').innerHTML=html; s.classList.add('on'); document.body.style.overflow='hidden'; return s; }
function hideSheet(){ const s=$('#sheet'); if(s){ s.classList.remove('on'); s.classList.remove('tall'); const c=s.querySelector('.sheet-card'); if(c){ c.style.bottom=''; c.style.maxHeight=''; } document.body.style.overflow=''; } COACH.chatOpen=false; }
function showLex(key){ const l=LEX[key]; if(!l) return; showSheet(`<h3>${esc(l[0])}</h3><p>${esc(l[1])}</p><button class="btn" onclick="hideSheet()">Compris</button>`); }
let toastT=0; function toast(msg,cls,ms){ let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); } t.textContent=msg; t.className='on '+(cls||''); clearTimeout(toastT); toastT=setTimeout(()=>t.className='',ms||1800); }
function rirLabel(v){ return v==null?'':v>=3?'F':v>=1?'J':'É'; }


// Adaptation du jour : fatigue (−1 série, RIR +1), temps réduit (exercices non prioritaires retirés en partant de la fin), douleur (exercices de la zone sautés). Réversible, limité à la séance du jour.
const ZONE_RX={genou:/squat|fente|lunge|leg ?ext|presse|hack|pendulum|saut|jump|pistol/i,epaule:/d[ée]velopp[ée].*(militaire|[ée]paule|overhead)|shoulder press|[ée]l[ée]vation|dips?\b|traction|pull[- ]?up|upright/i,dos:/soulev[ée] de terre|deadlift|good ?morning|rowing.*(barre|pench)|bent.?over|squat.*barre|hyperext/i,coude:/curl|pushdown|extension.*triceps|skull|dips?\b/i,poignet:/pompes?|push[- ]?up|front squat|wrist/i,hanche:/hip thrust|fente|lunge|abduct|adduct/i,cheville:/mollet|calf|saut|jump|fente|lunge/i};
function estMinutes(exs,wk,log){ return Math.round(exs.reduce((a,ex)=>{ const p=rx(ex,wk,log); return a+p.sets*((p.rest||90)+45)/60; },0)+8); }
function dayAdapt(kind,ses,log0,wk){
  const log=getLog(todayISO(),ses.id); log.flags=log.flags||{};
  if(kind==='reset'){ Object.values(log.flags).forEach(f=>{ if(f.why){ delete f.skip; delete f.why; } }); delete log.day; log.updatedAt=Date.now(); save(); writeDoc('logs',logKey(log.date,ses.id),log); renderSeance(); toast('Séance d\'origine rétablie'); return; }
  if(kind==='ok'){ log.day={ok:true}; save(); renderSeance(); return; }
  if(kind==='fatigue'){ log.day={fatigue:true}; log.updatedAt=Date.now(); save(); writeDoc('logs',logKey(log.date,ses.id),log); renderSeance(); toast('Séance allégée : une série de moins partout, RIR +1'); return; }
  if(kind==='time'){ const sheet=showSheet(`<h3>Combien de temps tu as ?</h3><div class="ivchips">${[20,30,45].map(m=>`<button class="ivchip" data-min="${m}">${m} min</button>`).join('')}</div><p class="small muted">Je garde les exercices prioritaires ★ et je retire les autres en partant de la fin.</p>`);
    sheet.querySelectorAll('[data-min]').forEach(b=>b.onclick=()=>{ const m=+b.dataset.min; let keep=ses.exercises.slice(); let dropped=0; const order=ses.exercises.slice().reverse().filter(e=>!e.star).concat(ses.exercises.slice().reverse().filter(e=>e.star));
      for(const e of order){ if(estMinutes(keep,wk,log)<=m||keep.length<=2) break; keep=keep.filter(x=>x.id!==e.id); log.flags[e.id]=Object.assign({},log.flags[e.id],{skip:true,why:'temps'}); dropped++; }
      log.day={minutes:m,dropped}; log.updatedAt=Date.now(); save(); writeDoc('logs',logKey(log.date,ses.id),log); hideSheet(); renderSeance(); toast(dropped?dropped+' exercice'+(dropped>1?'s':'')+' retiré'+(dropped>1?'s':'')+' pour tenir en '+m+' min':'La séance tient déjà en '+m+' min'); }); return; }
  if(kind==='pain'){ const sheet=showSheet(`<h3>Où ça fait mal ?</h3><div class="ivchips">${IV_ZONES.map(([v,l])=>`<button class="ivchip" data-zone="${v}">${l}</button>`).join('')}</div><p class="small muted">Les exercices qui sollicitent la zone sont sautés aujourd'hui. Si la douleur persiste, ajoute-la à ton profil pour que ${esc(COACH_NAME)} reconstruise le cycle.</p>`);
    sheet.querySelectorAll('[data-zone]').forEach(b=>b.onclick=()=>{ const z=b.dataset.zone; const re=ZONE_RX[z]; let n=0; ses.exercises.forEach(e=>{ if(re&&re.test(e.name+' '+(e.pattern||''))){ log.flags[e.id]=Object.assign({},log.flags[e.id],{skip:true,why:'douleur'}); n++; } });
      log.day={pain:(IV_ZONES.find(x=>x[0]===z)||['',z])[1].toLowerCase(),skipped:n}; log.updatedAt=Date.now(); save(); writeDoc('logs',logKey(log.date,ses.id),log); hideSheet(); renderSeance(); toast(n?n+' exercice'+(n>1?'s':'')+' sauté'+(n>1?'s':''):'Aucun exercice de la séance ne sollicite cette zone'); }); return; }
}
function renderSeance(){
  if(!$('#tab-seance')||!PROGRAM.sessions.length) return;
  const wk=curWeek(), W=WEEKS[wk-1], date=todayISO(); let ses=curSession(); const log=getLog(date,ses.id);
  const subDoc=((S.overrides||{})[ses.id]||{}).substitute; const sub=subDoc&&subDoc.date===date?subDoc:null;
  if(sub) ses=Object.assign({},ses,{name:sub.name,sub:'sans salle · '+(sub.gear||[]).join(', '),exercises:sub.exercises,gtg:false,note:''});
  const el=$('#tab-seance'); let h='';
  const dow=(new Date(date+'T12:00:00').getDay()+6)%7; const monday=addDays(date,-dow), sunday=addDays(monday,6);
  h+=`<div class="days">`+PROGRAM.sessions.map(s=>{ const done=Object.values(S.logs).some(l=>l.session===s.id&&l.done&&l.date>=monday&&l.date<=sunday); return `<button data-s="${s.id}" aria-pressed="${s.id===ses.id}" class="${done?'done':''}"><b>${esc(s.dayName.slice(0,3))}</b><span>${esc(shortName(s.name))}</span></button>`; }).join('')+`<button data-s="rest" aria-pressed="false"><b>Dim</b><span>Repos</span></button></div>`;
  // état de la séance
  const flagsAll=log.flags||{};
  const states=ses.exercises.map(ex=>{ const p=rx(ex,wk,log); const done=(log.sets[ex.id]||[]).filter(s=>s&&s.done).length; const f=flagsAll[ex.id]||{}; return {ex,p,done,complete:done>=p.sets,skip:!!f.skip,alt:!!f.alt,why:f.why||''}; });
  const nDone=states.filter(s=>s.complete||s.skip).length, nSets=states.reduce((a,s)=>a+s.done,0);
  let current=states.find(s=>!s.complete&&!s.skip); if(S.openEx){ const o=states.find(s=>s.ex.id===S.openEx); if(o) current=o; }
  const curIdx=current?states.findIndex(s=>s.ex.id===current.ex.id):-1;
  if(FOCUS){ h+=`<div class="fhead"><button class="fclose" id="fExit" aria-label="Quitter le mode séance">✕</button><div class="ftitle"><b>${esc(ses.name)}</b><span>${curIdx>=0?`Exercice ${curIdx+1} sur ${states.length}`:'Tous les exercices sont faits'} · ${nSets} série${nSets>1?'s':''} <span id="elapsed" class="el"></span></span></div><div class="fprog">${states.map(s=>`<i class="${s.complete?'ok':s.skip?'skip':(current&&current.ex.id===s.ex.id)?'now':''}"></i>`).join('')}</div></div>`; }
  h+=`<div class="sesshead"><h2>${esc(ses.name)}</h2><span class="meta">${esc(ses.sub)} · ${esc(ses.duration)}${ses.place?' · '+esc(ses.place):''} <span id="${FOCUS?'elapsed2':'elapsed'}"></span></span>
    <div class="prog"><div class="bar"><i style="width:${Math.round(100*nDone/Math.max(1,states.length))}%"></i></div><span>${nDone}/${states.length} exercices · ${nSets} série${nSets>1?'s':''}</span><button class="wk" id="wkChip">${esc(W.label)}${S.weekOverride?' · fixée':''} · ${esc((W.rirNote||'').split('·')[0].replace(/\(.*$/,'').trim())}</button></div></div>`;
  if(sub) h+=`<div class="banner info"><b>Séance sans salle.</b> ${esc(sub.intro)} <button class="link" id="subOff">Revenir à la séance prévue</button></div>`;
  else if(!log.done&&!nSets) h+=`<div class="row2 nogym"><button class="btn sm" id="subBtn">Pas de salle aujourd'hui ?</button></div>`;
  if(ses.note) h+=`<div class="banner">${esc(ses.note)}</div>`;
  if(cycleOver()) h+=`<div class="banner">Cycle terminé le ${fmtD(WEEKS[WEEKS.length-1].to)}. Prescriptions de décharge en attendant le cycle suivant (Programme → Nouveau cycle).</div>`;
  if(log.done) h+=`<div class="banner ok">Séance validée. Tu peux encore corriger les valeurs.</div>`;
  if(!log.done&&!ses.exercises.some(ex=>lastRef(ex.id,date))&&!nSets) h+=`<p class="hint">Première fois : note tes charges, elles serviront de référence.</p>`;
  const prevLog=Object.values(S.logs).filter(l=>l.session===ses.id&&l.date<date&&l.notes).sort((a,b)=>a.date<b.date?1:-1)[0];
  if(prevLog) h+=`<details class="more wu"><summary>Tes notes du ${fmtD(prevLog.date)}</summary><p class="small">${esc(prevLog.notes)}</p></details>`;
  if(!log.done&&!sub){ const d=log.day||null; if(!d) h+=`<div class="daycard"><b>Comment tu te sens aujourd'hui ?</b><div class="ivchips"><button class="ivchip" data-day="ok">En forme</button><button class="ivchip" data-day="fatigue">Fatigué</button><button class="ivchip" data-day="time">Peu de temps</button><button class="ivchip" data-day="pain">Une douleur</button></div></div>`;
    else if(d&&(d.fatigue||d.minutes||d.pain)) h+=`<div class="banner info dayban">Séance adaptée : ${[d.fatigue?'−1 série partout, RIR +1':'',d.minutes?d.minutes+' min, '+(d.dropped||0)+' exercice'+((d.dropped||0)>1?'s':'')+' retiré'+((d.dropped||0)>1?'s':''):'',d.pain?esc(d.pain)+' : '+(d.skipped||0)+' sauté'+((d.skipped||0)>1?'s':''):''].filter(Boolean).join(' · ')}. <button class="link" data-day="reset">Annuler</button></div>`; }
  const wu=(PROGRAM.warmup||{})[ses.id.replace(/[AB]$/,'')]; if(wu) h+=`<details class="more wu"><summary>Échauffement · 8-10 min</summary><p class="small">${esc(PROGRAM.warmup.common)}</p><p class="small">${esc(wu)}</p><p class="small">${esc(PROGRAM.warmup.ramp)}</p></details>`;
  if(ses.gtg){ h+=`<div class="ex gtg"><div class="exh"><button class="n" data-lex="gtg">GTG</button><span class="name">Tractions sous-maximales 3 × 15</span></div><p class="mach">3 blocs répartis dans la séance, loin de l'échec.</p><div class="gtgrow">${[0,1,2].map(i=>`<label><input type="checkbox" data-gtg="${i}" ${log.gtg[i]?'checked':''}> Bloc ${i+1}</label>`).join('')}</div></div>`; }

  states.forEach(st=>{
    const {ex,p,done,complete,skip,alt}=st; const isCur=current&&current.ex.id===ex.id;
    const ref=lastRef(ex.id,date); const ov=((S.overrides||{})[ses.id]||{}).adj; const o=ov&&ov[ex.id];
    if(!isCur){
      const status=skip?'<span class="tag">sauté</span>':complete?'<span class="ok-ic">✓</span>':done?`<span class="muted">${done}/${p.sets}</span>`:`<span class="muted">${p.sets} × ${esc(p.reps)}</span>`;
      h+=`<button class="exrow ${complete?'complete':''} ${skip?'skipped':''}" data-open="${ex.id}"><span class="n">${ex.n}</span><span class="nm">${esc(ex.name)}${ex.star?'<span class="star">★</span>':''}</span>${status}</button>`;
      return;
    }
    h+=`<div class="ex cur ${complete?'complete':''} ${skip?'skipped':''}" data-ex="${ex.id}"><div class="exh"><span class="n">${ex.n}</span><span class="name">${esc(ex.name)}${ex.star?'<button class="star" data-lex="star">★</button>':''}</span>${alt?'<span class="tag">alternative</span>':''}${skip?'<span class="tag">sauté</span>':''}<button class="more-btn" data-menu="${ex.id}" aria-label="Options">⋯</button></div>`;
    h+=`<p class="mach clamp1" data-expand>${esc(ex.machine)}${ex.alt?' <span class="muted">· alt. '+esc(ex.alt)+'</span>':''}</p>`;
    h+=demoStrip(ex);
    h+=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}${ex.per?' '+esc(ex.per):''}</b>${p.rir!=null?`<b data-lex="rir"><i>RIR</i>${p.rir}</b>`:''}<b data-lex="tempo"><i>tempo</i>${esc(ex.tempo)}</b><b><i>repos</i>${esc(p.restText)}</b>${ex.mode==='emom'?'<b data-lex="emom">EMOM</b>':''}</div>`;
    if(o) h+=`<p class="coachline"><b>Coach</b> ${esc(o.change)}</p>`;
    let tgtW=null;
    if(ref){ const top=ref.sets.find(s=>s.w)||ref.sets[0]; let tgt=''; if(top&&top.w&&wk>1&&wk<WEEKS.length){ const hi=parseInt(String(p.reps).split('-').pop()); const allHi=ref.sets.every(s=>s.r>=hi); const lowRir=ref.sets.some(s=>s.rir!=null&&s.rir<Math.max(0,(p.rir??1)-1)); if(allHi&&!lowRir){ tgtW=Math.round(top.w*1.025*2)/2; tgt=` → <span class="tgt">${tgtW} kg</span> <span class="why">+2,5 % : haut de fourchette atteint partout</span>`; } else if(lowRir){ tgt=` → <span class="tgt">même charge</span> <span class="why">RIR plus bas que prévu la dernière fois</span>`; } else tgt=` → <span class="tgt">+1 rep</span> <span class="why">fourchette pas encore atteinte</span>`; } if(wk>=WEEKS.length&&top&&top.w){ tgtW=Math.round(top.w*0.9*2)/2; tgt=` → <span class="tgt">décharge ${tgtW} kg</span> <span class="why">−10 %, on récupère</span>`; } const topS=ref.sets.find(x=>x.w)||ref.sets[0]; h+=`<p class="ref">Dernier : <b>${topS&&topS.w?topS.w+' kg × '+(topS.r??'?'):esc(fmtSets(ref.sets.slice(0,1)))}</b>${ref.sets.length>1?' <span class="muted">· '+ref.sets.length+' séries</span>':''}${tgt}</p>`; }
    const coachW=o&&typeof o.load==='number'?o.load:null;
    const wLabel=/lest/i.test(ex.name)?'lest kg':ex.mode==='emom'?'—':ex.mode==='max'?'assist kg':'kg';
    h+=`<div class="sets"><span class="hd"></span><span class="hd">${wLabel}</span><span class="hd">reps</span><button class="hd" data-lex="ressenti">ressenti</button><span class="hd"></span>`;
    const arr=log.sets[ex.id]||[]; const prev=ref?ref.sets:[];
    const nextIdx=arr.filter(x=>x&&x.done).length;
    for(let i=0;i<p.sets;i++){
      const s=arr[i]||{}; const pf=prev[i]||prev[prev.length-1]||{};
      const enabled=s.done||i<=nextIdx; const active=!s.done&&i===nextIdx;
      const phW=coachW??tgtW??pf.w??''; const phR=pf.r??String(p.reps).split('-')[0].replace(/\D.*/,'');
      h+=`<span class="i">${i+1}</span>`;
      h+=`<div class="wcell ${active?'active':''}">${active?'<button class="step" data-step="-2.5" data-i="'+i+'" aria-label="Moins 2,5 kg">−</button>':''}<input type="number" inputmode="decimal" step="0.5" data-f="w" data-i="${i}" placeholder="${phW}" value="${s.w??''}" ${enabled?'':'disabled'}>${active?'<button class="step" data-step="2.5" data-i="'+i+'" aria-label="Plus 2,5 kg">+</button>':''}</div>`;
      h+=`<input type="number" inputmode="numeric" data-f="r" data-i="${i}" placeholder="${phR}" value="${s.r??''}" ${enabled?'':'disabled'}>`;
      h+=`<div class="seg ${enabled?'':'off'}" data-i="${i}">${[['3','F'],['1','J'],['0','É']].map(([v,l])=>`<button data-rir="${v}" data-i="${i}" class="${rirLabel(s.rir)===l?'sel':''}" ${enabled?'':'disabled'}>${l}</button>`).join('')}</div>`;
      h+=`<button class="go ${s.done?'done':''}${s.pr?' pr':''}" data-i="${i}" ${enabled?'':'disabled'} aria-label="${s.done?'Annuler la série':'Valider la série'} ${i+1}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    }
    h+=`</div>`;
    if(ex.mode==='emom') h+=`<div class="row2"><button class="btn sm acc" data-emom="start">Top série</button><span class="small muted">Chrono de ${esc(p.restText)} à chaque départ, coche quand la série est faite.</span></div>`;
    if(FOCUS){ const prev=states[curIdx-1], next=states[curIdx+1]; h+=`<div class="fnav">${prev?`<button class="btn sm" data-open="${prev.ex.id}">‹ ${esc(shortName(prev.ex.name))}</button>`:'<span></span>'}${next?`<button class="btn sm" data-open="${next.ex.id}">${esc(shortName(next.ex.name))} ›</button>`:(log.done?'':`<button class="btn sm acc" id="fEnd">Terminer la séance</button>`)}</div>`; }
    h+=`</div>`;
  });
  if(FOCUS&&!current&&!log.done) h+=`<div class="fdone"><div class="big">✓</div><h3>Tous les exercices sont faits</h3><p class="muted">${nSets} série${nSets>1?'s':''} validée${nSets>1?'s':''}. Note ton ressenti puis termine : le coach analyse la séance.</p></div>`;
  h+=`<div class="notes ${FOCUS&&!current?"fshow":""}"><h3>Notes de séance</h3><textarea id="notes" placeholder="Facile, dur, douleur, machine absente, sommeil, garde…">${esc(log.notes)}</textarea></div>`;
  h+=`<div class="endrow ${FOCUS&&!current?"fshow":""}"><button class="btn ${log.done?'':'fill'}" id="endBtn">${log.done?'Rouvrir la séance':'Séance terminée'}</button><span class="small muted">${nSets?nSets+' série'+(nSets>1?'s':'')+' validée'+(nSets>1?'s':''):'Aucune série validée'}</span></div>`;
  el.innerHTML=h;
  el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>dayAdapt(b.dataset.day,ses,log,wk));

  // events
  el.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{ const id=b.dataset.s; if(id==='rest'){ el.innerHTML=`<div class="days">${el.querySelector('.days').innerHTML}</div><h2>Dimanche — repos</h2><p>Marche 30 à 60 min, mobilité hanches et épaules 20 min. Pas de tractions.</p>`; el.querySelectorAll('.days button').forEach(x=>x.onclick=()=>{S.session=x.dataset.s==='rest'?S.session:x.dataset.s;S.openEx=null;save();renderSeance();}); return; } S.session=id; S.sessionDate=todayISO(); S.openEx=null; save(); renderSeance(); window.scrollTo({top:0}); });
  el.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
  const wc=$('#wkChip'); if(wc) wc.onclick=showWeekPicker;
  const fx=$('#fExit'); if(fx) fx.onclick=()=>exitFocus();
  const fe=$('#fEnd'); if(fe) fe.onclick=()=>{ const e2=$('#endBtn'); if(e2) e2.click(); };
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ S.openEx=b.dataset.open; save(); renderSeance(); const c=el.querySelector('.ex.cur'); if(c) c.scrollIntoView({block:'start',behavior:'smooth'}); });
  el.querySelectorAll('[data-expand]').forEach(p=>p.onclick=()=>p.classList.toggle('clamp1'));
  el.querySelectorAll('[data-gtg]').forEach(c=>c.onchange=()=>{ log.gtg[+c.dataset.gtg]=c.checked; touch(log); });
  el.querySelectorAll('.ex[data-ex]').forEach(card=>{
    const exId=card.dataset.ex; const ex=ses.exercises.find(e=>e.id===exId); const p=rx(ex,wk);
    const arr=()=>{ if(!log.sets[exId]) log.sets[exId]=[]; return log.sets[exId]; };
    const inputOf=(f,i)=>card.querySelector(`input[data-f="${f}"][data-i="${i}"]`);
    card.querySelectorAll('input[data-f]').forEach(inp=>inp.onchange=()=>{ const a=arr(); const i=+inp.dataset.i; a[i]=a[i]||{}; a[i][inp.dataset.f]=inp.value===''?null:Number(inp.value); touch(log); });
    card.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; const inp=inputOf('w',i); const base=inp.value!==''?Number(inp.value):Number(inp.placeholder)||0; const v=Math.max(0,Math.round((base+Number(b.dataset.step))*2)/2); inp.value=v; inp.dispatchEvent(new Event('change')); });
    card.querySelectorAll('[data-rir]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; const a=arr(); a[i]=a[i]||{}; const v=Number(b.dataset.rir); a[i].rir=a[i].rir===v?null:v; touch(log); card.querySelectorAll(`[data-rir][data-i="${i}"]`).forEach(x=>x.classList.toggle('sel',a[i].rir!=null&&Number(x.dataset.rir)===a[i].rir)); });
    card.querySelectorAll('.go').forEach(b=>b.onclick=()=>{
      const i=+b.dataset.i; const a=arr(); a[i]=a[i]||{};
      ['w','r'].forEach(f=>{ const inp=inputOf(f,i); const v=inp.value!==''?Number(inp.value):(inp.placeholder!==''?Number(inp.placeholder):null); a[i][f]=isNaN(v)?null:v; });
      if(a[i].rir==null&&p.rir!=null) a[i].rir=p.rir;
      if(a[i].done){ a[i].done=false; touch(log); renderSeance(); return; }
      const prev=bestBefore(ex.id,log.date); const v=e1rm(a[i].w,a[i].r); const isPR=ex.mode!=='emom'&&prev>0&&v>prev+0.01&&!(a.some((x,k)=>k!==i&&x&&x.done&&e1rm(x.w,x.r)>=v));
      a[i].done=true; a[i].t=Date.now(); if(isPR) a[i].pr=true; touch(log);
      if(isPR){ native({type:'haptic',kind:'success'}); try{ navigator.vibrate&&navigator.vibrate([20,30,60]); }catch(e){} toast(`Record · ${ex.name} · e1RM ${Math.round(v)} kg (+${Math.round(v-prev)})`,'ok'); }
      else { native({type:'haptic'}); try{ navigator.vibrate&&navigator.vibrate(15); }catch(e){} }
      const last=i>=p.sets-1;
      if(!last){ startTimer(p.rest,`Repos · ${ex.name}`,`Série ${i+2}/${p.sets} · ${p.reps}${p.rir!=null?' @RIR '+p.rir:''}`); toast(`Série ${i+1} validée`); }
      else { const nx=ses.exercises[ex.n]; S.openEx=null; save(); if(nx) startTimer(Math.min(p.rest,120),`Suivant · ${nx.name}`,`${rx(nx,wk).sets} × ${rx(nx,wk).reps} · ${nx.machine}`); toast(`${ex.name} terminé`,'ok'); }
      renderSeance(); const c=el.querySelector('.ex.cur'); if(c&&last) c.scrollIntoView({block:'start',behavior:'smooth'});
    });
    const em=card.querySelector('[data-emom]'); if(em) em.onclick=()=>startTimer(p.rest,`EMOM · série ${arr().filter(s=>s&&s.done).length+1}/${p.sets}`,`${p.reps} reps strictes, repart au top`);
    const mb=card.querySelector('[data-menu]'); if(mb) mb.onclick=()=>{
      const flags=(log.flags||{})[exId]||{};
      const sheet=showSheet(`<h3>${esc(ex.name)}</h3><p class="small muted">${esc(ex.machine)}${ex.alt?' · alternative : '+esc(ex.alt):''}${ex.replaces?' · remplace '+esc(ex.replaces):''}</p>
        <div class="menu">
          <button data-act="explain">Voir le mouvement, pourquoi cet exercice, exécution</button>
          ${ex.url?`<a href="${esc(ex.url)}" target="_blank" rel="noopener" data-ext>Voir la machine ↗</a>`:''}
          <button data-act="alt">${flags.alt?'✓ Alternative utilisée (annuler)':'Machine absente, j\'utilise l\'alternative'}</button>
          <button data-act="skip">${flags.skip?'✓ Exercice sauté (annuler)':'Sauter cet exercice aujourd\'hui'}</button>
          <div class="row2"><span class="small muted">Chrono</span><button class="btn sm" data-rest="60">1:00</button><button class="btn sm" data-rest="120">2:00</button><button class="btn sm" data-rest="180">3:00</button></div>
        </div>`);
      sheet.querySelectorAll('[data-act]').forEach(x=>x.onclick=()=>{ const act=x.dataset.act; if(act==='explain'){ showDemo(ex); return; }
        log.flags=log.flags||{}; const f=log.flags[exId]||(log.flags[exId]={}); f[act]=!f[act]; touch(log); hideSheet(); if(act==='skip'&&f.skip) S.openEx=null; save(); renderSeance(); });
      sheet.querySelectorAll('[data-rest]').forEach(x=>x.onclick=()=>{ startTimer(+x.dataset.rest,`Repos · ${ex.name}`,''); hideSheet(); });
    };
  });
  const sb=$('#subBtn'); if(sb) sb.onclick=()=>{ const base=curSession(); const opts=[['halteres','Haltères'],['elastiques','Élastiques'],['kettlebell','Kettlebell'],['traction','Barre de traction'],['trx','TRX / sangles'],['banc','Banc'],['corps','Poids du corps']];
    const sheet=showSheet(`<h3>Pas de salle aujourd'hui</h3><p class="small muted">Le coach reconstruit ${esc(base.name)} avec ce que tu as. Coche ton matériel.</p><div class="chks" id="subGear">${opts.map(([v,l])=>`<label class="chk"><input type="checkbox" value="${v}" ${(PROFILE&&PROFILE.gear||[]).includes(v)?'checked':''}> ${l}</label>`).join('')}</div><label class="small muted" style="display:block;margin-top:10px">Précision (facultatif)<textarea id="subNote" rows="2" placeholder="Ex. : chambre d'hôtel, 20 minutes, genou sensible" style="width:100%;margin-top:6px"></textarea></label><button class="btn fill" id="subGo">Construire la séance</button><p class="small err" id="subMsg"></p>`);
    sheet.querySelector('#subGo').onclick=async()=>{ const gear=[...sheet.querySelectorAll('#subGear input:checked')].map(x=>x.value); const btn=sheet.querySelector('#subGo'); btn.disabled=true; btn.textContent=COACH_NAME+' construit la séance…'; startJob('reconstruit '+base.name,['Garde les mêmes muscles et la même intention','Choisit les exercices pour ton matériel','Règle séries, tempo et repos'],25000);
      try{ await callCoach({mode:'substitute',sessionId:base.id,gear,note:sheet.querySelector('#subNote').value,week:curWeek()}); endJob(true,'Séance prête'); hideSheet(); toast('Séance adaptée','ok'); }
      catch(e){ logErr('substitute',e); endJob(false,humanErr(e)); sheet.querySelector('#subMsg').textContent=humanErr(e); btn.disabled=false; btn.textContent='Réessayer'; } };
  };
  const so=$('#subOff'); if(so) so.onclick=()=>{ if(!USER) return; col('overrides').doc(curSession().id).set({substitute:firebase.firestore.FieldValue.delete(),updatedAt:Date.now()},{merge:true}).catch(()=>{}); toast('Séance prévue rétablie'); };
  $('#notes').onchange=e=>{ log.notes=e.target.value; touch(log); toast('Note enregistrée'); };
  updateElapsed(log);
  $('#endBtn').onclick=()=>{ log.done=!log.done; touch(log); stopTimer(); if(log.done){ releaseWake(); S.openEx=null; save(); healthExportSession(log); showSessionSummary(log); if(FOCUS){ FOCUS=false; document.body.classList.remove('focus'); } } renderSeance(); if(log.done) window.scrollTo({top:0}); };
}

let elapsedTimer=0;
function updateElapsed(log){
  clearInterval(elapsedTimer); const el=$('#elapsed'); if(!el) return;
  const ts=Object.values(log.sets).flat().filter(s=>s&&s.done&&s.t).map(s=>s.t); if(!ts.length){ el.textContent=''; return; }
  const start=Math.min(...ts); const end=log.done?Math.max(...ts):null;
  const f=()=>{ const m=Math.floor(((end||Date.now())-start)/60000); el.textContent=`· ${m} min${log.done?' · terminée':''}`; };
  f(); if(!log.done) elapsedTimer=setInterval(f,30000);
}
/* ---------- render: programme ---------- */

// Personnalisation visible : ce que le coach a pris en compte pour construire ce cycle. Programme générique (sans génération) signalé clairement.
const GOAL_FR={force:'force',masse:'masse',seche:'sèche',endurance:'endurance',puissance:'puissance',tractions:'tractions',jambes:'jambes',bras:'bras et pecs',sante:'santé',perf:'performance',perte:'perte de poids',fessiers:'fessiers',silhouette:'silhouette',cardio:'souffle'};
const GEAR_FR={salle:'salle',halteres:'haltères',barre:'barre',kettlebell:'kettlebell',elastiques:'élastiques',traction:'barre de traction',trx:'TRX',corps:'poids du corps',cardio:'cardio'};
function isGenericProgram(){ if(USER&&ADMIN_RE.test(USER.email||'')) return false; return !!(PROGRAM&&PROGRAM.sessions&&PROGRAM.sessions.length&&!PROGRAM.generatedAt); }
function builtForHtml(){
  if(isGenericProgram()) return `<div class="banner warn" id="genericBan"><b>Programme générique.</b> Ce cycle n'a pas été construit pour toi : ${esc(COACH_NAME)} peut en écrire un à partir de ton profil (objectifs, niveau, matériel, jours). <button class="btn sm" id="genericBtn">Construire mon programme</button></div>`;
  const ps=PROGRAM.profileSnapshot||PROFILE; if(!ps) return '';
  const deg=PROGRAM.degraded==='coach'?`<div class="banner warn" id="degradedBan"><b>Structure prête, commentaires du coach à venir.</b> ${esc(COACH_NAME)} n'a pas pu rédiger ses explications au moment de la génération : séances, séries, répétitions et repos sont déjà les bons, tu peux t'entraîner. <button class="btn sm" id="genericBtn">Compléter avec ${esc(COACH_NAME)}</button></div>`:'';
  const rep=(PROGRAM.engine&&PROGRAM.engine.repairs&&PROGRAM.engine.repairs.length)?`<p class="small">${esc(PROGRAM.engine.repairs.length)} exercice(s) ajusté(s) par le contrôle de conformité pour respecter ta fiche.</p>`:'';
  const goals=(ps.goals||[]).map(g=>GOAL_FR[g]||g).join(', '); const gear=(ps.gear||[]).map(g=>GEAR_FR[g]||g).join(', ');
  return deg+`<div class="builtfor"><span class="eyebrow">Construit pour ${esc(ps.name||'toi')}</span><p class="small">${esc([ps.level,goals,ps.days?ps.days+' séances/sem':'',ps.minutes?ps.minutes+' min':'',gear,ps.constraints?'contraintes : '+ps.constraints:''].filter(Boolean).join(' · '))}</p>${rep}</div>`;
}
// Promesse : valeur de départ (semaine 1) et valeur actuelle, mesurées dans l'app ; cible et jalons viennent du programme.
function promiseMetric(metric){
  const start=PROGRAM.weeks&&PROGRAM.weeks[0]?PROGRAM.weeks[0].from:null; const endW1=start?addDays(start,6):null;
  const logs=Object.values(S.logs||{}).filter(l=>!start||l.date>=start);
  if(metric==='e1rm'||metric==='e1rm_legs'){ const star=new Set(PROGRAM.sessions.flatMap(se=>se.exercises.filter(e=>e.star&&(metric==='e1rm'||['squat','hinge','lunge'].includes(e.pattern))).map(e=>e.id))); const first={}, best={}; logs.sort((a,b)=>a.date<b.date?-1:1).forEach(l=>Object.entries(l.sets||{}).forEach(([id,arr])=>{ if(!star.has(id)) return; (arr||[]).forEach(st=>{ if(!st||!st.done||!st.w||!st.r) return; const v=e1rm(st.w,st.r); if(endW1&&l.date<=endW1&&(!first[id]||v>first[id])) first[id]=v; if(!best[id]||v>best[id]) best[id]=v; }); })); const ids=Object.keys(first); if(!ids.length) return {base:null,now:null,unit:'%'}; const b=ids.reduce((t,id)=>t+first[id],0), n=ids.reduce((t,id)=>t+(best[id]||first[id]),0); return {base:0,now:Math.round(100*(n-b)/b*10)/10,unit:'%',note:ids.length+' exercice(s) prioritaire(s)'}; }
  if(metric==='pull'){ const t=Object.values(S.tests||{}).sort((a,b)=>a.date<b.date?-1:1).filter(x=>!start||x.date>=addDays(start,-14)); if(!t.length) return {base:null,now:null,unit:'reps'}; return {base:t[0].reps,now:Math.max(...t.map(x=>x.reps||0)),unit:'reps'}; }
  if(metric==='bw'){ const b=Object.values(S.bw||{}).sort((a,b)=>a.date<b.date?-1:1).filter(x=>!start||x.date>=addDays(start,-7)); if(!b.length) return {base:null,now:null,unit:'kg'}; return {base:b[0].kg||b[0].w||b[0].v,now:(b[b.length-1].kg||b[b.length-1].w||b[b.length-1].v),unit:'kg'}; }
  if(metric==='adherence'){ const planned=Object.values(S.logs||{}).filter(l=>start&&l.date>=start).length; const done=Object.values(S.logs||{}).filter(l=>start&&l.date>=start&&l.done).length; return {base:null,now:planned?Math.round(100*done/planned):null,unit:'%'}; }
  return {base:null,now:null,unit:''};
}
function promiseHtml(){
  const P=PROGRAM.promise; if(!P) return '';
  const m=promiseMetric(P.metric); const cyc=Math.min(3,Math.max(1,Math.ceil(curWeek()/Math.max(1,(PROGRAM.weeks||[]).length||4))));
  const val=m.now==null?'<em>à mesurer en S1</em>':(m.unit==='%'?(m.now>0?'+':'')+m.now+' %':m.now+' '+m.unit+(m.base!=null&&m.base!==m.now?' <span class="muted">(départ '+m.base+')</span>':''));
  const steps=(P.steps||[]).map((v,i)=>`<span class="pm-step ${i+1<cyc?'done':i+1===cyc?'now':''}"><b>C${i+1}</b>${v>0&&P.unit!=='kg'?'+':''}${v}${P.unit==='%'?' %':' '+P.unit}</span>`).join('');
  return `<div class="promise"><div class="eyebrow">Ta promesse</div><p class="pm-text">${esc(P.promise)}</p><div class="pm-row"><span><small>${esc(P.label)}</small><b>${val}</b></span><span><small>Cible 12 semaines</small><b>${esc(P.target)}</b></span></div><div class="pm-steps">${steps}</div><p class="small muted">Mesure : ${esc(P.measure)}. ${esc(P.baselineRule||'')}</p>${P.secondary?`<p class="small"><b>En second :</b> ${esc(P.secondary.label)}, ${esc(P.secondary.target)} (${esc(P.secondary.measure)}).</p>`:''}</div>`;
}
function recoveryHtml(){
  const R=PROGRAM.recovery; if(!R||!R.days||!R.days.length) return '';
  const today=new Date().getDay(); const d=R.days.find(x=>x.day===today)||R.days[0];
  return `<div class="recov"><div class="eyebrow">Jours sans séance · récupération</div><p class="small muted">${d.day===today?"Aujourd'hui":esc(d.dayName)}${d.after?' · après '+esc(d.after):''}${d.before?' · avant '+esc(d.before):''}</p><ul class="small">${d.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><details><summary class="small">Toute la semaine et les règles</summary>${R.days.filter(x=>x!==d).map(x=>`<p class="small"><b>${esc(x.dayName)}</b> : ${esc(x.items.slice(0,2).join(' '))}</p>`).join('')}<ul class="small">${(R.rules||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div>`;
}
function renderProgramme(){
  if(!$('#tab-programme')) return;
  const auto=weekFor(todayISO()), wk=curWeek(), today=new Date().getDay();
  const DN=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const W=WEEKS[wk-1]||{}; const mono=(W.rirNote||'').split('·')[0].trim();
  if(PROG_OPEN===undefined){ const t=sessionForDay(); PROG_OPEN=t?t.id:(PROGRAM.sessions[0]||{}).id; }
  let h=`<div class="phero"><div class="eyebrow">Cycle en cours</div><h2>${esc(String(PROGRAM.cycleName||'Programme').split(' · ')[0])}</h2>${String(PROGRAM.cycleName||'').includes(' · ')?`<p class="small muted" style="margin:0 0 8px">${esc(String(PROGRAM.cycleName).split(' · ').slice(1).join(' · '))}</p>`:''}${PROGRAM.cycleReason?`<p class="pwhy">${esc(PROGRAM.cycleReason)}</p>`:''}
    <div class="wkchips">${WEEKS.map((w,i)=>`<button data-wk="${i+1}" aria-pressed="${i+1===wk}"><b>S${i+1}</b><span>${i+1===auto?'en cours':esc(String(w.label||'').replace(/^S\d+\s*/,'').split(' ')[0])}</span></button>`).join('')}</div>
    <p class="small muted">${esc(String(W.label||'').replace(/^S\d+\s*/,''))}${mono?' · '+esc(mono):''}${W.from?' · '+fmtD(W.from)+'–'+fmtD(W.to):''}</p>
    ${builtForHtml()}
    <div class="row2"><button class="btn sm" id="cycBtn">Lire le cycle</button><button class="btn sm" id="regenBtn">Nouveau cycle avec Kai</button></div></div>${promiseHtml()}${recoveryHtml()}`;
  PROGRAM.sessions.forEach(s=>{
    const open=s.id===PROG_OPEN; const n=s.exercises.length; const sets=s.exercises.reduce((t,ex)=>t+(rx(ex,wk).sets||0),0);
    const prio=s.exercises.filter(e=>e.star).map(e=>e.name).slice(0,2);
    h+=`<div class="pses${open?' is-open':''}${s.day===today?' is-now':''}" data-ses="${s.id}"><button class="psh" data-toggle="${s.id}"><span class="pday"><b>${DN[s.day]||esc((s.dayName||'').slice(0,3))}</b></span><span class="pst"><b>${esc(s.name)}</b><span>${esc(s.sub)}</span></span><span class="pmeta">${n} exos</span><i></i></button>`;
    if(open){ h+=`<div class="pbody">`;
      s.exercises.forEach(ex=>{ const p=rx(ex,wk); const did=demoId(ex); h+=`<div class="prow" data-pex="${ex.id}">${did?`<img class="pimg" src="${demoImg(did,1)}" alt="" loading="lazy">`:`<span class="n">${ex.n}</span>`}<span class="nm">${esc(ex.name)}${ex.star?' <em class="pstar">prioritaire</em>':''}</span><span class="rx2">${p.sets}×${esc(p.reps)}</span></div>`; });
      h+=`<div class="row2 pgo"><button class="btn fill sm" data-go="${s.id}">Ouvrir la séance</button></div></div>`; }
    else if(prio.length) h+=`<div class="pprio">Priorité : ${esc(prio.join(', '))}</div>`;
    h+=`</div>`;
  });
  if(S.weekOverride) h+=`<p class="small muted center">Semaine ${wk} fixée à la main pour toute l'app (séances, charges) · <button class="link" id="wkAuto">Revenir au calcul automatique (S${auto})</button></p>`;
  $('#tab-programme').innerHTML=h;
  const rb=$('#regenBtn'); if(rb) rb.onclick=regenerateProgram; const gb=$('#genericBtn'); if(gb) gb.onclick=()=>regenerateProgram(true);
  $('#cycBtn').onclick=()=>showSheet(`<h3>${esc(PROGRAM.cycleName||'Le cycle')}</h3><div class="doc">${cycleHtml()}</div>`);
  $('#tab-programme').querySelectorAll('[data-wk]').forEach(b=>b.onclick=()=>setWeek(+b.dataset.wk));
  const wa=$('#wkAuto'); if(wa) wa.onclick=()=>setWeek(null);
  $('#tab-programme').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{ PROG_OPEN=PROG_OPEN===b.dataset.toggle?null:b.dataset.toggle; renderProgramme(); });
  $('#tab-programme').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{ S.session=b.dataset.go; S.sessionDate=todayISO(); save(); showTab('seance'); });
  $('#tab-programme').querySelectorAll('[data-pex]').forEach(r=>r.onclick=()=>{ const ex=PROGRAM.sessions.flatMap(x=>x.exercises).find(e=>e.id===r.dataset.pex); if(ex) showDemo(ex); });
}
let PROG_OPEN, RENDER_UNLOCK_T=null, GEN_STATE=null;
// Semaine active pour toute l'app : choisie à la main (Programme ou pastille de semaine en Séance), sinon calculée.
function setWeek(n){ const auto=weekFor(todayISO()); S.weekOverride=(n&&n!==auto)?n:null; save(); render(); toast(S.weekOverride?`Semaine ${n} activée`:`Semaine automatique : S${auto}`,'ok'); }
function showWeekPicker(){ const auto=weekFor(todayISO()), wk=curWeek(); showSheet(`<h3>Semaine du cycle</h3><p class="small muted">La semaine détermine les séries, les répétitions et les consignes de RIR de chaque séance. Calcul automatique : S${auto}${S.weekOverride?' · actuellement fixée à S'+wk:''}.</p><div class="wkpick">${WEEKS.map((w,i)=>`<button class="row" data-pick="${i+1}" aria-pressed="${i+1===wk}"><span><b>S${i+1}</b> · ${esc(String(w.label||'').replace(/^S\d+\s*/,''))}<br><small class="muted">${esc(w.rirNote||'')}</small></span>${i+1===wk?'<i class="chkmark"></i>':''}</button>`).join('')}</div>${S.weekOverride?`<button class="btn" id="wkAutoBtn">Revenir au calcul automatique (S${auto})</button>`:''}`); document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{ hideSheet(); setWeek(+b.dataset.pick); }); const a=$('#wkAutoBtn'); if(a) a.onclick=()=>{ hideSheet(); setWeek(null); }; }


/* ---------- suivi enrichi : groupes musculaires, assiduité, records ---------- */
const MUSCLE_RULES=[['Quadriceps',/quadri|vaste|droit fémoral/i],['Ischios',/ischio|biceps fémoral|semi/i],['Fessiers',/fessier|glute/i],['Mollets',/mollet|soléaire|gastroc/i],['Pectoraux',/pector|pec|grand pectoral/i],['Épaules',/deltoïde|épaule|deltoid/i],['Dos',/dorsal|grand dorsal|trapèze|rhombo|dos\b/i],['Biceps',/biceps(?! fémoral)|brachial/i],['Triceps',/triceps/i],['Abdos',/abdo|gainage|obliques|transverse/i],['Avant-bras',/avant-bras|préhension|grip/i]];
function muscleOf(ex){ const t=(ex.target||'')+' '+(ex.name||''); for(const [m,re] of MUSCLE_RULES){ if(re.test(t)) return m; } return null; }
function weekBounds(k){ const start=WEEKS[0].from; return [addDays(start,k*7),addDays(start,k*7+6)]; }
function suiviStats(){
  const today=todayISO(); const start=WEEKS[0].from;
  const curK=Math.floor(Math.round((new Date(today+'T12:00:00')-new Date(start+'T12:00:00'))/86400000)/7); const nWeeks=Math.max(WEEKS.length,Math.min(8,curK+1));
  const idx={}; PROGRAM.sessions.forEach(s=>s.exercises.forEach(e=>idx[e.id]=e));
  const weeks=[]; for(let k=0;k<nWeeks;k++){ const [a,b]=weekBounds(k); const logs=Object.values(S.logs).filter(l=>l.date>=a&&l.date<=b); const done=logs.filter(l=>l.done).length; const sets={}; let total=0,tonnage=0; logs.forEach(l=>Object.entries(l.sets||{}).forEach(([exId,arr])=>{ const ex=idx[exId]; const m=ex?muscleOf(ex)||'Autre':'Autre'; (arr||[]).forEach(st=>{ if(st&&st.done){ sets[m]=(sets[m]||0)+1; total++; tonnage+=(st.w||0)*(st.r||0); } }); })); weeks.push({k,a,b,done,planned:PROGRAM.sessions.length,sets,total,tonnage,future:a>today}); }
  // records : meilleure e1RM par exercice, et date du record
  const prs=[]; const best={};
  Object.values(S.logs).sort((x,y)=>x.date<y.date?-1:1).forEach(l=>Object.entries(l.sets||{}).forEach(([exId,arr])=>{ const ex=idx[exId]; if(!ex||ex.mode==='emom') return; (arr||[]).forEach(st=>{ if(!st||!st.done||!st.w||!st.r) return; const v=e1rm(st.w,st.r); if(!best[exId]||v>best[exId].v+0.01){ const isNew=!!best[exId]; best[exId]={v,date:l.date,w:st.w,r:st.r}; if(isNew) prs.push({exId,name:ex.name,date:l.date,w:st.w,r:st.r,v:Math.round(v*10)/10}); } }); }));
  const byDay={}; prs.forEach(p=>{ const k=p.exId+'_'+p.date; if(!byDay[k]||p.v>byDay[k].v) byDay[k]=p; });
  return {weeks,prs:Object.values(byDay).sort((a,b)=>a.date<b.date?1:-1).slice(0,6),best};
}

/* ---------- render: suivi ---------- */
let suiviEx=null;
let SUIVI_VIEW='forme';
function sparkSvg(pts,opts){ // petite courbe SVG : pts = [{x:label,v}], opts {h, goal, best}
  const o=opts||{}; const W=600,H=o.h||140,pl=o.pl||40,pr=12,pt=14,pb=o.labels===false?8:22; if(pts.length<1) return '';
  const vals=pts.map(p=>p.v); let mn=Math.min(...vals,o.goal!=null?o.goal:Infinity), mx=Math.max(...vals,o.goal!=null?o.goal:-Infinity); if(mn===mx){ mn-=1; mx+=1; } const pad=(mx-mn)*0.08; mn-=pad; mx+=pad;
  const x=i=>pts.length===1?(pl+W-pr)/2:pl+(W-pl-pr)*i/(pts.length-1), y=v=>pt+(H-pt-pb)*(1-(v-mn)/(mx-mn));
  const path=pts.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(p.v).toFixed(1)).join(' ');
  const area=pts.length>1?`<path class="a" d="${path} L${x(pts.length-1).toFixed(1)},${(H-pb).toFixed(1)} L${x(0).toFixed(1)},${(H-pb).toFixed(1)} Z"/>`:'';
  const ticks=[mn+pad,mx-pad].map(v=>`<line class="g" x1="${pl}" x2="${W-pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="4" y="${(y(v)+4).toFixed(1)}">${o.fmt?o.fmt(v):Math.round(v*10)/10}</text>`).join('');
  const goal=o.goal!=null?`<line class="goal" x1="${pl}" x2="${W-pr}" y1="${y(o.goal).toFixed(1)}" y2="${y(o.goal).toFixed(1)}"/><text class="gl" x="${W-pr}" y="${(y(o.goal)-5).toFixed(1)}" text-anchor="end">objectif ${o.fmt?o.fmt(o.goal):o.goal}</text>`:'';
  const dots=pts.map((p,i)=>`<circle class="d ${p.best?'best':''}" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.best?5:3.5}"/>`).join('');
  const step=Math.max(1,Math.ceil(pts.length/6)); const labels=o.labels===false?'':pts.map((p,i)=>(i%step===0||i===pts.length-1)?`<text x="${x(i).toFixed(1)}" y="${H-6}" text-anchor="${i===0?'start':i===pts.length-1?'end':'middle'}">${esc(p.x)}</text>`:'').join('');
  return `<svg class="spark2" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ticks}${goal}${area}<path class="l" d="${path}"/>${dots}${labels}</svg>`;
}
function suiviForce(){ // force globale : somme des meilleurs e1RM des exercices polyarticulaires, par semaine effective
  const idx={}; PROGRAM.sessions.forEach(se=>se.exercises.forEach(e=>idx[e.id]=e));
  const byWeek={}; Object.values(S.logs).forEach(l=>{ Object.entries(l.sets||{}).forEach(([exId,arr])=>{ const ex=idx[exId]; if(!ex||ex.mode==='emom') return; const best=(arr||[]).reduce((m,st)=>st&&st.done&&st.w&&st.r?Math.max(m,e1rm(st.w,st.r)):m,0); if(!best) return; const k=weekRaw(l.date); byWeek[k]=byWeek[k]||{}; byWeek[k][exId]=Math.max(byWeek[k][exId]||0,best); }); });
  const weeks=Object.keys(byWeek).map(Number).sort((a,b)=>a-b); if(!weeks.length) return null;
  // comparaison honnête : uniquement les exercices présents à la fois dans la première et la dernière semaine
  const lastW=weeks[weeks.length-1]; const ids=Object.keys(byWeek[weeks[0]]).filter(id=>byWeek[lastW][id]);
  const usable=ids.length>=2?ids:Object.keys(byWeek[lastW]);
  const pts=weeks.map(w=>({x:'S'+w,v:Math.round(usable.reduce((a,id)=>a+(byWeek[w][id]||0),0)),full:usable.every(id=>byWeek[w][id])})).filter(p=>p.v>0&&p.full);
  const first=pts[0]&&pts[0].v, lastV=pts[pts.length-1]&&pts[pts.length-1].v; const delta=ids.length>=2&&pts.length>1&&first&&lastV?Math.round(100*(lastV-first)/first):null;
  return {pts:pts.length?pts:[{x:'S'+lastW,v:Math.round(usable.reduce((a,id)=>a+(byWeek[lastW][id]||0),0))}],delta,n:usable.length};
}
function renderSuivi(){
  const el=$('#tab-suivi'); if(!el) return; const date=todayISO();
  const views=[['forme','Forme'],['force','Force'],['corps','Corps'],['journal','Journal']];
  let h=`<div class="suivih"><h2>Progrès</h2></div><div class="seg" role="tablist">${views.map(([k,l])=>`<button role="tab" aria-selected="${SUIVI_VIEW===k}" data-view="${k}">${l}</button>`).join('')}</div>`;
  h+=`<div class="sview">${({forme:suiviForme,force:suiviForceView,corps:suiviCorps,journal:suiviJournal})[SUIVI_VIEW](date)}</div>`;
  el.innerHTML=h;
  el.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{ SUIVI_VIEW=b.dataset.view; renderSuivi(); });
  el.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
  bindSuivi(el,date);
}
function suiviForme(date){
  const st=suiviStats(); const cur=st.weeks.filter(w=>!w.future).slice(-1)[0]||st.weeks[0];
  const bws=Object.values(S.bw).sort((a,b)=>a.date<b.date?1:-1); const tests=Object.values(S.tests).sort((a,b)=>a.date<b.date?1:-1);
  // série de semaines consécutives avec au moins une séance
  let streak=0; for(let i=st.weeks.length-1;i>=0;i--){ const w=st.weeks[i]; if(w.future) continue; if(w.done>0) streak++; else break; }
  const pct=Math.round(100*cur.done/Math.max(1,cur.planned)); const r=34, c=2*Math.PI*r;
  let h=`<div class="hero"><div class="ring"><svg viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="${r}"/><circle class="fg" cx="40" cy="40" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c*(1-Math.min(1,cur.done/Math.max(1,cur.planned)))).toFixed(1)}"/></svg><div class="rv"><b>${cur.done}</b><span>/ ${cur.planned}</span></div></div>
    <div class="herot"><p class="eyebrow">Cette semaine</p><b>${cur.done===0?'Pas encore de séance':cur.done>=cur.planned?'Semaine complète':pct+' % du plan'}</b><span class="muted">${cur.total} série${cur.total>1?'s':''}${cur.tonnage?' · '+(Math.round(cur.tonnage/100)/10)+' t soulevées':''}${streak>1?' · '+streak+' semaines d\'affilée':''}</span></div></div>`;
  // tendances
  const f=suiviForce(); const bw7=bws.filter(b=>b.date>=addDays(date,-7)); const bw28=bws.filter(b=>b.date>=addDays(date,-35)&&b.date<addDays(date,-28));
  const avg=a=>a.length?a.reduce((x,b)=>x+b.kg,0)/a.length:null; const w7=avg(bw7), w28=avg(bw28);
  const trend=(d,unit,inv)=>d==null?'<i class="flat">—</i>':`<i class="${d>0?(inv?'down':'up'):d<0?(inv?'up':'down'):'flat'}">${d>0?'+':''}${d}${unit}</i>`;
  h+=`<div class="trends">
    <button class="tr" data-view="force"><span class="l">Force</span><b>${f&&f.pts.length?f.pts[f.pts.length-1].v+' kg':'—'}</b>${f&&f.delta!=null?trend(f.delta,' %'):'<i class="flat">cycle en cours</i>'}<small>somme des <span class="lx" data-lex="e1rm">e1RM</span>, ${f?f.n:0} exercices</small></button>
    <button class="tr" data-view="corps"><span class="l">Poids</span><b>${w7!=null?w7.toFixed(1)+' kg':bws[0]?bws[0].kg.toFixed(1)+' kg':'—'}</b>${w7!=null&&w28!=null?trend(Math.round((w7-w28)*10)/10,' kg',true):'<i class="flat">moyenne 7 j</i>'}<small>${w28!=null?'sur 4 semaines':'pèse-toi 2 à 3 fois par semaine'}</small></button>
    <button class="tr" data-view="corps"><span class="l">${esc(refTest().short)}</span><b>${tests[0]?tests[0].reps:'—'}</b>${tests.length>1?trend(tests[0].reps-tests[tests.length-1].reps,''):'<i class="flat">max d\'affilée</i>'}<small>${PROFILE&&PROFILE.pullGoal?'objectif '+PROFILE.pullGoal:tests[0]?'dernier test '+fmtD(tests[0].date):'fais un test'}</small></button></div>`;
  // semaines
  const maxSets=Math.max(1,...st.weeks.map(w=>w.total));
  h+=`<div class="card"><div class="card-h"><b>Semaines</b><span class="muted">séances faites · séries</span></div><div class="wkbars">${st.weeks.map(w=>`<div class="wkb ${w===cur?'cur':''} ${w.future?'fut':''}"><div class="bar"><i style="height:${Math.round(100*w.total/maxSets)}%"></i></div><div class="dots2">${Array.from({length:w.planned},(_,i)=>`<i class="${i<w.done?'ok':''}"></i>`).join('')}</div><span>S${w.k+1}</span></div>`).join('')}</div></div>`;
  // équilibre musculaire
  const groups=Object.entries(cur.sets).sort((a,b)=>b[1]-a[1]);
  if(groups.length){ h+=`<div class="card"><div class="card-h"><b>Équilibre musculaire</b><span class="muted">séries cette semaine</span></div><div class="mus2">${groups.map(([m,n])=>{ const cls=n<10?'low':n>20?'high':'ok'; return `<div class="musr ${cls}"><span>${esc(m)}</span><div class="bar"><i class="band"></i><i class="v" style="width:${Math.min(100,Math.round(100*n/24))}%"></i></div><b>${n}</b></div>`; }).join('')}</div><p class="small muted">Zone grise : 10 à 20 séries par semaine, la fourchette qui fait progresser. En dessous, c\'est de l\'entretien ; au-dessus, la récupération ne suit plus.</p></div>`; }
  // records
  if(st.prs.length) h+=`<div class="card"><div class="card-h"><b>Records</b><span class="muted">meilleure estimation du max</span></div><div class="prs2">${st.prs.map(p=>`<button class="pr2" data-ex="${p.exId}"><i>🏅</i><div><b>${esc(p.name)}</b><span>${p.w} kg × ${p.r} · <span class="lx" data-lex="e1rm">e1RM</span> ${p.v} kg</span></div><em>${fmtD(p.date)}</em></button>`).join('')}</div></div>`;
  else h+=`<div class="card"><div class="card-h"><b>Records</b></div><p class="muted">Dès que tu dépasses ton meilleur max estimé sur un exercice, il apparaît ici.</p></div>`;
  // mot de Kai (dernier bilan)
  const bilan=COACH.items.find(i=>i.type==='bilan'||i.type==='cycleEnd'); if(bilan) h+=`<div class="card coachcard" id="suiviBilan" role="button"><div class="card-h"><b>${coachAvatar('idle','xs')} ${esc(COACH_NAME)} · bilan</b><span class="muted">${bilan.createdAt?new Date(bilan.createdAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):''}</span></div><p>${lexify(esc(String(bilan.analysis||'').slice(0,220)))}${String(bilan.analysis||'').length>220?'…':''}</p></div>`;
  return h;
}
function suiviForceView(){
  const all=PROGRAM.sessions.flatMap(se=>se.exercises.map(e=>({...e,sname:se.name}))); if(!suiviEx||!all.find(e=>e.id===suiviEx)) suiviEx=(all.find(e=>history(e.id).length)||all[0]||{}).id;
  const f=suiviForce();
  let h='';
  if(f&&f.pts.length>1) h+=`<div class="card"><div class="card-h"><b>Force globale</b><span class="${f.delta>0?'up':f.delta<0?'down':'muted'}">${f.delta>0?'+':''}${f.delta} % depuis le début du cycle</span></div>${sparkSvg(f.pts,{h:120,fmt:v=>Math.round(v)})}<p class="small muted">Somme des <button class="lx" data-lex="e1rm">e1RM</button> de tes ${f.n} exercices suivis, par semaine du cycle. C\'est la courbe qui résume si tu deviens plus fort.</p></div>`;
  h+=`<div class="chips" id="exChips">${PROGRAM.sessions.map(se=>`<div class="chipgrp"><span class="eyebrow">${esc(se.name)}</span>${se.exercises.filter(e=>e.mode!=='emom').map(e=>`<button class="chip2 ${e.id===suiviEx?'on':''}" data-ex="${e.id}">${esc(shortName(e.name))}</button>`).join('')}</div>`).join('')}</div>`;
  const ex=all.find(e=>e.id===suiviEx); const hist=history(suiviEx).slice().reverse(); const best=hist.reduce((m,x)=>Math.max(m,...x.sets.map(s=>e1rm(s.w,s.r))),0);
  if(!ex) return h;
  if(!hist.length) return h+`<div class="card"><div class="card-h"><b>${esc(ex.name)}</b></div><p class="muted">Pas encore de séries validées. Dès ta première séance, la courbe démarre ici.</p></div>`;
  const pts=hist.map(x=>{ const v=Math.round(x.sets.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0)*10)/10; return {x:fmtD(x.date),v,best:v>=best-0.01}; });
  const first=pts[0].v,last=pts[pts.length-1].v; const d=first?Math.round(100*(last-first)/first):0; const top=hist[hist.length-1].sets.reduce((m,s)=>e1rm(s.w,s.r)>e1rm(m.w,m.r)?s:m,hist[hist.length-1].sets[0]);
  h+=`<div class="card"><div class="card-h"><b>${esc(ex.name)}</b><span class="${d>0?'up':d<0?'down':'muted'}">${d>0?'+':''}${d} %</span></div><div class="exbig"><div><b>${last} kg</b><span><button class="lx" data-lex="e1rm">e1RM</button> actuel</span></div><div><b>${top.w} × ${top.r}</b><span>meilleure série, dernière fois</span></div><div><b>${Math.round(best*10)/10} kg</b><span>record</span></div></div>${sparkSvg(pts,{h:150,fmt:v=>Math.round(v)})}
    <div class="hl2">${hist.slice().reverse().slice(0,8).map((x,i,arr)=>{ const v=pts[pts.length-1-i].v; const prev=pts[pts.length-2-i]; const dv=prev?Math.round((v-prev.v)*10)/10:null; return `<div class="hrow"><span class="d">${fmtD(x.date)} · S${x.week}</span><span class="s">${esc(fmtSetsNice(x.sets))}</span><b>${v}${dv!=null?`<i class="${dv>0?'up':dv<0?'down':'flat'}">${dv>0?'+':''}${dv}</i>`:''}</b></div>`; }).join('')}</div></div>`;
  return h;
}
function suiviCorps(date){
  const bws=Object.values(S.bw).sort((a,b)=>a.date<b.date?-1:1); const tests=Object.values(S.tests).sort((a,b)=>a.date<b.date?-1:1);
  const lastBw=bws[bws.length-1]; const base=lastBw?lastBw.kg:(PROFILE&&PROFILE.weight)||70;
  const avg7=bws.filter(b=>b.date>=addDays(date,-7)); const m7=avg7.length?(avg7.reduce((a,b)=>a+b.kg,0)/avg7.length):null;
  let h=`<div class="card"><div class="card-h"><b>Poids de corps</b><span class="muted">${m7!=null?'moyenne 7 j '+m7.toFixed(1)+' kg':''}</span></div>
    <div class="bwbig"><b>${lastBw?lastBw.kg.toFixed(1):'—'}</b><span>kg${lastBw?' · '+fmtD(lastBw.date):''}</span></div>
    ${bws.length>1?sparkSvg(bws.slice(-30).map(b=>({x:fmtD(b.date),v:b.kg})),{h:120,fmt:v=>v.toFixed(1),goal:PROFILE&&PROFILE.targetWeight||null}):'<p class="small muted">Deux pesées et la courbe apparaît. Le matin à jeun, 2 à 3 fois par semaine : c\'est la moyenne qui compte, pas la pesée du jour.</p>'}
    <div class="quick"><button class="step" data-bw="-0.1">−</button><input type="number" step="0.1" inputmode="decimal" id="bwKg" value="${base.toFixed(1)}"><button class="step" data-bw="0.1">+</button><input type="date" id="bwDate" value="${date}"><button class="btn fill" id="bwAdd">Enregistrer</button></div></div>`;
  const goal=refTest().goal; const lastT=tests[tests.length-1];
  h+=`<div class="card"><div class="card-h"><b>${esc(refTest().short)}</b><span class="muted">${esc(refTest().label)}</span></div>
    <div class="bwbig"><b>${lastT?lastT.reps:'—'}</b><span>${refTest().unit}${lastT?' · '+fmtD(lastT.date):''}</span></div>
    ${goal&&lastT?`<div class="goalbar"><i style="width:${Math.min(100,Math.round(100*lastT.reps/goal))}%"></i><span>${Math.min(100,Math.round(100*lastT.reps/goal))} % de l\'objectif ${goal}</span></div>`:''}
    ${tests.length>1?sparkSvg(tests.slice(-20).map(t=>({x:fmtD(t.date),v:t.reps})),{h:110,fmt:v=>Math.round(v),goal}):'<p class="small muted">Un test toutes les 3 à 4 semaines, frais, en début de séance. Pas plus souvent : le test fatigue.</p>'}
    <div class="quick"><input type="number" inputmode="numeric" id="tReps" placeholder="reps"><input type="date" id="tDate" value="${date}"><button class="btn fill" id="tAdd">Enregistrer</button></div></div>`;
  return h;
}
function suiviJournal(){
  const logs=Object.values(S.logs).filter(l=>Object.values(l.sets||{}).flat().some(x=>x&&x.done)||l.notes).sort((a,b)=>a.date<b.date?1:-1);
  if(!logs.length) return `<div class="empty"><b>Journal vide</b><p class="small muted">Chaque séance avec des séries validées apparaît ici.</p></div>`;
  const st=suiviStats(); const prDays=new Set(st.prs.map(p=>p.date)); const idx={}; PROGRAM.sessions.forEach(se=>se.exercises.forEach(e=>idx[e.id]=e));
  let h='', curW=null;
  logs.forEach(l=>{ const w=weekRaw(l.date); if(w!==curW){ curW=w; h+=`<p class="eyebrow jw">Semaine ${w}${WEEKS[w-1]?' · '+esc(String(WEEKS[w-1].label).replace(/^S\d+\s*/,'')):''}</p>`; }
    const ses=PROGRAM.sessions.find(x=>x.id===l.session); const sets=Object.values(l.sets||{}).flat().filter(x=>x&&x.done); const ton=sets.reduce((a,s)=>a+(s.w||0)*(s.r||0),0); const nEx=Object.entries(l.sets||{}).filter(([k,a])=>(a||[]).some(x=>x&&x.done)).length;
    h+=`<button class="jrow ${l.done?'':'open'}" data-log="${esc(logKey(l.date,l.session))}"><div class="jd"><b>${new Date(l.date+'T12:00:00').getDate()}</b><span>${new Date(l.date+'T12:00:00').toLocaleDateString('fr-FR',{month:'short'})}</span></div><div class="jt"><b>${ses?esc(ses.name):esc(l.session)}${prDays.has(l.date)?' <em class="prtag">record</em>':''}${l.done?'':' <em class="tag">en cours</em>'}</b><span>${nEx} exercice${nEx>1?'s':''} · ${sets.length} série${sets.length>1?'s':''}${ton?' · '+(Math.round(ton/100)/10)+' t':''}${l.notes?' · « '+esc(l.notes.slice(0,40))+(l.notes.length>40?'…':'')+' »':''}</span></div><i>›</i></button>`; });
  return h;
}
function showLogSheet(key){
  const l=S.logs[key]; if(!l) return; const ses=PROGRAM.sessions.find(x=>x.id===l.session); const idx={}; PROGRAM.sessions.forEach(se=>se.exercises.forEach(e=>idx[e.id]=e));
  const ana=COACH.items.find(i=>i.logKey===key);
  let h=`<h3>${ses?esc(ses.name):esc(l.session)} · ${fmtD(l.date)}</h3><p class="small muted">Semaine ${l.week}${l.done?' · terminée':' · non terminée'}</p><div class="hl2">`;
  Object.entries(l.sets||{}).forEach(([exId,arr])=>{ const done=(arr||[]).filter(x=>x&&x.done); if(!done.length) return; const ex=idx[exId]; h+=`<div class="hrow"><span class="d">${ex?esc(ex.name):exId}</span><span class="s">${esc(fmtSetsNice(done))}</span><b>${ex&&ex.mode!=='emom'?Math.round(done.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0)):''}</b></div>`; });
  h+=`</div>${l.notes?`<p class="small"><b>Notes :</b> ${esc(l.notes)}</p>`:''}${ana?`<p class="coachline"><b>${esc(COACH_NAME)}</b> ${lexify(esc(String(ana.analysis||'').slice(0,300)))}</p>`:''}<div class="row2">${ana?`<button class="btn" id="logCoach">Voir l\'analyse</button>`:`<button class="btn fill" id="logAna">Demander l\'analyse à ${esc(COACH_NAME)}</button>`}<button class="btn" onclick="hideSheet()">Fermer</button></div>`;
  const sh=showSheet(h);
  const a=sh.querySelector('#logAna'); if(a) a.onclick=()=>{ hideSheet(); analyseSession(key); showTab('coach'); };
  const c=sh.querySelector('#logCoach'); if(c) c.onclick=()=>{ hideSheet(); showTab('coach'); };
}
function bindSuivi(el,date){
  const ba=$('#bwAdd'); if(ba) ba.onclick=()=>{ const d=$('#bwDate').value, kg=parseFloat($('#bwKg').value); if(!d||isNaN(kg)) return; S.bw[d]={date:d,kg,updatedAt:Date.now()}; save(); writeDoc('bw',d,S.bw[d]); toast('Pesée enregistrée','ok'); renderSuivi(); };
  el.querySelectorAll('[data-bw]').forEach(b=>b.onclick=()=>{ const i=$('#bwKg'); i.value=(Math.round((parseFloat(i.value||0)+parseFloat(b.dataset.bw))*10)/10).toFixed(1); });
  const ta=$('#tAdd'); if(ta) ta.onclick=()=>{ const d=$('#tDate').value, r=parseInt($('#tReps').value); if(!d||isNaN(r)) return; S.tests[d]={date:d,reps:r,updatedAt:Date.now()}; save(); writeDoc('tests',d,S.tests[d]); toast('Test enregistré','ok'); renderSuivi(); };
  el.querySelectorAll('.chip2[data-ex]').forEach(b=>b.onclick=()=>{ suiviEx=b.dataset.ex; renderSuivi(); });
  el.querySelectorAll('.pr2[data-ex]').forEach(b=>b.onclick=()=>{ suiviEx=b.dataset.ex; SUIVI_VIEW='force'; renderSuivi(); });
  el.querySelectorAll('.tr[data-view]').forEach(b=>b.onclick=()=>{ SUIVI_VIEW=b.dataset.view; renderSuivi(); });
  el.querySelectorAll('[data-log]').forEach(b=>b.onclick=()=>showLogSheet(b.dataset.log));
  const sb=$('#suiviBilan'); if(sb) sb.onclick=()=>showTab('coach');
  const chips=$('#exChips'); if(chips){ const on=chips.querySelector('.chip2.on'); if(on) on.scrollIntoView({block:'nearest',inline:'center'}); }
}
function addDays(iso,n){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function renderHist(){
  const hist=history(suiviEx).slice().reverse(); const el=$('#exHist'); const ex=PROGRAM.sessions.flatMap(s=>s.exercises).find(e=>e.id===suiviEx);
  if(!hist.length){ el.innerHTML=`<p class="muted small">Pas encore de séries validées pour ${esc(ex.name)}.</p>`; return; }
  const isEmom=ex.mode==='emom';
  const pts=hist.map(h=>isEmom?h.sets.reduce((a,s)=>a+(s.r||0),0):Math.round(h.sets.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0)*10)/10);
  let svg='';
  if(pts.length>=2){ const W=600,H=120,pl=36,pr=10,pt=12,pb=20; const mn=Math.min(...pts),mx=Math.max(...pts); const lo=mn===mx?mn-1:mn, hi=mn===mx?mx+1:mx; const x=i=>pl+(W-pl-pr)*i/(pts.length-1), y=v=>pt+(H-pt-pb)*(1-(v-lo)/(hi-lo)); svg=`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="g" x1="${pl}" x2="${W-pr}" y1="${y(lo)}" y2="${y(lo)}"/><line class="g" x1="${pl}" x2="${W-pr}" y1="${y(hi)}" y2="${y(hi)}"/><text x="2" y="${y(hi)+4}">${hi}</text><text x="2" y="${y(lo)+4}">${lo}</text><polyline class="l" points="${pts.map((v,i)=>x(i)+','+y(v)).join(' ')}"/>${pts.map((v,i)=>`<circle class="d" cx="${x(i)}" cy="${y(v)}" r="3"/>`).join('')}${hist.map((h,i)=>`<text x="${x(i)}" y="${H-6}" text-anchor="middle">${fmtD(h.date)}</text>`).join('')}</svg>`; }
  el.innerHTML=`<p class="small muted">${isEmom?'Reps par séance':'<button class="lx" data-lex="e1rm">e1RM</button> par séance'}</p>${svg}<div class="tw"><table><thead><tr><th>Date</th><th>S</th><th>Séries</th><th>${isEmom?'Total':'e1RM'}</th></tr></thead><tbody>${hist.slice().reverse().map((h,i)=>`<tr><td class="num">${fmtD(h.date)}</td><td class="num">${h.week}</td><td class="num">${esc(fmtSets(h.sets))}</td><td class="num">${pts[pts.length-1-i]}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- tabs, week ---------- */
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); if(b.dataset.tab==='coach'){ S.coachSeen=Date.now(); save(); b.classList.remove('badge'); } showTab(b.dataset.tab); });
// La barre flottante se range quand on défile vers le bas, revient dès qu'on remonte ou qu'on arrive en bas de page.
(function(){ let last=0, acc=0; const tabs=document.querySelector('.tabs'); if(!tabs) return; window.addEventListener('scroll',()=>{ const y=window.scrollY; const dy=y-last; last=y; if(FOCUS||y<40||y+window.innerHeight>=document.documentElement.scrollHeight-40){ tabs.classList.remove('hide'); acc=0; return; } acc=Math.max(-80,Math.min(80,acc+dy)); if(acc>50) tabs.classList.add('hide'); else if(acc<-20) tabs.classList.remove('hide'); },{passive:true}); })();
const TAB_SCROLL={};
function showTab(tab){ const tb=document.querySelector('.tabs'); if(tb) tb.classList.remove('hide');
  const curTab=(document.querySelector('.tabs button[aria-selected="true"]')||{}).dataset; if(curTab&&curTab.tab&&curTab.tab!==tab) TAB_SCROLL[curTab.tab]=window.scrollY; document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x.dataset.tab===tab)); ['home','seance','coach','programme','suivi','reglages'].forEach(t=>{ const s=$('#tab-'+t); if(s) s.hidden=t!==tab; }); document.body.classList.toggle('chatmode',tab==='coach'&&COACH.view==='chat'); if(tab!=='seance') exitFocus(); const y=tab==='seance'?0:(TAB_SCROLL[tab]||0); window.scrollTo({top:y}); requestAnimationFrame(()=>window.scrollTo({top:y})); }
$('#settingsBtn').onclick=()=>showTab('reglages');
$('#weekChip').onclick=()=>{ const auto=weekFor(todayISO()); const cur=curWeek(); const nx=cur%WEEKS.length+1; S.weekOverride=nx===auto?null:nx; save(); render(); };
document.addEventListener('pointerdown',unlockAudio,{once:true});
document.addEventListener('pointerdown',()=>{ if(window.Notification&&Notification.permission==='default'){ try{Notification.requestPermission();}catch(e){} } },{once:true});

/* ---------- démarrage ---------- */
async function boot(){
  if(!Object.keys(S.logs).length){ const j=await idbGet(); if(j){ try{ const d=JSON.parse(j); if(Object.keys(d.logs||{}).length) S=Object.assign(S,d); for(const k of ['logs','bw','tests','chats','checkins','overrides']){ if(!S[k]||typeof S[k]!=='object') S[k]={}; } }catch(e){} } }
  applyTheme(); try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme); }catch(e){}
  DEFAULT_PROGRAM=null; DEFAULT_CYCLE_HTML=''; // aucun programme embarqué : chaque compte reçoit uniquement le cycle construit pour lui
  if(!window.firebase){ $('#tab-seance').innerHTML='<p>Connexion au service impossible. Ouvre l\'application avec du réseau une première fois.</p>'; return; }
  let hadUser=false; try{ hadUser=localStorage.getItem('rituel.hadUser')==='1'; }catch(e){}
  if(hadUser) showSplash(); else showGate();
  initFirebase();
  if('serviceWorker' in navigator){
    // Mise à jour automatique : quand un nouveau service worker prend la main, on recharge (sauf chrono en cours, on attend la fin de la séance).
    let refreshing=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(refreshing) return; refreshing=true; if($('#timer')&&$('#timer').classList.contains('on')){ setSync('pend','mise à jour prête'); return; } location.reload(); });
    navigator.serviceWorker.register('sw.js').then(r=>{ r.update().catch(()=>{}); setInterval(()=>r.update().catch(()=>{}),60*60*1000); r.addEventListener('updatefound',()=>{ const w=r.installing; w&&w.addEventListener('statechange',()=>{ if(w.state==='installed'&&navigator.serviceWorker.controller) setSync('pend','mise à jour…'); }); }); }).catch(()=>{});
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) navigator.serviceWorker.getRegistration().then(r=>r&&r.update().catch(()=>{})); });
  }
}
boot();
