
/* Journal d'erreurs local (Réglages → Diagnostic) : ce que l'utilisateur voit, on peut le lire. */
const ERRLOG=[]; function logErr(src,e){ try{ const msg=(e&&(e.message||e.code))||String(e); ERRLOG.unshift({t:Date.now(),src,msg:String(msg).slice(0,300),code:e&&e.code||''}); ERRLOG.splice(30); localStorage.setItem('rituel.errlog',JSON.stringify(ERRLOG)); }catch(x){} }
try{ (JSON.parse(localStorage.getItem('rituel.errlog')||'[]')||[]).forEach(x=>ERRLOG.push(x)); }catch(e){}
window.addEventListener('error',e=>logErr('js',e.error||e.message)); window.addEventListener('unhandledrejection',e=>logErr('promise',e.reason));
function humanErr(e){ const c=(e&&e.code)||''; const m=(e&&e.message)||String(e||'');
  if(/unauthenticated/.test(c)) return 'Reconnecte-toi pour utiliser le coach.';
  if(/resource-exhausted/.test(c)) return m;
  if(/failed-precondition/.test(c)) return m;
  if(/not-found/.test(c)) return 'Séance introuvable : ouvre-la depuis l\'onglet Séance puis relance.';
  if(/deadline|timeout/i.test(m)) return 'Le coach a mis trop de temps à répondre. Réessaie dans une minute.';
  if(/network|Failed to fetch|internet/i.test(m)||!navigator.onLine) return 'Pas de réseau. Le coach a besoin d\'une connexion ; tes séries sont enregistrées et partiront toutes seules.';
  if(/invalid-argument/.test(c)) return 'Le serveur n\'a pas compris la demande (version de l\'app en retard ?). Recharge l\'application depuis Réglages.';
  return m; }
const APP_VERSION='3.13.2';
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
const NATIVE = !!(window.ReactNativeWebView);
function native(msg){ if(!NATIVE) return; try{ window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }catch(e){} }
function onNativeMessage(ev){ let m; try{ m=JSON.parse(ev.data); }catch(e){ return; } if(!m||!m.type) return;
  if(m.type==='pushToken'&&m.token){ PUSH_TOKEN=m.token; PUSH_PLATFORM=m.platform||''; savePushToken(); }
  if(m.type==='notificationOpened'){ const b=document.querySelector('.tabs button[data-tab="coach"]'); if(b&&!b.hidden) b.click(); }
  if(m.type==='resume'&&$('#timer')&&$('#timer').classList.contains('on')) tick(); }
let PUSH_TOKEN=null, PUSH_PLATFORM='';
function savePushToken(){ if(!PUSH_TOKEN||!USER||!fbDb) return; try{ const FV=firebase.firestore.FieldValue; col('meta').doc('push').set({expo:FV&&FV.arrayUnion?FV.arrayUnion(PUSH_TOKEN):[PUSH_TOKEN],platform:PUSH_PLATFORM,updatedAt:Date.now()},{merge:true}).catch(()=>{}); }catch(e){} }
window.addEventListener('message',onNativeMessage); document.addEventListener('message',onNativeMessage);

/* ---------- state ---------- */
const KEY='rituel.v1';
let S = {logs:{}, bw:{}, tests:{}, chats:{}, overrides:{}, weekOverride:null, session:null, wake:true, openEx:null};
try{ const raw=localStorage.getItem(KEY); if(raw) S=Object.assign(S,JSON.parse(raw)); }catch(e){}
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
function curSession(){ return PROGRAM.sessions.find(s=>s.id===S.session)||sessionForDay()||PROGRAM.sessions[0]; }

