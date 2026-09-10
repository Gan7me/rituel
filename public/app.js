
const APP_VERSION='3.6.0';
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
let S = {logs:{}, bw:{}, tests:{}, overrides:{}, weekOverride:null, session:null, wake:true, openEx:null};
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

function rx(ex, wk){ // prescription for a week
  if(ex.mode==='emom'){ const w=ex.weeks[wk-1]; return {sets:w.sets,reps:w.reps,rir:null,rest:wk===4?120:90,restText:wk===4?'2 min':'90 s'}; }
  let sets=ex.sets; if(ex.star&&(wk===2||wk===3)) sets+=1; if(wk===4) sets=ex.s4sets||Math.max(1,Math.round(ex.sets*0.6));
  return {sets, reps:ex.reps, rir:ex.rir?ex.rir[wk-1]:null, rest:ex.restSec, restText:ex.restText};
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
  }, err=>{ console.warn(name,err); setSync('pend','sync erreur'); }));
  listen('logs','logs'); listen('bw','bw'); listen('tests','tests');
  unsubs.push(col('coach').orderBy('createdAt','desc').limit(30).onSnapshot(snap=>{ COACH.items=snap.docs.map(d=>({id:d.id,...d.data()})); renderCoach(); }));
  unsubs.push(col('overrides').onSnapshot(snap=>{ S.overrides={}; snap.docs.forEach(d=>S.overrides[d.id]=d.data()); save(); if(PROGRAM_LOADED) renderSeance(); }));
  renderReglages();
}
async function pushLocalToRemote(){
  const batchWrites=[];
  for(const [name,key] of [['logs','logs'],['bw','bw'],['tests','tests']]){
    for(const id in S[key]){ const local=S[key][id]; if(!local||!local.updatedAt) continue;
      batchWrites.push(async()=>{ const ref=col(name).doc(id); const snap=await ref.get({source:'server'}).catch(()=>ref.get()); const remote=snap.exists?snap.data():null;
        if(!remote||(local.updatedAt||0)>(remote.updatedAt||0)) await ref.set(JSON.parse(JSON.stringify(local))); });
    }
  }
  for(const w of batchWrites){ try{ await w(); }catch(e){ console.warn('push',e); } }
}
function writeDoc(name,id,data){ if(!USER||!fbDb||applyingRemote) return; col(name).doc(id).set(JSON.parse(JSON.stringify(data))).catch(e=>console.warn('write',e)); }

function setSync(cls,txt){ const c=$('#syncChip'); c.className='chip sync '+cls; c.textContent=txt; }
function syncStatusIdle(){ if(!USER) return setSync('off','local'); setSync(navigator.onLine?'on':'pend', navigator.onLine?'sync ok':'hors ligne'); }
function markDirty(){ save(); }
function mergeInto(local, remote){ let changed=false; for(const c of ['logs','bw','tests']){ const L=local[c]||(local[c]={}), R=(remote&&remote[c])||{}; for(const k in R){ if(!L[k]||(R[k].updatedAt||0)>(L[k].updatedAt||0)){ L[k]=R[k]; changed=true; writeDoc(c,k,R[k]); } } } return changed; }
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
    <button class="row" id="progBtn"><span>Programme en cours</span><span class="muted">${esc(PROGRAM.cycleName||'—')}</span><i></i></button>
  </div>
  <div class="grp"><div class="grp-t">Coach ce mois-ci</div>
    <div class="row"><span>Usage</span><span class="muted">${usage}</span></div>
    ${USAGE?`<div class="row"><span>Détail</span><span class="muted">${USAGE.analyse||0} analyses · ${USAGE.chat||0} questions · ${USAGE.program||0} programme${(USAGE.program||0)>1?'s':''}</span></div>`:''}
    <div class="row sub">Plafonds : 60 analyses, 300 questions, 4 programmes par mois.</div>
  </div>
  <div class="grp"><div class="grp-t">Séance</div>
    <label class="row"><span>Écran allumé pendant la séance</span><input type="checkbox" class="sw" id="wakeOpt" ${S.wake!==false?'checked':''}></label>
    ${NATIVE?`<div class="row"><span>Notifications</span><span class="muted">${PUSH_TOKEN?'activées':'gérées par le téléphone'}</span></div>`:`<button class="row" id="notifBtn"><span>Notifications de fin de repos</span><span class="muted">${notifState}</span><i></i></button>`}
  </div>
  <div class="grp"><div class="grp-t">Données</div>
    <button class="row" id="expBtn"><span>Exporter mon journal (JSON)</span><i></i></button>
    <label class="row" for="impFile"><span>Importer un journal</span><i></i></label><input id="impFile" type="file" accept="application/json" hidden>
    <a class="row" href="confidentialite.html" target="_blank" rel="noopener"><span>Politique de confidentialité</span><i></i></a>
    <div class="row sub">Données stockées en Europe (Firebase), transmises à l'API Anthropic uniquement pour le coach.</div>
  </div>
  <div class="grp">
    ${USER?`<button class="row" id="signOut"><span>Se déconnecter</span></button>`:''}
    ${USER?`<button class="row danger" id="delBtn"><span>Supprimer mon compte et mes données</span></button>`:''}
  </div>
  <p class="small muted center">Rituel ${APP_VERSION} · <button class="link" id="reloadBtn">Recharger l'application</button></p>