function rx(ex, wk){ // prescription for a week (cycle de 3 à 6 semaines, la dernière en décharge)
  const L=WEEKS.length, last=wk>=L;
  if(ex.mode==='emom'){ const w=ex.weeks[Math.min(wk-1,ex.weeks.length-1)]; return {sets:w.sets,reps:w.reps,rir:null,rest:last?120:90,restText:last?'2 min':'90 s'}; }
  let sets=ex.sets; if(ex.star&&wk>1&&!last) sets+=1; if(last) sets=ex.s4sets||Math.max(1,Math.round(ex.sets*0.6));
  let rir=null; if(ex.rir){ rir=last?ex.rir[ex.rir.length-1]:ex.rir[Math.min(wk-1,Math.max(0,ex.rir.length-2))]; }
  return {sets, reps:ex.reps, rir, rest:ex.restSec, restText:ex.restText};
}
function logKey(date,sid){ return date+'_'+sid; }
function getLog(date,sid){ const k=logKey(date,sid); if(!S.logs[k]) S.logs[k]={date,session:sid,week:weekFor(date),sets:{},gtg:[false,false,false],notes:'',done:false,updatedAt:0}; return S.logs[k]; }
function touch(log){ log.updatedAt=Date.now(); save(); writeDoc('logs',logKey(log.date,log.session),log); requestWake(); }


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
  restoreShell(); setSync('pend','connexion…'); listenMeta(); savePushToken();
  // 1. pousser le local vers Firestore (fusion par updatedAt, jamais d'écrasement du plus récent)
  await pushLocalToRemote();
  // 2. écouter Firestore : la source de vérité devient le cloud (copie locale gérée par Firestore)
  const listen=(name, key)=>unsubs.push(col(name).onSnapshot(snap=>{
    applyingRemote=true; let changed=false;
    snap.docChanges().forEach(ch=>{ const d=ch.doc.data(); const id=ch.doc.id;
      if(ch.type==='removed'){ delete S[key][id]; changed=true; return; }
      if(!S[key][id]||(d.updatedAt||0)>=(S[key][id].updatedAt||0)){ S[key][id]=d; changed=true; } });
    applyingRemote=false; if(changed){ save(); render(); }
    setSync(snap.metadata.hasPendingWrites?'pend':'on', snap.metadata.hasPendingWrites?'à sync':'sync ok');
  }, err=>{ console.warn(name,err); logErr('listen '+name,err); setSync('pend','sync erreur'); }));
  listen('logs','logs'); listen('bw','bw'); listen('tests','tests'); listen('chats','chats');
  unsubs.push(col('coach').orderBy('createdAt','desc').limit(30).onSnapshot(snap=>{ COACH.items=snap.docs.map(d=>({id:d.id,...d.data()})); renderCoach(); if(PROGRAM_LOADED) renderHome(); }));
  unsubs.push(col('overrides').onSnapshot(snap=>{ S.overrides={}; snap.docs.forEach(d=>S.overrides[d.id]=d.data()); save(); if(PROGRAM_LOADED) renderSeance(); }));
  renderReglages();
}
async function pushLocalToRemote(){
  const batchWrites=[];
  for(const [name,key] of [['logs','logs'],['bw','bw'],['tests','tests'],['chats','chats']]){
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
function mergeInto(local, remote){ let changed=false; for(const c of ['logs','bw','tests','chats']){ const L=local[c]||(local[c]={}), R=(remote&&remote[c])||{}; for(const k in R){ if(!L[k]||(R[k].updatedAt||0)>(L[k].updatedAt||0)){ L[k]=R[k]; changed=true; writeDoc(c,k,R[k]); } } } return changed; }
function snapshot(){ return {version:1, exportedAt:new Date().toISOString(), logs:S.logs, bw:S.bw, tests:S.tests}; }
window.addEventListener('online',syncStatusIdle); window.addEventListener('offline',syncStatusIdle);
$('#syncChip').onclick=()=>{};

/* ---------- réglages ---------- */
function renderReglages(){
  const el=$('#tab-reglages'); if(!el) return;
  const notifState=window.Notification?({granted:'autorisées',denied:'refusées',default:'non demandées'}[Notification.permission]||Notification.permission):'non supporté';
  const usage=USAGE?`${(USAGE.analyse||0)+(USAGE.chat||0)+(USAGE.program||0)} appels · ${((USAGE.costUsd||0)*0.92).toFixed(2).replace('.',',')} €`:'aucun appel ce mois-ci';
  el.innerHTML=`<h2>Réglages</h2>
  ${USER?`<div class="acct"><div class="av">${esc((USER.displayName||USER.email||'?').slice(0,1).toUpperCase())}</div><div><b>${esc(USER.displayName||'')}</b><div class="small muted">${esc(USER.email||'')}${USER.providerData&&USER.providerData.some(p=>p.providerId==='password')&&!USER.emailVerified?' · <button class="link" id="verifBtn">e-mail non vérifié, renvoyer</button>':''}</div></div></div>`:''}
  <div class="grp"><div class="grp-t">Athlète</div>
    <button class="row" id="profBtn"><span>Mon profil</span><span class="muted">${esc(PROFILE&&PROFILE.level?({debutant:'débutant',intermediaire:'intermédiaire',confirme:'confirmé',avance:'avancé'}[PROFILE.level]||''):'')}</span><i></i></button>
    <button class="row" id="lexBtn"><span>Lexique</span><span class="muted">RIR, tempo, décharge…</span><i></i></button>
    <button class="row" id="progBtn"><span>Programme en cours</span><span class="muted">${esc(PROGRAM.cycleName||'—')}</span><i></i></button>
  </div>
  <div class="grp"><div class="grp-t">Coach ce mois-ci</div>
    <div class="row"><span>Usage</span><span class="muted">${usage}</span></div>
    ${USAGE?`<div class="row"><span>Détail</span><span class="muted">${USAGE.analyse||0} analyses · ${USAGE.chat||0} questions · ${USAGE.program||0} programme${(USAGE.program||0)>1?'s':''}</span></div>`:''}
  </div>
  <div class="grp"><div class="grp-t">Séance</div>
    <label class="row"><span>Écran allumé pendant la séance</span><input type="checkbox" class="sw" id="wakeOpt" ${S.wake!==false?'checked':''}></label>
    ${NATIVE?`<div class="row"><span>Notifications</span><span class="muted">${PUSH_TOKEN?'activées':'gérées par le téléphone'}</span></div>`:`<button class="row" id="notifBtn"><span>Notifications de fin de repos</span><span class="muted">${notifState}</span><i></i></button>`}
  </div>
  <div class="grp"><div class="grp-t">Données</div>
    <button class="row" id="expBtn"><span>Exporter mon journal (JSON)</span><i></i></button>
    <label class="row" for="impFile"><span>Importer un journal</span><i></i></label><input id="impFile" type="file" accept="application/json" hidden>
    <a class="row" href="confidentialite.html" target="_blank" rel="noopener"><span>Politique de confidentialité</span><i></i></a>
  </div>
  <div class="grp">
    ${USER?`<button class="row" id="signOut"><span>Se déconnecter</span></button>`:''}
    ${USER?`<button class="row danger" id="delBtn"><span>Supprimer mon compte et mes données</span></button>`:''}
  </div>
  <div class="grp"><button class="row" id="diagBtn"><span>Diagnostic</span><span class="muted">${ERRLOG.length?ERRLOG.length+' erreur'+(ERRLOG.length>1?'s':''):'aucune erreur'}</span><i></i></button></div>
  <p class="small muted center">Rituel ${APP_VERSION} · <button class="link" id="reloadBtn">Recharger l'application</button></p>
`;
  const so=$('#signOut'); if(so) so.onclick=()=>{ if(confirm('Se déconnecter ? Tes données restent sur ton compte.')) signOut(); };
  const db_=$('#delBtn'); if(db_) db_.onclick=async()=>{ if(!confirm('Supprimer définitivement ton compte, ton programme et tout ton journal ? Cette action est irréversible.')) return; if(prompt('Tape SUPPRIMER pour confirmer')!=='SUPPRIMER') return; try{ const fn=fbFn.httpsCallable('deleteAccount'); await fn({}); try{ localStorage.clear(); }catch(e){} alert('Compte supprimé.'); location.reload(); }catch(e){ alert('Échec : '+(e.message||e)+'. Si le message parle de connexion récente, déconnecte-toi, reconnecte-toi puis réessaie.'); } };
  const vb=$('#verifBtn'); if(vb) vb.onclick=async()=>{ try{ await USER.sendEmailVerification(); vb.textContent='lien envoyé'; }catch(e){ vb.textContent='échec : '+e.message; } };
  $('#profBtn').onclick=()=>{ if(!USER) return; const sheet=showSheet(`<h3>Mon profil</h3>`+profileForm(PROFILE||{})); bindProfileForm(()=>{ hideSheet(); toast('Profil enregistré','ok'); renderReglages(); }, sheet); };
  $('#progBtn').onclick=()=>document.querySelector('.tabs button[data-tab="programme"]').click();
  $('#diagBtn').onclick=()=>{ const recent=Object.values(S.logs).filter(l=>Object.keys(l.sets||{}).length||l.done).sort((a,b)=>a.date<b.date?1:-1).slice(0,8).map(l=>`${l.date} ${l.session} ${l.done?'terminée':'en cours'} ${Object.values(l.sets||{}).flat().filter(x=>x&&x.done).length} séries`).join('\n');
    const txt=`Rituel ${APP_VERSION} · ${NATIVE?'app':'web'} · ${navigator.userAgent}\nSession : ${USER?USER.uid.slice(0,6)+'…':'aucune'} · réseau : ${navigator.onLine?'oui':'non'} · programme : ${PROGRAM_LOADED?'chargé':'absent'} · journal local : ${Object.keys(S.logs).length} séances\n\nDernières séances locales :\n${recent||'(aucune)'}\n\n`+(ERRLOG.length?ERRLOG.map(e=>`${new Date(e.t).toLocaleString('fr-FR')} · ${e.src} · ${e.code?e.code+' · ':''}${e.msg}`).join('\n'):'Aucune erreur enregistrée.');
    const sh=showSheet(`<h3>Diagnostic</h3><pre class="diag" id="diagTxt">${esc(txt)}</pre><div class="row2"><button class="btn" id="diagCopy">Copier</button><button class="btn sm" id="diagSync">Vérifier la synchro</button><button class="btn sm" id="diagClear">Effacer</button></div>`);
    sh.querySelector('#diagCopy').onclick=async()=>{ try{ await navigator.clipboard.writeText($('#diagTxt').textContent); toast('Copié'); }catch(e){ toast('Sélectionne le texte pour le copier'); } };
    // Compare chaque séance locale au serveur et renvoie ce qui manque, en capturant l'erreur exacte s'il y en a une.
    sh.querySelector('#diagSync').onclick=async()=>{ const b=sh.querySelector('#diagSync'); if(!USER||!navigator.onLine){ toast('Connexion et réseau nécessaires'); return; } b.disabled=true; b.textContent='Vérification…'; const lines=[]; let missing=0, sent=0, fail=0;
      for(const [k,l] of Object.entries(S.logs)){ if(!Object.keys(l.sets||{}).length&&!l.done) continue; try{ const snap=await col('logs').doc(k).get({source:'server'}); const r=snap.exists?snap.data():null; if(!r||(l.updatedAt||0)>(r.updatedAt||0)){ missing++; try{ await col('logs').doc(k).set(JSON.parse(JSON.stringify(l))); sent++; }catch(e){ fail++; lines.push(`${k} : échec envoi · ${e.code||''} ${e.message||e}`); logErr('resync '+k,e); } } }catch(e){ lines.push(`${k} : lecture serveur impossible · ${e.code||''} ${e.message||e}`); } }
      lines.unshift(`Synchro : ${Object.keys(S.logs).length} séances locales · ${missing} absentes ou plus récentes que le cloud · ${sent} renvoyées · ${fail} échec${fail>1?'s':''}`);
      $('#diagTxt').textContent=lines.join('\n')+'\n\n'+$('#diagTxt').textContent; b.textContent='Vérifié'; toast(fail?'Erreurs de synchro, copie le diagnostic':'Synchro vérifiée','ok'); };
    sh.querySelector('#diagClear').onclick=()=>{ ERRLOG.length=0; try{ localStorage.removeItem('rituel.errlog'); }catch(e){} hideSheet(); renderReglages(); }; };
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
function coachAvatar(state,size){ return `<span class="cav ${state||'idle'} ${size||''}" aria-hidden="true"><i class="mk"></i><i class="ring"></i><i class="dot"></i></span>`; }
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
  const res=await fn(payload); return res.data;
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
function newThread(){ const id='c'+Date.now().toString(36); S.chats[id]={id,createdAt:Date.now(),updatedAt:Date.now(),title:'',messages:[]}; COACH.threadId=id; COACH.thread=S.chats[id].messages; return S.chats[id]; }
function openThread(id){ const t=S.chats&&S.chats[id]; if(!t) return; COACH.threadId=id; COACH.thread=t.messages; COACH.listOpen=false; renderChatSheet(); }
function saveThread(){ const t=curThread(); if(!t) return; t.updatedAt=Date.now(); if(!t.title){ const u=t.messages.find(m=>m.role==='user'); t.title=u?u.content.slice(0,60):''; } save(); writeDoc('chats',t.id,t); }
function deleteThread(id){ if(!S.chats[id]) return; delete S.chats[id]; save(); if(USER){ try{ const r=col('chats').doc(id); if(r.delete) r.delete().catch(()=>{}); }catch(e){} } if(COACH.threadId===id){ COACH.threadId=null; COACH.thread=[]; } renderChatSheet(); renderCoach(); }
async function askCoach(text){
  if(!text.trim()||COACH.busy) return; if(!curThread()) newThread(); COACH.busy=true; COACH.thread.push({role:'user',content:text,t:Date.now()}); saveThread(); renderCoach();
  startJob('réfléchit',['Relit ton programme et ton journal','Rédige la réponse'],10000);
  try{ const r=await callCoach({mode:'chat', messages:COACH.thread.slice(-12), week:curWeek(), session:curSession().id}); COACH.thread.push({role:'assistant',content:r.text||'',t:Date.now()}); endJob(true,'Réponse prête'); }
  catch(e){ logErr('chat',e); COACH.thread.push({role:'assistant',content:humanErr(e),error:true,t:Date.now()}); endJob(false,humanErr(e)); }
  saveThread(); COACH.busy=false; renderCoach();
}
function applyOverride(item){
  if(!USER||!item.adjustments) return;
  const bySession={};
  item.adjustments.forEach(a=>{ const sid=a.exId.split('-')[0]; (bySession[sid]=bySession[sid]||{}); bySession[sid][a.exId]=a; });
  Object.entries(bySession).forEach(([sid,adj])=>col('overrides').doc(sid).set({adj, fromCoach:item.id, updatedAt:Date.now()},{merge:true}));
  col('coach').doc(item.id).set({applied:true},{merge:true});
}
function renderCoach(){
  const el=$('#tab-coach'); if(!el||!PROGRAM_LOADED||!PROGRAM.sessions.length) return;
  const lastItem=COACH.items[0]; const lastAt=lastItem&&lastItem.createdAt?new Date(lastItem.createdAt):null;
  const stateTxt=COACH.busy?'Au travail…':lastAt?`En veille · dernier passage ${lastAt.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} à ${lastAt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`:'En veille · aucune analyse encore';
  let h=`<div class="chead">${coachAvatar(COACH.busy?'busy':'idle','lg')}<div><h2>${esc(COACH_NAME)}</h2><p class="cstate ${COACH.busy?'busy':''}">${esc(stateTxt)}</p></div></div>`;
  if(!USER){ h+=`<p class="small muted">Connecte-toi (Réglages) pour activer le Coach : analyse de chaque séance, ajustement des charges, réponses sur ta progression.</p>`; el.innerHTML=h; return; }
  const date=todayISO(), ses=curSession(), log=S.logs[logKey(date,ses.id)];
  const todayAnalysed=COACH.items.some(i=>i.logKey===logKey(date,ses.id));
  const hasSets=!!(log&&Object.keys(log.sets||{}).length);
  // État du coach : ce qu'il surveille et la prochaine action utile.
  const wk=curWeek(), W=WEEKS[wk-1]||{}; const a=WEEKS[0]?addDays(WEEKS[0].from,Math.max(0,Math.floor(Math.round((new Date(date+'T12:00:00')-new Date(WEEKS[0].from+'T12:00:00'))/86400000)/7))*7):date;
  const weekDone=Object.values(S.logs).filter(l=>l.done&&l.date>=a&&l.date<=addDays(a,6)).length;
  const pending=COACH.items.find(i=>i.adjustments&&i.adjustments.length&&!i.applied&&i.type!=='bilan');
  const missing=Object.entries(S.logs).filter(([k,l])=>l.done&&l.date>=addDays(date,-14)&&l.date<date&&Object.values(l.sets||{}).flat().some(x=>x&&x.done)&&!COACH.items.some(i=>i.logKey===k)).sort((x,y)=>x[1].date<y[1].date?-1:1).map(([k])=>k);
  let act='';
  if(COACH.busy) act=`<button class="btn acc" disabled>Analyse en cours…</button>`;
  else if(missing.length) act=`<button class="btn fill" id="anaMissing">Analyser ${missing.length} séance${missing.length>1?'s':''} non analysée${missing.length>1?'s':''}</button>`;
  else if(hasSets&&!todayAnalysed) act=`<button class="btn fill" id="anaBtn">Analyser la séance du jour</button>`;
  else if(pending) act=`<button class="btn fill" data-apply="${esc(pending.id)}">Appliquer les charges · ${esc(pending.title||'')}</button>`;
  else if(hasSets&&todayAnalysed) act=`<button class="btn" id="anaBtn">Ré-analyser la séance du jour</button>`;
  h+=`<div class="cstat ${pending||(hasSets&&!todayAnalysed)||missing.length?'needs':''}"><div class="cs-grid"><div><b>S${wk}</b><span>${esc(String(W.label||'').replace(/^S\d+\s*/,''))} · ${esc((W.rirNote||'').split('·')[0].trim())}</span></div><div><b>${weekDone}/${PROGRAM.sessions.length}</b><span>séances cette semaine</span></div><div><b>Dim. 19h</b><span>bilan hebdomadaire</span></div></div>
    <p class="small muted">${pending?'Des charges ajustées attendent d\'être appliquées à la prochaine séance.':hasSets&&!todayAnalysed?'Ta séance du jour a des séries enregistrées : lance l\'analyse pour fixer les charges suivantes.':'Il analyse chaque séance terminée, relance après 3 jours sans séance et prépare le cycle suivant.'}</p>
    <div class="row2">${act}<button class="btn ${act?'':'fill'}" id="chatBtn">Parler à ${esc(COACH_NAME)}${Object.keys(S.chats||{}).length?' · '+Object.keys(S.chats).length+' conv.':''}</button></div></div>`;
  h+=`<h3>Analyses</h3>`;
  if(!COACH.items.length) h+=`<div class="empty"><div class="ic">◎</div><b>Pas encore d'analyse</b><p class="small muted">Termine une séance : ${esc(COACH_NAME)} l'analyse et fixe les charges de la prochaine.</p></div>`;
  const weekAgo=Date.now()-7*86400000; const older=[];
  COACH.items.forEach(it=>{
    if(!it.type&&it.logKey){ const lg=S.logs[it.logKey]; if(lg&&!Object.values(lg.sets||{}).flat().some(x=>x&&x.done)) return; }
    if(it.type==='nudge'&&(it.createdAt||0)<weekAgo){ older.push(it); return; }
    if(it.type==='bilan'||it.type==='cycleEnd'||it.type==='nudge'){
      const lbl={ok:'OK',up:'En hausse',hold:'Stable',warn:'Attention'};
      h+=`<div class="ana ${it.type}"><div class="anah">${coachAvatar('idle','xs')}<b>${esc(it.title||'')}</b><span class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''}</span></div>`;
      if(it.analysis) h+=`<div class="anab">${lexify(esc(it.analysis)).replace(/\n/g,'<br>')}</div>`;
      if(it.highlights&&it.highlights.length) h+=`<div class="hl">${it.highlights.map(x=>`<div class="hli s-${esc(x.status||'ok')}"><span class="v">${esc(x.value)}</span><span class="l">${esc(x.label)}</span></div>`).join('')}</div>`;
      if(it.alerts&&it.alerts.length) h+=`<div class="banner">${it.alerts.map(esc).join('<br>')}</div>`;
      if(it.nextWeek) h+=`<p class="coachline"><b>Semaine prochaine</b> ${lexify(esc(it.nextWeek))}</p>`;
      if(it.type==='cycleEnd') h+=`<div class="adj"><button class="btn fill" id="nextCycleBtn">Générer le cycle suivant avec le coach</button></div>`;
      if(it.type==='nudge') h+=`<div class="adj"><button class="btn sm acc" data-goseance>Ouvrir la séance du jour</button></div>`;
      h+=`</div>`; return;
    }
    const adjBy={}; (it.adjustments||[]).forEach(a=>adjBy[a.exId]=a);
    const exs=(it.exercises&&it.exercises.length)?it.exercises:(it.adjustments||[]).map(a=>({exId:a.exId,name:a.name,done:'',read:a.reason,status:'up'}));
    const lbl={ok:'OK',up:'Charger',hold:'Plus de reps',warn:'À revoir'};
    const needs=it.adjustments&&it.adjustments.length&&!it.applied; h+=`<div class="ana ${needs?'needs':''}"><div class="anah">${coachAvatar(needs?'attention':'idle','xs')}<b>${esc(it.title||it.logKey||'')}</b>${needs?'<span class="tag">à appliquer</span>':''}<span class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''}</span></div>`;
    if(it.analysis){ const long=it.analysis.length>420; h+=`<div class="anab ${long?'clamp':''}" data-clamp>${lexify(esc(it.analysis)).replace(/\n/g,'<br>')}</div>${long?'<button class="link" data-unclamp>Lire la suite</button>':''}`; }
    if(exs.length){
      h+=`<div class="exl2">`+exs.map(e=>{ const a=adjBy[e.exId]; const fx=findEx(e.exId); return `<div class="exc ${fx&&demoId(fx)?'hasimg':''}">${fx?demoThumb(fx):''}<div class="l1"><b>${esc(e.name)}</b><span class="st s-${esc(e.status||'ok')}">${lbl[e.status]||'OK'}</span></div><div class="l2"><span class="done">${esc(e.done||'—')}</span>${a?`<span class="arrow">→</span><span class="next">${esc(a.change)}</span>`:''}</div></div>`; }).join('')+`</div>`;
      h+=`<details class="more" open><summary>Le détail de ${esc(COACH_NAME)}</summary><div class="exl">${exs.map(e=>{ const a=adjBy[e.exId]; return `<div class="exr s-${esc(e.status||'ok')}"><i></i><div><b>${esc(e.name)}</b><div class="read">${lexify(esc(e.read||''))}${a&&a.reason?' <span class="muted">— '+lexify(esc(a.reason))+'</span>':''}</div></div></div>`; }).join('')}</div></details>`;
    }
    if(it.questions&&it.questions.length) h+=`<div class="cq">${coachAvatar('attention','xs')}<div><b>${esc(COACH_NAME)} te demande</b>${it.questions.map(q=>`<p>${esc(q)} <button class="link" data-ask="${esc(q)}">Répondre</button></p>`).join('')}</div></div>`;
    if(it.cue) h+=`<p class="coachline cue"><b>Point technique</b> ${lexify(esc(it.cue))}</p>`;
    if(it.nextFocus) h+=`<p class="coachline"><b>Prochaine fois</b> ${lexify(esc(it.nextFocus))}</p>`;
    if(it.adjustments&&it.adjustments.length){ h+=`<div class="adj">${it.applied?'<span class="tag ok">appliqué à la prochaine séance</span>':`<button class="btn sm acc" data-apply="${it.id}">Appliquer ces charges à la prochaine séance</button>`}</div>`; }
    h+=`</div>`;
  });
  if(older.length) h+=`<details class="more"><summary>Relances passées (${older.length})</summary>${older.map(it=>`<p class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''} · ${esc(it.title||'')}</p>`).join('')}</details>`;
  el.innerHTML=h;
  el.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>{ COACH.chatOpen=true; renderChatSheet(); const i=$('#askInput'); if(i){ i.value='Tu me demandes : « '+b.dataset.ask+' » — '; i.focus(); i.setSelectionRange(i.value.length,i.value.length); } });
  el.querySelectorAll('[data-unclamp]').forEach(b=>b.onclick=()=>{ b.previousElementSibling.classList.remove('clamp'); b.remove(); });
  const ab=$('#anaBtn'); if(ab) ab.onclick=()=>analyseSession(logKey(date,ses.id));
  const am=$('#anaMissing'); if(am) am.onclick=async()=>{ for(const k of missing){ await analyseSession(k); } };
  const cb=$('#chatBtn'); if(cb) cb.onclick=()=>{ COACH.chatOpen=true; renderChatSheet(); };
  if(COACH.chatOpen) renderChatSheet();
  el.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>applyOverride(COACH.items.find(i=>i.id===b.dataset.apply)));
  const nc=$('#nextCycleBtn'); if(nc) nc.onclick=()=>{ document.querySelector('.tabs button[data-tab="programme"]').click(); regenerateProgram(); };
  el.querySelectorAll('[data-goseance]').forEach(b=>b.onclick=()=>document.querySelector('.tabs button[data-tab="seance"]').click());
  updateCoachBadge();
}
// Clavier iOS : la feuille reste collée au-dessus du clavier (visualViewport), sinon le champ de saisie est masqué.
(function(){ const vv=window.visualViewport; if(!vv) return; const fix=()=>{ const s=$('#sheet'); if(!s||!s.classList.contains('on')) return; const card=s.querySelector('.sheet-card'); const kb=Math.max(0,window.innerHeight-vv.height-vv.offsetTop); card.style.bottom=kb+'px'; card.style.maxHeight=(vv.height-24)+'px'; const inp=document.activeElement; if(kb&&inp&&card.contains(inp)) setTimeout(()=>inp.scrollIntoView({block:'nearest'}),50); }; vv.addEventListener('resize',fix); vv.addEventListener('scroll',fix); })();
function renderChatSheet(){
  const s0=$('#sheet'); if(COACH.chatOpen&&s0&&s0.classList.contains('on')&&!s0.querySelector('.chatpane')){ COACH.chatOpen=false; return; }
  const threads=Object.values(S.chats||{}).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const t=curThread(); if(!t&&!COACH.listOpen&&threads.length&&!COACH.thread.length){ COACH.threadId=threads[0].id; COACH.thread=threads[0].messages; }
  const cur=curThread();
  let body='';
  if(COACH.listOpen||!cur){
    body=`<div class="chat-list">${threads.length?threads.map(x=>`<div class="crow"><button class="copen" data-open-thread="${x.id}"><b>${esc(x.title||'Conversation')}</b><span>${new Date(x.updatedAt||x.createdAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} · ${x.messages.length} message${x.messages.length>1?'s':''}</span></button><button class="cdel" data-del-thread="${x.id}" aria-label="Supprimer">🗑</button></div>`).join(''):`<p class="small muted center">Aucune conversation encore.</p>`}</div><button class="btn fill" id="chatNew">Nouvelle conversation</button>`;
  } else {
    const msgs=cur.messages.map(m=>`<div class="msg ${m.role} ${m.error?'err':''}">${(m.role==='assistant'?lexify(esc(m.content)):esc(m.content)).replace(/\n/g,'<br>')}</div>`).join('')||`<p class="small muted center">Charges, douleur, garde, nutrition, remplacement d'un exercice : ${esc(COACH_NAME)} connaît ton programme et ton historique.</p>`;
    body=`<div class="chat">${msgs}${COACH.busy&&cur.messages.length&&cur.messages[cur.messages.length-1].role==='user'?`<div class="msg assistant typing" aria-label="${esc(COACH_NAME)} écrit"><i></i><i></i><i></i></div>`:''}</div>
      <form class="ask" id="askForm"><textarea id="askInput" rows="1" placeholder="Écris à ${esc(COACH_NAME)}…" enterkeyhint="send"></textarea><button class="send" type="submit" aria-label="Envoyer" ${COACH.busy?'disabled':''}><svg viewBox="0 0 24 24"><path d="M4 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>`;
  }
  const sheet=showSheet(`<div class="chatpane"><div class="chead sm">${coachAvatar(COACH.busy?'busy':'idle')}<h3>${COACH.listOpen||!cur?'Conversations':esc(COACH_NAME)}</h3><div class="chtools">${cur&&!COACH.listOpen?`<button class="ico" id="chatList" aria-label="Conversations" title="Conversations"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button><button class="ico" id="chatNew" aria-label="Nouvelle conversation" title="Nouvelle"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>`:''}<button class="ico" id="chatClose" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div></div>${body}</div>`);
  sheet.classList.add('tall');
  const c=sheet.querySelector('.chat'); if(c) c.scrollTop=c.scrollHeight;
  const cl=$('#chatClose'); if(cl) cl.onclick=hideSheet;
  const ls=$('#chatList'); if(ls) ls.onclick=()=>{ COACH.listOpen=true; renderChatSheet(); };
  const nw=$('#chatNew'); if(nw) nw.onclick=()=>{ newThread(); COACH.listOpen=false; renderChatSheet(); };
  sheet.querySelectorAll('[data-open-thread]').forEach(b=>b.onclick=()=>openThread(b.dataset.openThread));
  sheet.querySelectorAll('[data-del-thread]').forEach(b=>b.onclick=()=>{ if(confirm('Supprimer cette conversation ?')) deleteThread(b.dataset.delThread); });
  const f=$('#askForm'); if(f){ const ta=$('#askInput');
    const grow=()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,140)+'px'; }; ta.oninput=grow; grow();
    f.onsubmit=e=>{ e.preventDefault(); const v=ta.value; if(!v.trim()) return; ta.value=''; grow(); askCoach(v); };
    ta.onkeydown=e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); f.requestSubmit(); } };
    if(!COACH.busy&&cur.messages.length) ta.focus({preventScroll:true}); }
}
function updateCoachBadge(){ const t=document.querySelector('.tabs button[data-tab="coach"]'); if(!t) return; const seen=S.coachSeen||0; const n=COACH.items.filter(i=>(i.createdAt||0)>seen).length; t.classList.toggle('badge',n>0&&t.getAttribute('aria-selected')!=='true'); }

/* ---------- Palier 2 : profil et programme par utilisateur ----------
   users/{uid}/meta/profile  — qui est l'athlète (saisi à la première connexion, modifiable dans Réglages)
   users/{uid}/meta/program  — son programme, généré par le coach à partir du profil (ou importé)
   Sans compte : écran d'accueil uniquement. */
let PROFILE=null, USAGE=null, PROGRAM_LOADED=false, DEFAULT_PROGRAM=null, DEFAULT_CYCLE_HTML='';
const GOALS=[['force','Force maximale'],['masse','Prise de muscle'],['seche','Sécher, se dessiner'],['endurance','Endurance musculaire'],['puissance','Puissance, vitesse'],['tractions','Tractions (nombre)'],['jambes','Rattraper les jambes'],['bras','Bras et pectoraux'],['sante','Santé, mobilité, dos'],['perf','Performance sportive / opérationnelle']];
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
function showOnboarding(step){
  restoreShell(); document.querySelector('.tabs').hidden=true; $('#weekChip').hidden=true;
  const m=document.querySelector('main');
  if(step==='profile'||!PROFILE){ onbStep(0); return; }
  m.innerHTML=`<section class="onb"><div class="onb-prog"><i style="width:100%"></i></div><h2>Ton programme</h2>
    <div class="kaisay">${coachAvatar('idle')}<p>J'ai ce qu'il me faut. Je construis ton premier cycle : les séances, chaque exercice avec pourquoi il est là et comment l'exécuter, les séries, les repos, la progression semaine par semaine. Ensuite on le fait évoluer ensemble.</p></div>
    <div class="row2"><button class="btn fill" id="genBtn">${esc(COACH_NAME)}, construis mon programme</button></div>
    <div id="genWait" hidden><div class="wait">${coachAvatar('busy')}<div><b id="genStep">${esc(COACH_NAME)} lit ton profil…</b><p class="small muted">Une à deux minutes. Tu peux garder l'écran ouvert ou revenir plus tard, le programme t'attendra.</p></div></div></div>
    <p class="small err" id="genMsg"></p>
    ${DEFAULT_PROGRAM&&USER&&/@nexisafe\.com$/i.test(USER.email||'')?`<details class="more"><summary>Autre option</summary><p class="small">Importer le programme « ${esc(DEFAULT_PROGRAM.cycleName||'Fondations')} » tel quel.</p><button class="btn sm" id="importBtn">Importer ce programme</button></details>`:''}
    <p class="small muted"><button class="link" id="backProf">Modifier mon profil</button></p>
  </section>`;
  $('#genBtn').onclick=()=>generateProgram();
  $('#backProf').onclick=()=>onbStep(0);
  const ib=$('#importBtn'); if(ib) ib.onclick=()=>saveProgram(DEFAULT_PROGRAM, DEFAULT_CYCLE_HTML);
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
    ['age','height','weight','days','minutes'].forEach(k=>p[k]=Number(p[k])); p.updatedAt=Date.now(); if(!PROFILE||!PROFILE.createdAt) p.createdAt=Date.now(); else p.createdAt=PROFILE.createdAt;
    PROFILE=p; try{ await fbDb.collection('users').doc(USER.uid).collection('meta').doc('profile').set(p); }catch(err){ alert('Enregistrement impossible : '+err.message); return; }
    after&&after(); };
}
async function generateProgram(){
  const msg=$('#genMsg'), btn=$('#genBtn'), wait=$('#genWait'); if(btn) btn.hidden=true; if(wait) wait.hidden=false; if(msg) msg.textContent='';
  const stepsTxt=[COACH_NAME+' lit ton profil…','Il choisit les exercices pour ton matériel…','Il règle séries, repos et progression…','Il rédige les explications de chaque exercice…','Dernières vérifications…']; let k=0; startJob('construit ton programme',stepsTxt.map(x=>x.replace(/…$/,'')),90000);
  const iv=setInterval(()=>{ k=Math.min(k+1,stepsTxt.length-1); const e=$('#genStep'); if(e) e.textContent=stepsTxt[k]; },18000);
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); await fn({mode:'program'}); }
  catch(e){ logErr('program',e); endJob(false,humanErr(e)); if(msg) msg.textContent=humanErr(e); if(btn){ btn.hidden=false; btn.textContent='Réessayer'; } if(wait) wait.hidden=true; clearInterval(iv); return; }
  clearInterval(iv); endJob(true,'Programme prêt');
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
  PROGRAM=p; if(p.weeks&&p.weeks.length) WEEKS=p.weeks; PROGRAM_LOADED=true;
  const sm=document.querySelector('.brand small'); if(sm) sm.textContent=p.cycleName||'';
  restoreShell(); autoCloseLogs(); renderCycle(); render(); ensureDemos();
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
    let prof=null, prog=null; snap.docs.forEach(d=>{ if(d.id==='profile') prof=d.data(); if(d.id==='program') prog=d.data(); if(d.id==='usage') USAGE=d.data(); });
    PROFILE=prof;
    if(prog&&prog.sessions&&prog.sessions.length){ applyProgram(prog); }
    else if(snap.metadata.fromCache&&!snap.docs.length){ /* première ouverture hors ligne : attendre le serveur */ }
    else { PROGRAM_LOADED=false; showOnboarding(prof?'program':'profile'); }
  }, err=>{ console.warn('meta',err); logErr('listen meta',err); }));
}
async function regenerateProgram(){
  if(!confirm('Générer un nouveau mésocycle ? Le programme actuel est remplacé, ton journal est conservé.')) return;
  const el=$('#tab-programme'); el.insertAdjacentHTML('afterbegin','<div class="banner info" id="regenMsg">Le coach rédige le nouveau cycle, une à deux minutes…</div>');
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); await fn({mode:'program'}); }
  catch(e){ const m=$('#regenMsg'); if(m) m.textContent='Échec : '+(e.message||e); }
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