`;
  const so=$('#signOut'); if(so) so.onclick=()=>{ if(confirm('Se déconnecter ? Tes données restent sur ton compte.')) signOut(); };
  const db_=$('#delBtn'); if(db_) db_.onclick=async()=>{ if(!confirm('Supprimer définitivement ton compte, ton programme et tout ton journal ? Cette action est irréversible.')) return; if(prompt('Tape SUPPRIMER pour confirmer')!=='SUPPRIMER') return; try{ const fn=fbFn.httpsCallable('deleteAccount'); await fn({}); try{ localStorage.clear(); }catch(e){} alert('Compte supprimé.'); location.reload(); }catch(e){ alert('Échec : '+(e.message||e)+'. Si le message parle de connexion récente, déconnecte-toi, reconnecte-toi puis réessaie.'); } };
  const vb=$('#verifBtn'); if(vb) vb.onclick=async()=>{ try{ await USER.sendEmailVerification(); vb.textContent='lien envoyé'; }catch(e){ vb.textContent='échec : '+e.message; } };
  $('#profBtn').onclick=()=>{ if(!USER) return; const sheet=showSheet(`<h3>Mon profil</h3>`+profileForm(PROFILE||{})); bindProfileForm(()=>{ hideSheet(); toast('Profil enregistré','ok'); renderReglages(); }, sheet); };
  $('#progBtn').onclick=()=>document.querySelector('.tabs button[data-tab="programme"]').click();
  $('#expBtn').onclick=()=>{ const blob=new Blob([JSON.stringify(snapshot(),null,1)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rituel-journal-'+todayISO()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); };
  $('#impFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); mergeInto(S,d); save(); render(); toast('Journal importé','ok'); }catch(err){ alert('Fichier invalide.'); } }; rd.readAsText(f); };
  $('#wakeOpt').onchange=e=>{ S.wake=e.target.checked; save(); if(!S.wake) releaseWake(); };
  const nb=$('#notifBtn'); if(nb) nb.onclick=async()=>{ if(!window.Notification) return; await Notification.requestPermission(); renderReglages(); };
  $('#reloadBtn').onclick=async()=>{ if(navigator.serviceWorker){ const r=await navigator.serviceWorker.getRegistration(); if(r){ await r.update(); } } location.reload(); };
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
  try{ await callCoach({mode:'analyse', logKey:logKeyStr, week:curWeek()}); }
  catch(e){ alert('Coach : '+(e.message||e)); }
  COACH.busy=false; renderCoach();
}
async function askCoach(text){
  if(!text.trim()||COACH.busy) return; COACH.busy=true; COACH.thread.push({role:'user',content:text}); renderCoach();
  try{ const r=await callCoach({mode:'chat', messages:COACH.thread.slice(-12), week:curWeek(), session:curSession().id}); COACH.thread.push({role:'assistant',content:r.text||''}); }
  catch(e){ COACH.thread.push({role:'assistant',content:'Erreur : '+(e.message||e)}); }
  COACH.busy=false; renderCoach();
}
function applyOverride(item){
  if(!USER||!item.adjustments) return;
  const bySession={};
  item.adjustments.forEach(a=>{ const sid=a.exId.split('-')[0]; (bySession[sid]=bySession[sid]||{}); bySession[sid][a.exId]=a; });
  Object.entries(bySession).forEach(([sid,adj])=>col('overrides').doc(sid).set({adj, fromCoach:item.id, updatedAt:Date.now()}));
  col('coach').doc(item.id).set({applied:true},{merge:true});
}
function renderCoach(){
  const el=$('#tab-coach'); if(!el||!PROGRAM_LOADED||!PROGRAM.sessions.length) return;
  let h=`<h2>Coach</h2>`;
  if(!USER){ h+=`<p class="small muted">Connecte-toi (Réglages) pour activer le Coach : analyse de chaque séance, ajustement des charges, réponses sur ta progression.</p>`; el.innerHTML=h; return; }
  const date=todayISO(), ses=curSession(), log=S.logs[logKey(date,ses.id)];
  const todayAnalysed=COACH.items.some(i=>i.logKey===logKey(date,ses.id));
  h+=`<div class="row2"><button class="btn acc" id="anaBtn" ${COACH.busy||!log||!Object.keys(log.sets||{}).length?'disabled':''}>${COACH.busy?'Analyse en cours…':todayAnalysed?'Ré-analyser la séance du jour':'Analyser la séance du jour'}</button></div>`;
  h+=`<div class="chat">`+COACH.thread.map(m=>`<div class="msg ${m.role}">${esc(m.content).replace(/\n/g,'<br>')}</div>`).join('')+(COACH.busy&&COACH.thread.length&&COACH.thread[COACH.thread.length-1].role==='user'?'<div class="msg assistant muted">…</div>':'')+`</div>`;
  h+=`<form class="ask" id="askForm"><input id="askInput" placeholder="Question au coach (charges, douleur, garde, nutrition…)" autocomplete="off"><button class="btn fill" type="submit" ${COACH.busy?'disabled':''}>Envoyer</button></form>`;
  h+=`<h3>Analyses</h3>`;
  if(!COACH.items.length) h+=`<div class="empty"><div class="ic">◎</div><b>Pas encore d'analyse</b><p class="small muted">Fais une séance, valide tes séries, appuie sur « Séance terminée » : le coach analyse et propose les charges de la prochaine fois.</p></div>`;
  COACH.items.forEach(it=>{
    if(it.type==='bilan'||it.type==='cycleEnd'||it.type==='nudge'){
      const lbl={ok:'OK',up:'En hausse',hold:'Stable',warn:'Attention'};
      h+=`<div class="ana ${it.type}"><div class="anah"><b>${esc(it.title||'')}</b><span class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''}</span></div>`;
      if(it.analysis) h+=`<div class="anab">${esc(it.analysis).replace(/\n/g,'<br>')}</div>`;
      if(it.highlights&&it.highlights.length) h+=`<div class="hl">${it.highlights.map(x=>`<div class="hli s-${esc(x.status||'ok')}"><span class="v">${esc(x.value)}</span><span class="l">${esc(x.label)}</span></div>`).join('')}</div>`;
      if(it.alerts&&it.alerts.length) h+=`<div class="banner">${it.alerts.map(esc).join('<br>')}</div>`;
      if(it.nextWeek) h+=`<p class="coachline"><b>Semaine prochaine</b> ${esc(it.nextWeek)}</p>`;
      if(it.type==='cycleEnd') h+=`<div class="adj"><button class="btn fill" id="nextCycleBtn">Générer le cycle suivant avec le coach</button></div>`;
      if(it.type==='nudge') h+=`<div class="adj"><button class="btn sm acc" data-goseance>Ouvrir la séance du jour</button></div>`;
      h+=`</div>`; return;
    }
    const adjBy={}; (it.adjustments||[]).forEach(a=>adjBy[a.exId]=a);
    const exs=(it.exercises&&it.exercises.length)?it.exercises:(it.adjustments||[]).map(a=>({exId:a.exId,name:a.name,done:'',read:a.reason,status:'up'}));
    const lbl={ok:'OK',up:'Charger',hold:'Plus de reps',warn:'À revoir'};
    h+=`<div class="ana"><div class="anah"><b>${esc(it.title||it.logKey||'')}</b><span class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''}</span></div>`;
    if(it.analysis){ const long=it.analysis.length>260; h+=`<div class="anab ${long?'clamp':''}" data-clamp>${esc(it.analysis).replace(/\n/g,'<br>')}</div>${long?'<button class="link" data-unclamp>Lire la suite</button>':''}`; }
    if(exs.length){
      h+=`<div class="exl2">`+exs.map(e=>{ const a=adjBy[e.exId]; return `<div class="exc"><div class="l1"><b>${esc(e.name)}</b><span class="st s-${esc(e.status||'ok')}">${lbl[e.status]||'OK'}</span></div><div class="l2"><span class="done">${esc(e.done||'—')}</span>${a?`<span class="arrow">→</span><span class="next">${esc(a.change)}</span>`:''}</div></div>`; }).join('')+`</div>`;
      h+=`<details class="more"><summary>Le détail du coach</summary><div class="exl">${exs.map(e=>{ const a=adjBy[e.exId]; return `<div class="exr s-${esc(e.status||'ok')}"><i></i><div><b>${esc(e.name)}</b><div class="read">${esc(e.read||'')}${a&&a.reason?' <span class="muted">— '+esc(a.reason)+'</span>':''}</div></div></div>`; }).join('')}</div></details>`;
    }
    if(it.nextFocus) h+=`<p class="coachline"><b>Prochaine fois</b> ${esc(it.nextFocus)}</p>`;
    if(it.adjustments&&it.adjustments.length){ h+=`<div class="adj">${it.applied?'<span class="tag ok">appliqué à la prochaine séance</span>':`<button class="btn sm acc" data-apply="${it.id}">Appliquer ces charges à la prochaine séance</button>`}</div>`; }
    h+=`</div>`;
  });
  el.innerHTML=h;
  el.querySelectorAll('[data-unclamp]').forEach(b=>b.onclick=()=>{ b.previousElementSibling.classList.remove('clamp'); b.remove(); });
  const ab=$('#anaBtn'); if(ab) ab.onclick=()=>analyseSession(logKey(date,ses.id));
  $('#askForm').onsubmit=e=>{ e.preventDefault(); const v=$('#askInput').value; $('#askInput').value=''; askCoach(v); };
  el.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>applyOverride(COACH.items.find(i=>i.id===b.dataset.apply)));
  const nc=$('#nextCycleBtn'); if(nc) nc.onclick=()=>{ document.querySelector('.tabs button[data-tab="programme"]').click(); regenerateProgram(); };
  el.querySelectorAll('[data-goseance]').forEach(b=>b.onclick=()=>document.querySelector('.tabs button[data-tab="seance"]').click());
  updateCoachBadge();
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
  const head=`<div class="gateh"><div class="logo" role="img" aria-label="Rituel"></div><p class="lede">Ton programme, ton coach, ta séance du jour.</p></div>`;
  const feats=`<div class="feats"><div><b>01</b><span>Un mésocycle construit sur ton profil, ton matériel, tes objectifs.</span></div><div><b>02</b><span>La séance guidée : charges, RIR, tempo, chrono de repos automatique. Sans réseau.</span></div><div><b>03</b><span>Après chaque séance, le coach analyse et ajuste la suivante.</span></div></div>`;
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
  if(!$('#tab-seance')) m.innerHTML=`<section id="tab-seance"></section><section id="tab-coach" hidden></section><section id="tab-programme" hidden></section><section id="tab-suivi" hidden></section><section id="tab-reglages" hidden></section>`;
  document.querySelector('.tabs').hidden=false; document.querySelector('.top').hidden=false;
}
function showOnboarding(step){
  restoreShell(); document.querySelector('.tabs').hidden=true; $('#weekChip').hidden=true;
  const m=document.querySelector('main');
  if(step==='profile'||!PROFILE){ onbStep(0); return; }
  m.innerHTML=`<section class="onb"><div class="onb-prog"><i style="width:100%"></i></div><h2>Ton programme</h2>
    <p>Le coach construit un mésocycle de 4 semaines à partir de ton profil : séances, exercices, séries, repos, avec pour chaque exercice pourquoi il est là et comment l'exécuter. Tu pourras ensuite le faire évoluer avec lui.</p>
    <div class="row2"><button class="btn fill" id="genBtn">Générer mon programme</button></div>
    <div id="genWait" hidden><div class="wait"><div class="spin"></div><div><b id="genStep">Le coach lit ton profil…</b><p class="small muted">Une à deux minutes. Tu peux garder l'écran ouvert ou revenir plus tard, le programme t'attendra.</p></div></div></div>
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
  m.innerHTML=`<section class="onb"><div class="onb-prog"><i style="width:${Math.round(100*(i+1)/(steps.length+1))}%"></i></div><p class="eyebrow">Étape ${i+1} sur ${steps.length}</p><h2>${st.t}</h2><p class="small muted">${st.s}</p>
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
  const stepsTxt=['Le coach lit ton profil…','Il choisit les exercices pour ton matériel…','Il règle séries, repos et progression sur 4 semaines…','Il rédige les explications de chaque exercice…','Dernières vérifications…']; let k=0;
  const iv=setInterval(()=>{ k=Math.min(k+1,stepsTxt.length-1); const e=$('#genStep'); if(e) e.textContent=stepsTxt[k]; },18000);
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); await fn({mode:'program'}); }
  catch(e){ if(msg) msg.textContent='Échec : '+(e.message||e); if(btn){ btn.hidden=false; btn.textContent='Réessayer'; } if(wait) wait.hidden=true; }
  clearInterval(iv);
}
async function saveProgram(prog, cycleHtml){
  const doc=JSON.parse(JSON.stringify(prog)); doc.cycleHtml=cycleHtml||doc.cycleHtml||''; doc.savedAt=Date.now();
  await fbDb.collection('users').doc(USER.uid).collection('meta').doc('program').set(doc);
}
function applyProgram(p){
  PROGRAM=p; if(p.weeks&&p.weeks.length) WEEKS=p.weeks; PROGRAM_LOADED=true; $('#weekChip').hidden=false;
  const sm=document.querySelector('.brand small'); if(sm) sm.textContent=p.cycleName||'';
  restoreShell(); renderCycle(); render();
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
  }, err=>console.warn('meta',err)));
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

/* ---------- render: séance ---------- */
function render(){ if(!PROGRAM.sessions.length||!PROGRAM_LOADED||!$('#tab-seance')) return; renderSeance(); renderProgramme(); renderSuivi(); renderReglages(); renderCoach(); const w=WEEKS[curWeek()-1]; $('#weekChip').textContent=`Semaine ${w.n}`; }

function shortName(n){ n=String(n||''); if(n.length<=9) return n; const w=n.split(/\s+/); return w[0]+(w.length>1&&/^[A-Z]$/.test(w[w.length-1])?' '+w[w.length-1]:''); }
const LEX={
  rir:['RIR — répétitions en réserve','Le nombre de répétitions que tu aurais encore pu faire quand tu as arrêté la série. RIR 3 : tu en avais trois de plus dans le réservoir. RIR 0 : impossible d\'en faire une de plus. Repère simple : quand la barre ralentit franchement, tu es vers RIR 2.'],
  ressenti:['Ressenti de la série','F = facile, il restait 3 répétitions ou plus. J = juste, il en restait 1 ou 2. É = échec ou presque, 0 en réserve. Le coach s\'en sert pour décider des charges de la prochaine séance : réponds honnêtement, pas pour te faire plaisir.'],
  tempo:['Tempo','Quatre chiffres : descente, pause en bas, montée, pause en haut, en secondes. « X » veut dire explosif. 3-1-X-0 : trois secondes de descente, une seconde d\'arrêt, montée explosive, pas de pause en haut.'],
  emom:['EMOM','« Every minute on the minute » : tu démarres une série au début de chaque intervalle, le reste de l\'intervalle est ton repos. Plus tu es rapide, plus tu récupères.'],
  gtg:['GTG — grease the groove','Des séries de tractions très loin de l\'échec, réparties dans la séance, pour accumuler du volume technique sans fatigue. Jamais forcé.'],
  semaine:['Les semaines du cycle','Un mésocycle dure quatre semaines : calibrage (on pose les charges, RIR 3), accumulation (on ajoute du volume), intensification (on va près de l\'échec), décharge (on récupère avec 40 % de séries en moins). La semaine avance quand tu as fait tes séances, pas au calendrier.'],
  star:['Exercice prioritaire ★','Il reçoit une série de plus en semaines 2 et 3. C\'est là que se joue ta progression sur ce cycle.'],
};
function showSheet(html){ let s=$('#sheet'); if(!s){ s=document.createElement('div'); s.id='sheet'; s.innerHTML='<div class="sheet-bg"></div><div class="sheet-card" role="dialog"><div class="sheet-grip"></div><div class="sheet-body"></div></div>'; document.body.appendChild(s); s.querySelector('.sheet-bg').onclick=hideSheet; } s.querySelector('.sheet-body').innerHTML=html; s.classList.add('on'); document.body.style.overflow='hidden'; return s; }
function hideSheet(){ const s=$('#sheet'); if(s){ s.classList.remove('on'); document.body.style.overflow=''; } }
function showLex(key){ const l=LEX[key]; if(!l) return; showSheet(`<h3>${esc(l[0])}</h3><p>${esc(l[1])}</p><button class="btn" onclick="hideSheet()">Compris</button>`); }
let toastT=0; function toast(msg,cls){ let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); } t.textContent=msg; t.className='on '+(cls||''); clearTimeout(toastT); toastT=setTimeout(()=>t.className='',1800); }
function rirLabel(v){ return v==null?'':v>=3?'F':v>=1?'J':'É'; }