/* ---------- Aujourd'hui ---------- */
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
  let h=`<div class="hello"><p class="eyebrow">${esc(dayLabel)}</p><h2>${esc(hello)}${name?' '+esc(name):''}</h2></div>`;
  // carte séance du jour
  h+=`<div class="today ${done?'done':''}"><div class="t-top"><span class="eyebrow">${isRest&&!started&&!done?'Pas de séance prévue':'Séance du jour'} · ${esc(W.label)}</span>${sub?'<span class="tag">sans salle</span>':''}</div>
    <div class="t-name">${esc(sub?sub.name:ses.name)}</div><div class="t-meta">${esc(ses.sub)} · ${exs.length} exercices · ${esc(ses.duration||'')}</div>
    ${started||done?`<div class="prog"><div class="bar"><i style="width:${Math.round(100*nDone/Math.max(1,exs.length))}%"></i></div><span>${nDone}/${exs.length} exercices · ${nSets} séries</span></div>`:''}
    <div class="t-actions">${done?`<button class="btn" id="homeOpen">Revoir la séance</button>`:`<button class="btn fill" id="homeStart">${started?'Reprendre':'Démarrer'}</button><button class="btn" id="homeOpen">Voir le plan</button>`}</div>
    ${!started&&!done?`<button class="link t-nogym" id="homeNogym">Pas de salle aujourd'hui ?</button>`:''}</div>`;
  // semaine : pastilles
  const start=addDays(WEEKS[0].from,0); const k=Math.max(0,Math.floor(Math.round((new Date(date+'T12:00:00')-new Date(WEEKS[0].from+'T12:00:00'))/86400000)/7)); const a=addDays(WEEKS[0].from,k*7);
  const dn=['L','M','M','J','V','S','D']; let dots='';
  for(let i=0;i<7;i++){ const d=addDays(a,i); const dayIdx=(i+1)%7; const planned=PROGRAM.sessions.find(x=>x.day===dayIdx); const did=Object.values(S.logs).some(l=>l.done&&l.date===d); const cls=did?'ok':d<date?(planned?'miss':'rest'):d===date?'now':(planned?'plan':'rest'); dots+=`<div class="dot ${cls}"><i></i><span>${dn[i]}</span></div>`; }
  const weekDone=Object.values(S.logs).filter(l=>l.done&&l.date>=a&&l.date<=addDays(a,6)).length;
  h+=`<div class="card wk"><div class="card-h"><b>Cette semaine</b><span class="muted">${weekDone}/${PROGRAM.sessions.length} séances</span></div><div class="dots">${dots}</div></div>`;
  // dernier mot du coach
  const last=COACH.items[0];
  if(last){ const txt=last.type==='bilan'||last.type==='cycleEnd'?(last.nextWeek||last.analysis):last.type==='nudge'?last.analysis:(last.nextFocus||last.analysis); h+=`<div class="card coachcard" id="homeCoach" role="button" tabindex="0"><div class="card-h"><b>${coachAvatar(last.adjustments&&last.adjustments.length&&!last.applied?'attention':'idle','xs')} ${esc(COACH_NAME)}</b><span class="muted">${last.createdAt?new Date(last.createdAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):''}</span></div><p>${lexify(esc(String(txt||'').slice(0,180)))}${String(txt||'').length>180?'…':''}</p>${last.adjustments&&last.adjustments.length&&!last.applied?'<span class="tag">charges à appliquer</span>':''}</div>`; }
  else h+=`<div class="card"><div class="card-h"><b>${coachAvatar('idle','xs')} ${esc(COACH_NAME)}</b></div><p class="muted">Ton coach. Après ta première séance terminée, il l'analyse et fixe les charges suivantes.</p></div>`;
  // prochaine séance
  const nextS=[1,2,3,4,5,6,7].map(i=>{ const d=(new Date().getDay()+i)%7; return PROGRAM.sessions.find(x=>x.day===d); }).find(Boolean);
  if(nextS&&nextS.id!==ses.id) h+=`<p class="small muted center">Prochaine : ${esc(nextS.dayName)} · ${esc(nextS.name)}</p>`;
  el.innerHTML=h;
  const go=()=>{ S.session=ses.id; save(); showTab('seance'); };
  const st=$('#homeStart'); if(st) st.onclick=()=>{ S.session=ses.id; save(); showTab('seance'); enterFocus(); };
  const op=$('#homeOpen'); if(op) op.onclick=go;
  const ng=$('#homeNogym'); if(ng) ng.onclick=()=>{ go(); setTimeout(()=>{ const b=$('#subBtn'); if(b) b.click(); },50); };
  const hc=$('#homeCoach'); if(hc) hc.onclick=()=>showTab('coach');
}
/* ---------- mode séance plein écran ---------- */
let FOCUS=false;
function enterFocus(){ FOCUS=true; document.body.classList.add('focus'); renderSeance(); window.scrollTo({top:0}); requestWake(); }
function exitFocus(){ if(!FOCUS) return; FOCUS=false; document.body.classList.remove('focus'); renderSeance(); }