function renderSeance(){
  if(!$('#tab-seance')||!PROGRAM.sessions.length) return;
  const wk=curWeek(), W=WEEKS[wk-1], date=todayISO(), ses=curSession(), log=getLog(date,ses.id);
  const el=$('#tab-seance'); let h='';
  h+=`<div class="days">`+PROGRAM.sessions.map(s=>{ const done=Object.values(S.logs).some(l=>l.session===s.id&&l.week===wk&&l.done); return `<button data-s="${s.id}" aria-pressed="${s.id===ses.id}" class="${done?'done':''}"><b>${esc(s.dayName.slice(0,3))}</b><span>${esc(shortName(s.name))}</span></button>`; }).join('')+`<button data-s="rest" aria-pressed="false"><b>Dim</b><span>Repos</span></button></div>`;
  // état de la séance
  const flagsAll=log.flags||{};
  const states=ses.exercises.map(ex=>{ const p=rx(ex,wk); const done=(log.sets[ex.id]||[]).filter(s=>s&&s.done).length; const f=flagsAll[ex.id]||{}; return {ex,p,done,complete:done>=p.sets,skip:!!f.skip,alt:!!f.alt}; });
  const nDone=states.filter(s=>s.complete||s.skip).length, nSets=states.reduce((a,s)=>a+s.done,0);
  let current=states.find(s=>!s.complete&&!s.skip); if(S.openEx){ const o=states.find(s=>s.ex.id===S.openEx); if(o) current=o; }
  h+=`<div class="sesshead"><h2>${esc(ses.name)}</h2><span class="meta">${esc(ses.sub)} · ${esc(ses.duration)}${ses.place?' · '+esc(ses.place):''} <span id="elapsed"></span></span>
    <div class="prog"><div class="bar"><i style="width:${Math.round(100*nDone/Math.max(1,states.length))}%"></i></div><span>${nDone}/${states.length} exercices · ${nSets} série${nSets>1?'s':''}</span><button class="wk" data-lex="semaine">${esc(W.label)} · ${esc((W.rirNote||'').split('·')[0].trim())}</button></div></div>`;
  if(ses.note) h+=`<div class="banner">${esc(ses.note)}</div>`;
  if(cycleOver()) h+=`<div class="banner">Cycle terminé le ${fmtD(WEEKS[WEEKS.length-1].to)}. Prescriptions de décharge en attendant le cycle suivant (Programme → Nouveau cycle).</div>`;
  if(log.done) h+=`<div class="banner ok">Séance validée. Tu peux encore corriger les valeurs.</div>`;
  if(!log.done&&!ses.exercises.some(ex=>lastRef(ex.id,date))&&!nSets) h+=`<p class="hint">Première fois sur cette séance : note la charge de chaque série, elle servira de référence la prochaine fois.</p>`;
  const prevLog=Object.values(S.logs).filter(l=>l.session===ses.id&&l.date<date&&l.notes).sort((a,b)=>a.date<b.date?1:-1)[0];
  if(prevLog) h+=`<details class="more wu"><summary>Tes notes du ${fmtD(prevLog.date)}</summary><p class="small">${esc(prevLog.notes)}</p></details>`;
  const wu=(PROGRAM.warmup||{})[ses.id.replace(/[AB]$/,'')]; if(wu) h+=`<details class="more wu"><summary>Échauffement · 8-10 min</summary><p class="small">${esc(PROGRAM.warmup.common)}</p><p class="small">${esc(wu)}</p><p class="small">${esc(PROGRAM.warmup.ramp)}</p></details>`;
  if(ses.gtg){ h+=`<div class="ex gtg"><div class="exh"><button class="n" data-lex="gtg">GTG</button><span class="name">Tractions sous-maximales 3 × 15</span></div><p class="mach">Après l'échauffement, après l'exercice 3, avant la fin. Loin de l'échec.</p><div class="gtgrow">${[0,1,2].map(i=>`<label><input type="checkbox" data-gtg="${i}" ${log.gtg[i]?'checked':''}> Bloc ${i+1}</label>`).join('')}</div></div>`; }

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
    h+=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}${ex.per?' '+esc(ex.per):''}</b>${p.rir!=null?`<b data-lex="rir"><i>RIR</i>${p.rir}</b>`:''}<b data-lex="tempo"><i>tempo</i>${esc(ex.tempo)}</b><b><i>repos</i>${esc(p.restText)}</b>${ex.mode==='emom'?'<b data-lex="emom">EMOM</b>':''}</div>`;
    if(ex.chargeNote&&!/^RIR \d( → \d)*$/.test(ex.chargeNote)) h+=`<p class="small muted" style="margin:0 0 6px">${esc(ex.chargeNote)}</p>`;
    if(o) h+=`<p class="coachline"><b>Coach</b> ${esc(o.change)}</p>`;
    let tgtW=null;
    if(ref){ const top=ref.sets.find(s=>s.w)||ref.sets[0]; let tgt=''; if(top&&top.w&&wk>1&&wk<4){ const hi=parseInt(String(p.reps).split('-').pop()); const allHi=ref.sets.every(s=>s.r>=hi); if(allHi){ tgtW=Math.round(top.w*1.025*2)/2; tgt=` → <span class="tgt">${tgtW} kg</span>`; } else tgt=` → <span class="tgt">même charge, +1 rep</span>`; } if(wk===4&&top&&top.w){ tgtW=Math.round(top.w*0.9*2)/2; tgt=` → <span class="tgt">décharge ${tgtW} kg</span>`; } h+=`<p class="ref">Dernier (${fmtD(ref.date)}) : <b>${esc(fmtSets(ref.sets))}</b>${tgt}</p>`; }
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
    h+=`</div>`;
  });
  h+=`<div class="notes"><h3>Notes de séance</h3><textarea id="notes" placeholder="Facile, dur, douleur, machine absente, sommeil, garde…">${esc(log.notes)}</textarea></div>`;
  h+=`<div class="endrow"><button class="btn ${log.done?'':'fill'}" id="endBtn">${log.done?'Rouvrir la séance':'Séance terminée'}</button><span class="small muted">${nSets?nSets+' série'+(nSets>1?'s':'')+' validée'+(nSets>1?'s':''):'Aucune série validée'}</span></div>`;
  el.innerHTML=h;

  // events
  el.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{ const id=b.dataset.s; if(id==='rest'){ el.innerHTML=`<div class="days">${el.querySelector('.days').innerHTML}</div><h2>Dimanche — repos</h2><p>Marche 30 à 60 min, mobilité hanches et épaules 20 min. Pas de tractions.</p>`; el.querySelectorAll('.days button').forEach(x=>x.onclick=()=>{S.session=x.dataset.s==='rest'?S.session:x.dataset.s;S.openEx=null;save();renderSeance();}); return; } S.session=id; S.openEx=null; save(); renderSeance(); window.scrollTo({top:0}); });
  el.querySelectorAll('[data-lex]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); showLex(b.dataset.lex); });
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
      const sheet=showSheet(`<h3>${esc(ex.name)}</h3><p class="small muted">${esc(ex.machine)}${ex.alt?' · alternative : '+esc(ex.alt):''}</p>
        <div class="menu">
          <button data-act="explain">Pourquoi cet exercice, comment l'exécuter</button>
          ${ex.url?`<a href="${esc(ex.url)}" target="_blank" rel="noopener" data-ext>Voir la machine ↗</a>`:''}
          <button data-act="alt">${flags.alt?'✓ Alternative utilisée (annuler)':'Machine absente, j\'utilise l\'alternative'}</button>
          <button data-act="skip">${flags.skip?'✓ Exercice sauté (annuler)':'Sauter cet exercice aujourd\'hui'}</button>
          <div class="row2"><span class="small muted">Chrono</span><button class="btn sm" data-rest="60">1:00</button><button class="btn sm" data-rest="120">2:00</button><button class="btn sm" data-rest="180">3:00</button></div>
        </div>`);
      sheet.querySelectorAll('[data-act]').forEach(x=>x.onclick=()=>{ const act=x.dataset.act; if(act==='explain'){ let d='<dl class="dl">'; if(ex.reco) d+=`<dt>Reconnaître la machine</dt><dd>${esc(ex.reco)}</dd>`; if(ex.why) d+=`<dt>Pourquoi</dt><dd>${esc(ex.why)}</dd>`; if(ex.target) d+=`<dt>Cible</dt><dd>${esc(ex.target)}</dd>`; if(ex.exec) d+=`<dt>Exécution</dt><dd>${esc(ex.exec)}</dd>`; if(ex.seek) d+=`<dt class="seek">Ce qu'on cherche</dt><dd>${esc(ex.seek)}</dd>`; d+='</dl>'; showSheet(`<h3>${esc(ex.name)}</h3>${d}<button class="btn" onclick="hideSheet()">Fermer</button>`); return; }
        log.flags=log.flags||{}; const f=log.flags[exId]||(log.flags[exId]={}); f[act]=!f[act]; touch(log); hideSheet(); if(act==='skip'&&f.skip) S.openEx=null; save(); renderSeance(); });
      sheet.querySelectorAll('[data-rest]').forEach(x=>x.onclick=()=>{ startTimer(+x.dataset.rest,`Repos · ${ex.name}`,''); hideSheet(); });
    };
  });
  $('#notes').onchange=e=>{ log.notes=e.target.value; touch(log); toast('Note enregistrée'); };
  updateElapsed(log);
  $('#endBtn').onclick=()=>{ log.done=!log.done; touch(log); stopTimer(); if(log.done){ releaseWake(); S.openEx=null; save(); toast('Séance enregistrée','ok'); if(USER&&navigator.onLine){ analyseSession(logKey(log.date,log.session)); document.querySelector('.tabs button[data-tab="coach"]').click(); } } renderSeance(); if(log.done) window.scrollTo({top:0}); };
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
  const wk=curWeek(); let h=`<h2>Programme · S${wk}</h2><p class="small muted">${esc(PROGRAM.cycleName||'')} · prescriptions de la semaine affichée. Change de semaine avec la puce en haut.</p><div class="row2"><button class="btn sm" id="regenBtn">Nouveau cycle avec le coach</button></div>`;
  PROGRAM.sessions.forEach(s=>{
    h+=`<h3>${esc(s.dayName)} — ${esc(s.name)} <span class="muted small">(${esc(s.sub)})</span></h3><div class="pcard">`;
    s.exercises.forEach(ex=>{ const p=rx(ex,wk); h+=`<div class="prow"><span class="n">${ex.n}</span><span class="nm">${esc(ex.name)}${ex.star?' <span style="color:var(--accent)">★</span>':''}</span><span class="rx2">${p.sets}×${esc(p.reps)}${p.rir!=null?' · RIR '+p.rir:''}</span><span class="mc">${esc(ex.machine)} · ${esc(ex.tempo)} · repos ${esc(p.restText)}</span></div>`; });
    h+=`</div>`;
  });
  h+=`<details class="cyc doc"><summary>Lire le cycle</summary>${cycleHtml()}</details>`;
  $('#tab-programme').innerHTML=h;
  const rb=$('#regenBtn'); if(rb) rb.onclick=regenerateProgram;
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
function renderSuivi(){
  const el=$('#tab-suivi'); if(!el) return; const date=todayISO();
  const bws=Object.values(S.bw).sort((a,b)=>a.date<b.date?1:-1); const tests=Object.values(S.tests).sort((a,b)=>a.date<b.date?1:-1);
  const doneCount=Object.values(S.logs).filter(l=>l.done).length;
  const emomEx=PROGRAM.sessions.flatMap(s=>s.exercises.map(e=>({...e,sid:s.id}))).find(e=>e.mode==='emom'); const hasEmom=!!emomEx;
  const emom=hasEmom?Object.values(S.logs).filter(l=>l.session===emomEx.sid&&l.sets[emomEx.id]).map(l=>({date:l.date,total:l.sets[emomEx.id].filter(s=>s&&s.done).reduce((a,s)=>a+(s.r||0),0)})).sort((a,b)=>a.date<b.date?1:-1):[];
  const wkNow=curWeek(); const weekDone=Object.values(S.logs).filter(l=>l.done&&l.week===wkNow).length;
  let h=`<h2>Suivi</h2><div class="kv">
    <div><div class="k">${bws[0]?bws[0].kg.toFixed(1)+' kg':(PROFILE&&PROFILE.weight?PROFILE.weight+' kg':'—')}</div><div class="l">poids${bws[0]?' · '+fmtD(bws[0].date):' · profil'}</div></div>
    <div><div class="k">${tests[0]?tests[0].reps:'—'}</div><div class="l">tractions max${tests[0]?' · '+fmtD(tests[0].date):''}</div></div>
    ${hasEmom?`<div><div class="k">${emom[0]?emom[0].total:'—'}</div><div class="l">reps EMOM dernière séance</div></div>`:`<div><div class="k">${weekDone}/${PROGRAM.sessions.length}</div><div class="l">séances cette semaine</div></div>`}
    <div><div class="k">${doneCount}</div><div class="l">séances validées</div></div></div>`;
  const st=suiviStats(); const last=st.weeks.filter(w=>!w.future).slice(-1)[0]||st.weeks[0]; const maxSets=Math.max(1,...st.weeks.map(w=>w.total));
  h+=`<h3>Assiduité et volume</h3><div class="wkbars">${st.weeks.map(w=>`<div class="wkb ${w===last?'cur':''} ${w.future?'fut':''}"><div class="bar"><i style="height:${Math.round(100*w.total/maxSets)}%"></i></div><b>${w.future?'·':w.done+'/'+w.planned}</b><span>S${w.k+1}</span></div>`).join('')}</div><p class="small muted">Séances faites sur prévues par semaine, hauteur = séries validées${last.tonnage?` · cette semaine ${Math.round(last.tonnage/1000*10)/10} t soulevées`:''}.</p>`;
  const groups=Object.entries(last.sets).sort((a,b)=>b[1]-a[1]);
  if(groups.length){ const mx=groups[0][1]; h+=`<div class="mus">${groups.map(([m,n])=>`<div class="musr"><span>${esc(m)}</span><div class="bar"><i style="width:${Math.round(100*n/mx)}%"></i></div><b>${n}</b></div>`).join('')}</div><p class="small muted">Séries par groupe musculaire cette semaine. Repère : 10 à 20 séries par groupe et par semaine pour progresser.</p>`; }
  if(st.prs.length) h+=`<h3>Records récents</h3><div class="prs">${st.prs.map(p=>`<div class="pr"><b>${esc(p.name)}</b><span>${p.w} kg × ${p.r} · e1RM ${p.v} kg</span><i>${fmtD(p.date)}</i></div>`).join('')}</div>`;
  h+=`<h3>Poids de corps</h3><p class="small muted">Deux pesées par semaine, à jeun. La moyenne compte, pas la valeur isolée.</p><div class="inline"><input type="date" id="bwDate" value="${date}"><input type="number" step="0.1" inputmode="decimal" id="bwKg" placeholder="kg"><button class="btn sm acc" id="bwAdd">Enregistrer</button></div>`;
  if(bws.length){ const avg7=bws.filter(b=>b.date>=addDays(date,-7)); h+=`<p class="small">Moyenne 7 j : <b>${avg7.length?(avg7.reduce((a,b)=>a+b.kg,0)/avg7.length).toFixed(1):'—'} kg</b> · ${bws.slice(0,8).map(b=>fmtD(b.date)+' '+b.kg.toFixed(1)).join(' · ')}</p>`; }
  h+=`<h3>Test tractions</h3><div class="inline"><input type="date" id="tDate" value="${date}"><input type="number" inputmode="numeric" id="tReps" placeholder="reps"><button class="btn sm acc" id="tAdd">Enregistrer</button></div>`;
  if(tests.length) h+=`<p class="small">${tests.map(t=>fmtD(t.date)+' : '+t.reps).join(' · ')}</p>`;
  h+=`<h3>Progression par exercice</h3><div class="inline"><select id="exSel">`;
  PROGRAM.sessions.forEach(s=>{ h+=`<optgroup label="${esc(s.name)}">`; s.exercises.forEach(ex=>{ h+=`<option value="${ex.id}" ${suiviEx===ex.id?'selected':''}>${ex.n}. ${esc(ex.name)}</option>`; }); h+=`</optgroup>`; });
  h+=`</select></div><div id="exHist"></div>`;
  h+=`<h3>Journal</h3>`;
  const logs=Object.values(S.logs).filter(l=>Object.keys(l.sets).length||l.done||l.notes).sort((a,b)=>a.date<b.date?1:-1);
  if(!logs.length) h+=`<div class="empty"><b>Journal vide</b><p class="small muted">Chaque série validée en séance apparaît ici.</p></div>`;
  else h+=`<div class="tw"><table><thead><tr><th>Date</th><th>Séance</th><th>S</th><th>Séries</th><th>Notes</th></tr></thead><tbody>${logs.map(l=>{ const s=PROGRAM.sessions.find(x=>x.id===l.session); const n=Object.values(l.sets).flat().filter(x=>x&&x.done).length; return `<tr><td class="num">${fmtD(l.date)}</td><td>${s?esc(s.name):l.session}${l.done?' ✓':''}</td><td class="num">${l.week}</td><td class="num">${n}</td><td class="small">${esc(l.notes)}</td></tr>`; }).join('')}</tbody></table></div>`;
  el.innerHTML=h;
  $('#bwAdd').onclick=()=>{ const d=$('#bwDate').value, kg=parseFloat($('#bwKg').value); if(!d||isNaN(kg)) return; S.bw[d]={date:d,kg,updatedAt:Date.now()}; save(); writeDoc('bw',d,S.bw[d]); renderSuivi(); };
  $('#tAdd').onclick=()=>{ const d=$('#tDate').value, r=parseInt($('#tReps').value); if(!d||isNaN(r)) return; S.tests[d]={date:d,reps:r,updatedAt:Date.now()}; save(); writeDoc('tests',d,S.tests[d]); renderSuivi(); };
  const sel=$('#exSel'); if(!suiviEx) suiviEx=sel.value; sel.value=suiviEx; sel.onchange=()=>{ suiviEx=sel.value; renderHist(); }; renderHist();
}
function addDays(iso,n){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function renderHist(){
  const hist=history(suiviEx).slice().reverse(); const el=$('#exHist'); const ex=PROGRAM.sessions.flatMap(s=>s.exercises).find(e=>e.id===suiviEx);
  if(!hist.length){ el.innerHTML=`<p class="muted small">Pas encore de séries validées pour ${esc(ex.name)}.</p>`; return; }
  const isEmom=ex.mode==='emom';
  const pts=hist.map(h=>isEmom?h.sets.reduce((a,s)=>a+(s.r||0),0):Math.round(h.sets.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0)*10)/10);
  let svg='';
  if(pts.length>=2){ const W=600,H=120,pl=36,pr=10,pt=12,pb=20; const mn=Math.min(...pts),mx=Math.max(...pts); const lo=mn===mx?mn-1:mn, hi=mn===mx?mx+1:mx; const x=i=>pl+(W-pl-pr)*i/(pts.length-1), y=v=>pt+(H-pt-pb)*(1-(v-lo)/(hi-lo)); svg=`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="g" x1="${pl}" x2="${W-pr}" y1="${y(lo)}" y2="${y(lo)}"/><line class="g" x1="${pl}" x2="${W-pr}" y1="${y(hi)}" y2="${y(hi)}"/><text x="2" y="${y(hi)+4}">${hi}</text><text x="2" y="${y(lo)+4}">${lo}</text><polyline class="l" points="${pts.map((v,i)=>x(i)+','+y(v)).join(' ')}"/>${pts.map((v,i)=>`<circle class="d" cx="${x(i)}" cy="${y(v)}" r="3"/>`).join('')}${hist.map((h,i)=>`<text x="${x(i)}" y="${H-6}" text-anchor="middle">${fmtD(h.date)}</text>`).join('')}</svg>`; }
  el.innerHTML=`<p class="small muted">${isEmom?'Total de reps par séance':'Meilleure série convertie en 1RM estimé (Epley)'} — ${esc(ex.name)}</p>${svg}<div class="tw"><table><thead><tr><th>Date</th><th>S</th><th>Séries</th><th>${isEmom?'Total':'e1RM'}</th></tr></thead><tbody>${hist.slice().reverse().map((h,i)=>`<tr><td class="num">${fmtD(h.date)}</td><td class="num">${h.week}</td><td class="num">${esc(fmtSets(h.sets))}</td><td class="num">${pts[pts.length-1-i]}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- tabs, week ---------- */
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); if(b.dataset.tab==='coach'){ S.coachSeen=Date.now(); save(); b.classList.remove('badge'); } ['seance','coach','programme','suivi','reglages'].forEach(t=>{ const s=$('#tab-'+t); if(s) s.hidden=t!==b.dataset.tab; }); window.scrollTo({top:0}); });
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