/* ---------- Démos visuelles des mouvements ---------- */
const DEMO={base:window.__DEMO_BASE||'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/',index:null,loading:null,asked:false};
// Repli local quand le coach n'a pas encore associé les fiches : mots-clés français → fiche.
const DEMO_GUESS=[[/traction.*(assist|machine)|chin.*assist/i,'Machine_Assisted_Chin-Up'],[/traction|pull[- ]?up/i,'Pullups'],[/chin[- ]?up|supination/i,'Chin-Up'],[/dips?\b/i,'Dips_-_Triceps_Version'],[/hack/i,'Hack_Squat'],[/presse|leg press/i,'Leg_Press'],[/pendulum|belt squat/i,'Hack_Squat'],[/squat.*(avant|front)|front squat/i,'Front_Barbell_Squat'],[/squat.*(goblet)/i,'Goblet_Squat'],[/squat/i,'Barbell_Full_Squat'],[/fente|lunge|split/i,'Dumbbell_Lunges'],[/leg curl.*(couch|allong)|lying leg curl/i,'Lying_Leg_Curls'],[/leg curl|ischio/i,'Seated_Leg_Curl'],[/leg ext|extension.*(jambe|quad)/i,'Leg_Extensions'],[/soulev.*terre.*(jambes? tendues|roumain)|rdl|romanian/i,'Romanian_Deadlift'],[/soulev.*terre|deadlift/i,'Barbell_Deadlift'],[/hip thrust/i,'Barbell_Hip_Thrust'],[/mollet.*(assis)|seated calf/i,'Seated_Calf_Raise'],[/mollet|calf/i,'Standing_Calf_Raises'],[/d[ée]velopp[ée].*(inclin|incline)/i,'Incline_Dumbbell_Press'],[/d[ée]velopp[ée].*(d[ée]clin|decline)/i,'Decline_Barbell_Bench_Press'],[/d[ée]velopp[ée].*(couch|bench).*halt/i,'Dumbbell_Bench_Press'],[/d[ée]velopp[ée].*(couch|bench)|bench press/i,'Barbell_Bench_Press_-_Medium_Grip'],[/d[ée]velopp[ée].*(militaire|[ée]paule|overhead|shoulder)|press.*[ée]paule/i,'Dumbbell_Shoulder_Press'],[/chest press|press.*(pector|poitrine)/i,'Machine_Bench_Press'],[/pec[- ]?deck|butterfly|[ée]cart[ée].*(machine|poulie)|fly/i,'Butterfly'],[/[ée]cart[ée]/i,'Dumbbell_Flyes'],[/crossover|poulie.*(vis|crois)/i,'Cable_Crossover'],[/tirage.*(vertical|haut)|lat ?pull/i,'Wide-Grip_Lat_Pulldown'],[/tirage.*(horizontal|bas)|seated row|rowing.*(poulie|c[âa]ble)/i,'Seated_Cable_Rows'],[/rowing.*(halt|unilat|un bras)|one[- ]arm/i,'One-Arm_Dumbbell_Row'],[/rowing.*(barre|pench)|bent.?over/i,'Bent_Over_Barbell_Row'],[/rowing|row\b/i,'Seated_Cable_Rows'],[/face ?pull/i,'Face_Pull'],[/pull[- ]?over/i,'Straight-Arm_Dumbbell_Pullover'],[/[ée]l[ée]vation.*lat|lateral raise/i,'Side_Lateral_Raise'],[/[ée]l[ée]vation.*(front|avant)/i,'Front_Dumbbell_Raise'],[/oiseau|rear delt|reverse (fly|pec)/i,'Seated_Bent-Over_Rear_Delt_Raise'],[/shrug|haussement/i,'Dumbbell_Shrug'],[/curl.*(marteau|hammer)/i,'Hammer_Curls'],[/curl.*(inclin|incline)/i,'Incline_Dumbbell_Curl'],[/curl.*(pupitre|larry|preacher|scott)/i,'Preacher_Curl'],[/curl.*(poulie|c[âa]ble)/i,'Cable_Hammer_Curls_-_Rope_Attachment'],[/curl.*(barre|ez)/i,'Barbell_Curl'],[/curl/i,'Dumbbell_Bicep_Curl'],[/skull|barre au front|triceps.*(couch|allong)/i,'Lying_Triceps_Press'],[/extension.*(poulie|corde|c[âa]ble)|push ?down|pushdown/i,'Triceps_Pushdown_-_Rope_Attachment'],[/extension.*(nuque|overhead|au[- ]dessus)/i,'Standing_Dumbbell_Triceps_Extension'],[/kick ?back/i,'Tricep_Dumbbell_Kickback'],[/pompes?|push[- ]?up/i,'Pushups'],[/gainage|planche|plank/i,'Plank'],[/crunch.*(poulie|c[âa]ble)/i,'Cable_Crunch'],[/relev[ée].*jambes|leg raise|hanging/i,'Hanging_Leg_Raise'],[/crunch|abdo/i,'Crunches'],[/farmer/i,'Farmers_Walk'],[/suspension.*(barre)|dead ?hang|grip|avant[- ]bras/i,'Wrist_Curl'],[/good ?morning/i,'Good_Morning'],[/kettlebell swing|swing/i,'Kettlebell_Swing'],[/muscle[- ]?up/i,'Pullups']];
function demoId(ex){ if(!ex) return null; if(ex.demo) return ex.demo; const m=(PROGRAM.demos||{})[ex.id]; if(m) return m; const t=(ex.name||'')+' '+(ex.machine||''); const g=DEMO_GUESS.find(([re])=>re.test(t)); return g?g[1]:null; }
function demoImg(id,i){ return DEMO.base+encodeURIComponent(id)+'/'+i+'.jpg'; }
function loadDemoIndex(){ if(DEMO.index) return Promise.resolve(DEMO.index); if(!DEMO.loading) DEMO.loading=fetch('demo/index.json').then(r=>r.json()).then(a=>{ DEMO.index={}; a.forEach(x=>DEMO.index[x.i]=x); return DEMO.index; }).catch(()=>{ DEMO.loading=null; return {}; }); return DEMO.loading; }
// Programme généré avant les fiches : on demande l'association au coach une seule fois, elle est enregistrée dans le programme.
async function ensureDemos(){ if(DEMO.asked||!USER||!navigator.onLine||!PROGRAM_LOADED||!PROGRAM.sessions.length||PROGRAM.demos||PROGRAM.demosAt) return; DEMO.asked=true; startJob('associe les photos des mouvements',['Parcourt ton programme','Choisit la fiche la plus proche pour chaque exercice'],15000); try{ await callCoach({mode:'demo'}); endJob(true,'Photos associées'); }catch(e){ logErr('demo',e); endJob(false,'Photos : association impossible'); } }
function demoStrip(ex,cls){ const id=demoId(ex); if(!id) return ''; return `<button class="demo ${cls||''}" data-demo="${esc(ex.id)}" aria-label="Voir le mouvement"><img src="${demoImg(id,0)}" alt="" loading="lazy"><i class="arr">›</i><img src="${demoImg(id,1)}" alt="" loading="lazy"><span>Voir le mouvement</span></button>`; }
function demoThumb(ex){ const id=demoId(ex); if(!id) return ''; return `<button class="dthumb" data-demo="${esc(ex.id)}" aria-label="Voir le mouvement"><img src="${demoImg(id,1)}" alt="" loading="lazy"></button>`; }
function findEx(exId){ for(const s of PROGRAM.sessions){ const e=s.exercises.find(x=>x.id===exId); if(e) return e; const sub=((S.overrides||{})[s.id]||{}).substitute; if(sub){ const e2=(sub.exercises||[]).find(x=>x.id===exId); if(e2) return e2; } } return null; }
let demoAnim=0;
async function showDemo(ex){
  if(!ex) return; const id=demoId(ex);
  const yt='https://www.youtube.com/results?search_query='+encodeURIComponent((ex.name||'')+' '+(ex.machine||'').split('·')[0]+' exécution');
  let d='<dl class="dl">'; if(ex.target) d+=`<dt>Cible</dt><dd>${esc(ex.target)}</dd>`; if(ex.exec) d+=`<dt>Exécution</dt><dd>${esc(ex.exec)}</dd>`; if(ex.why) d+=`<dt>Pourquoi</dt><dd>${esc(ex.why)}</dd>`; if(ex.seek) d+=`<dt class="seek">Ce qu'on cherche</dt><dd>${esc(ex.seek)}</dd>`; if(ex.reco) d+=`<dt>Reconnaître la machine</dt><dd>${esc(ex.reco)}</dd>`; d+='</dl>';
  const links=`<div class="row2 dlinks">${ex.url?`<a class="btn sm" href="${esc(ex.url)}" target="_blank" rel="noopener" data-ext>Photo de la machine ↗</a>`:''}<a class="btn sm" href="${yt}" target="_blank" rel="noopener" data-ext>Vidéo ↗</a></div>`;
  const p=rx(ex,curWeek()); const rxh=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}</b>${p.rir!=null?`<b data-lex="rir"><i>RIR</i>${p.rir}</b>`:''}<b data-lex="tempo"><i>tempo</i>${esc(ex.tempo||'')}</b><b><i>repos</i>${esc(p.restText||'')}</b></div>`;
  const sheet=showSheet(`<h3>${esc(ex.name)}</h3><p class="small muted">${esc(ex.machine||'')}${ex.alt?' · alternative : '+esc(ex.alt):''}</p>${id?`<div class="dplay" id="dplay"><img src="${demoImg(id,0)}" alt="Position de départ" class="on"><img src="${demoImg(id,1)}" alt="Position d'arrivée"><div class="dcap"><span class="on">Départ</span><span>Arrivée</span></div></div><div class="mmap-slot" id="mslot"></div>`:`<p class="hint">Pas de photos pour ce mouvement. La vidéo ci-dessous montre l'exécution.</p>`}${rxh}${links}${d}<button class="btn" onclick="hideSheet()">Fermer</button>`);
  sheet.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
  clearInterval(demoAnim);
  if(id){ let k=0; demoAnim=setInterval(()=>{ const p=$('#dplay'); if(!p||!sheet.classList.contains('on')){ clearInterval(demoAnim); return; } k=1-k; p.querySelectorAll('img').forEach((im,i)=>im.classList.toggle('on',i===k)); p.querySelectorAll('.dcap span').forEach((c,i)=>c.classList.toggle('on',i===k)); },1100);
    const idx=await loadDemoIndex(); const info=idx[id]; const slot=$('#mslot'); if(info&&slot&&window.muscleMap) slot.innerHTML=muscleMap(info.p,info.s); }
}
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('[data-demo]'); if(b){ e.preventDefault(); e.stopPropagation(); showDemo(findEx(b.dataset.demo)); } },true);

/* ---------- render: séance ---------- */
function render(){ if(!PROGRAM.sessions.length||!PROGRAM_LOADED||!$('#tab-seance')) return; renderHome(); renderSeance(); renderProgramme(); renderSuivi(); renderReglages(); renderCoach(); const w=WEEKS[curWeek()-1]; $('#weekChip').textContent=`Semaine ${w.n}`; }

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
document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('.lx[data-lex]'); if(b){ e.preventDefault(); e.stopPropagation(); showLex(b.dataset.lex); } },true);
function showSheet(html){ let s=$('#sheet'); if(!s){ s=document.createElement('div'); s.id='sheet'; s.innerHTML='<div class="sheet-bg"></div><div class="sheet-card" role="dialog"><button class="sheet-grip" aria-label="Fermer"></button><div class="sheet-body"></div></div>'; document.body.appendChild(s); s.querySelector('.sheet-bg').onclick=hideSheet; s.querySelector('.sheet-grip').onclick=hideSheet;
    // Glisser vers le bas pour fermer : depuis la poignée, ou depuis le contenu quand il est en haut de son défilement.
    const card=s.querySelector('.sheet-card'); let y0=null, dy=0, drag=false;
    card.addEventListener('touchstart',e=>{ const fromGrip=e.target.closest('.sheet-grip,.chead'); const atTop=card.scrollTop<=0&&!(e.target.closest('.chat')&&e.target.closest('.chat').scrollTop>0); if(!fromGrip&&!atTop) return; y0=e.touches[0].clientY; dy=0; drag=false; },{passive:true});
    card.addEventListener('touchmove',e=>{ if(y0==null) return; dy=e.touches[0].clientY-y0; if(dy>8){ drag=true; card.style.transition='none'; card.style.transform=`translateY(${dy}px)`; } },{passive:true});
    card.addEventListener('touchend',()=>{ if(y0==null) return; card.style.transition=''; if(drag&&dy>90){ card.style.transform=''; hideSheet(); } else card.style.transform=''; y0=null; drag=false; },{passive:true}); } s.querySelector('.sheet-body').innerHTML=html; s.classList.add('on'); document.body.style.overflow='hidden'; return s; }
function hideSheet(){ const s=$('#sheet'); if(s){ s.classList.remove('on'); s.classList.remove('tall'); const c=s.querySelector('.sheet-card'); if(c){ c.style.bottom=''; c.style.maxHeight=''; } document.body.style.overflow=''; } COACH.chatOpen=false; }
function showLex(key){ const l=LEX[key]; if(!l) return; showSheet(`<h3>${esc(l[0])}</h3><p>${esc(l[1])}</p><button class="btn" onclick="hideSheet()">Compris</button>`); }
let toastT=0; function toast(msg,cls){ let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); } t.textContent=msg; t.className='on '+(cls||''); clearTimeout(toastT); toastT=setTimeout(()=>t.className='',1800); }
function rirLabel(v){ return v==null?'':v>=3?'F':v>=1?'J':'É'; }

function renderSeance(){
  if(!$('#tab-seance')||!PROGRAM.sessions.length) return;
  const wk=curWeek(), W=WEEKS[wk-1], date=todayISO(); let ses=curSession(); const log=getLog(date,ses.id);
  const subDoc=((S.overrides||{})[ses.id]||{}).substitute; const sub=subDoc&&subDoc.date===date?subDoc:null;
  if(sub) ses=Object.assign({},ses,{name:sub.name,sub:'sans salle · '+(sub.gear||[]).join(', '),exercises:sub.exercises,gtg:false,note:''});
  const el=$('#tab-seance'); let h='';
  h+=`<div class="days">`+PROGRAM.sessions.map(s=>{ const done=Object.values(S.logs).some(l=>l.session===s.id&&l.week===wk&&l.done); return `<button data-s="${s.id}" aria-pressed="${s.id===ses.id}" class="${done?'done':''}"><b>${esc(s.dayName.slice(0,3))}</b><span>${esc(shortName(s.name))}</span></button>`; }).join('')+`<button data-s="rest" aria-pressed="false"><b>Dim</b><span>Repos</span></button></div>`;
  // état de la séance
  const flagsAll=log.flags||{};
  const states=ses.exercises.map(ex=>{ const p=rx(ex,wk); const done=(log.sets[ex.id]||[]).filter(s=>s&&s.done).length; const f=flagsAll[ex.id]||{}; return {ex,p,done,complete:done>=p.sets,skip:!!f.skip,alt:!!f.alt}; });
  const nDone=states.filter(s=>s.complete||s.skip).length, nSets=states.reduce((a,s)=>a+s.done,0);
  let current=states.find(s=>!s.complete&&!s.skip); if(S.openEx){ const o=states.find(s=>s.ex.id===S.openEx); if(o) current=o; }
  const curIdx=current?states.findIndex(s=>s.ex.id===current.ex.id):-1;
  if(FOCUS){ h+=`<div class="fhead"><button class="fclose" id="fExit" aria-label="Quitter le mode séance">✕</button><div class="ftitle"><b>${esc(ses.name)}</b><span>${curIdx>=0?`Exercice ${curIdx+1} sur ${states.length}`:'Tous les exercices sont faits'} · ${nSets} série${nSets>1?'s':''} <span id="elapsed" class="el"></span></span></div><div class="fprog">${states.map(s=>`<i class="${s.complete?'ok':s.skip?'skip':(current&&current.ex.id===s.ex.id)?'now':''}"></i>`).join('')}</div></div>`; }
  h+=`<div class="sesshead"><h2>${esc(ses.name)}</h2><span class="meta">${esc(ses.sub)} · ${esc(ses.duration)}${ses.place?' · '+esc(ses.place):''} <span id="${FOCUS?'elapsed2':'elapsed'}"></span></span>
    <div class="prog"><div class="bar"><i style="width:${Math.round(100*nDone/Math.max(1,states.length))}%"></i></div><span>${nDone}/${states.length} exercices · ${nSets} série${nSets>1?'s':''}</span><button class="wk" data-lex="semaine">${esc(W.label)} · ${esc((W.rirNote||'').split('·')[0].replace(/\(.*$/,'').trim())}</button></div></div>`;
  if(sub) h+=`<div class="banner info"><b>Séance sans salle.</b> ${esc(sub.intro)} <button class="link" id="subOff">Revenir à la séance prévue</button></div>`;
  else if(!log.done&&!nSets) h+=`<div class="row2 nogym"><button class="btn sm" id="subBtn">Pas de salle aujourd'hui ?</button></div>`;
  if(ses.note) h+=`<div class="banner">${esc(ses.note)}</div>`;
  if(cycleOver()) h+=`<div class="banner">Cycle terminé le ${fmtD(WEEKS[WEEKS.length-1].to)}. Prescriptions de décharge en attendant le cycle suivant (Programme → Nouveau cycle).</div>`;
  if(log.done) h+=`<div class="banner ok">Séance validée. Tu peux encore corriger les valeurs.</div>`;
  if(!log.done&&!ses.exercises.some(ex=>lastRef(ex.id,date))&&!nSets) h+=`<p class="hint">Première fois : note tes charges, elles serviront de référence.</p>`;
  const prevLog=Object.values(S.logs).filter(l=>l.session===ses.id&&l.date<date&&l.notes).sort((a,b)=>a.date<b.date?1:-1)[0];
  if(prevLog) h+=`<details class="more wu"><summary>Tes notes du ${fmtD(prevLog.date)}</summary><p class="small">${esc(prevLog.notes)}</p></details>`;
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
    if(ref){ const top=ref.sets.find(s=>s.w)||ref.sets[0]; let tgt=''; if(top&&top.w&&wk>1&&wk<WEEKS.length){ const hi=parseInt(String(p.reps).split('-').pop()); const allHi=ref.sets.every(s=>s.r>=hi); if(allHi){ tgtW=Math.round(top.w*1.025*2)/2; tgt=` → <span class="tgt">${tgtW} kg</span>`; } else tgt=` → <span class="tgt">+1 rep</span>`; } if(wk>=WEEKS.length&&top&&top.w){ tgtW=Math.round(top.w*0.9*2)/2; tgt=` → <span class="tgt">décharge ${tgtW} kg</span>`; } const topS=ref.sets.find(x=>x.w)||ref.sets[0]; h+=`<p class="ref">Dernier : <b>${topS&&topS.w?topS.w+' kg × '+(topS.r??'?'):esc(fmtSets(ref.sets.slice(0,1)))}</b>${ref.sets.length>1?' <span class="muted">· '+ref.sets.length+' séries</span>':''}${tgt}</p>`; }
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
      h+=`<button class="go ${s.done?'done':''}" data-i="${i}" ${enabled?'':'disabled'} aria-label="${s.done?'Annuler la série':'Valider la série'} ${i+1}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
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

  // events
  el.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{ const id=b.dataset.s; if(id==='rest'){ el.innerHTML=`<div class="days">${el.querySelector('.days').innerHTML}</div><h2>Dimanche — repos</h2><p>Marche 30 à 60 min, mobilité hanches et épaules 20 min. Pas de tractions.</p>`; el.querySelectorAll('.days button').forEach(x=>x.onclick=()=>{S.session=x.dataset.s==='rest'?S.session:x.dataset.s;S.openEx=null;save();renderSeance();}); return; } S.session=id; S.openEx=null; save(); renderSeance(); window.scrollTo({top:0}); });
  el.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
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
      a[i].done=true; a[i].t=Date.now(); touch(log);
      native({type:'haptic'}); try{ navigator.vibrate&&navigator.vibrate(15); }catch(e){}
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
  $('#endBtn').onclick=()=>{ log.done=!log.done; touch(log); stopTimer(); if(log.done){ releaseWake(); S.openEx=null; save(); toast('Séance enregistrée','ok'); if(FOCUS){ FOCUS=false; document.body.classList.remove('focus'); } if(USER&&navigator.onLine){ analyseSession(logKey(log.date,log.session)); document.querySelector('.tabs button[data-tab="coach"]').click(); } } renderSeance(); if(log.done) window.scrollTo({top:0}); };
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
function renderProgramme(){
  if(!$('#tab-programme')) return;
  const wk=curWeek(); let h=`<h2>Programme</h2><p class="small muted">${esc(PROGRAM.cycleName||'')} · <button class="lx" data-lex="mesocycle">mésocycle</button> de ${WEEKS.length} semaines · semaine ${wk} affichée${PROGRAM.cycleReason?'<br><span class="small">'+esc(PROGRAM.cycleReason)+'</span>':''}</p><div class="row2"><button class="btn sm" id="regenBtn">Nouveau cycle avec le coach</button></div>`;
  PROGRAM.sessions.forEach(s=>{
    h+=`<h3>${esc(s.dayName)} — ${esc(s.name)} <span class="muted small">(${esc(s.sub)})</span></h3><div class="pcard">`;
    s.exercises.forEach(ex=>{ const p=rx(ex,wk); const did=demoId(ex); h+=`<div class="prow" data-pex="${ex.id}">${did?`<img class="pimg" src="${demoImg(did,1)}" alt="" loading="lazy">`:`<span class="n">${ex.n}</span>`}<span class="nm">${esc(ex.name)}${ex.star?' <span style="color:var(--accent)">★</span>':''}</span><span class="rx2">${p.sets}×${esc(p.reps)}</span></div>`; });
    h+=`</div>`;
  });
  h+=`<p class="small muted center">Semaine affichée : <b>S${wk}</b>${S.weekOverride?' (forcée)':''} · <button class="link" id="wkNext">Voir la semaine suivante</button>${S.weekOverride?' · <button class="link" id="wkAuto">Revenir à la semaine réelle</button>':''}</p>`;
  h+=`<details class="cyc doc"><summary>Lire le cycle</summary>${cycleHtml()}</details>`;
  $('#tab-programme').innerHTML=h;
  const rb=$('#regenBtn'); if(rb) rb.onclick=regenerateProgram;
  const wn=$('#wkNext'); if(wn) wn.onclick=()=>{ const auto=weekFor(todayISO()); const nx=curWeek()%WEEKS.length+1; S.weekOverride=nx===auto?null:nx; save(); render(); };
  const wa=$('#wkAuto'); if(wa) wa.onclick=()=>{ S.weekOverride=null; save(); render(); };
  $('#tab-programme').querySelectorAll('[data-pex]').forEach(r=>r.onclick=()=>{ const ex=PROGRAM.sessions.flatMap(x=>x.exercises).find(e=>e.id===r.dataset.pex); if(ex) showDemo(ex); });
}


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
    <button class="tr" data-view="corps"><span class="l">Tractions</span><b>${tests[0]?tests[0].reps:'—'}</b>${tests.length>1?trend(tests[0].reps-tests[tests.length-1].reps,''):'<i class="flat">max d\'affilée</i>'}<small>${PROFILE&&PROFILE.pullGoal?'objectif '+PROFILE.pullGoal:tests[0]?'dernier test '+fmtD(tests[0].date):'fais un test'}</small></button></div>`;
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
  const goal=(PROFILE&&PROFILE.pullGoal)||null; const lastT=tests[tests.length-1];
  h+=`<div class="card"><div class="card-h"><b>Tractions max</b><span class="muted">test d\'affilée, strictes</span></div>
    <div class="bwbig"><b>${lastT?lastT.reps:'—'}</b><span>reps${lastT?' · '+fmtD(lastT.date):''}</span></div>
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
function showTab(tab){ const tb=document.querySelector('.tabs'); if(tb) tb.classList.remove('hide'); document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x.dataset.tab===tab)); ['home','seance','coach','programme','suivi','reglages'].forEach(t=>{ const s=$('#tab-'+t); if(s) s.hidden=t!==tab; }); if(tab!=='seance') exitFocus(); window.scrollTo({top:0}); }
$('#settingsBtn').onclick=()=>showTab('reglages');
$('#weekChip').onclick=()=>{ const auto=weekFor(todayISO()); const cur=curWeek(); const nx=cur%WEEKS.length+1; S.weekOverride=nx===auto?null:nx; save(); render(); };
document.addEventListener('pointerdown',unlockAudio,{once:true});
document.addEventListener('pointerdown',()=>{ if(window.Notification&&Notification.permission==='default'){ try{Notification.requestPermission();}catch(e){} } },{once:true});

/* ---------- démarrage ---------- */
async function boot(){
  if(!Object.keys(S.logs).length){ const j=await idbGet(); if(j){ try{ const d=JSON.parse(j); if(Object.keys(d.logs||{}).length) S=Object.assign(S,d); }catch(e){} } }
  try{
    const [p,c]=await Promise.all([fetch('program.json').then(r=>r.json()), fetch('cycle.html').then(r=>r.text())]);
    DEFAULT_PROGRAM=p; DEFAULT_CYCLE_HTML=c;
  }catch(e){ DEFAULT_PROGRAM=null; }
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
