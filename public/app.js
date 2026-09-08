
const APP_VERSION='3.1.2';
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

/* ---------- state ---------- */
const KEY='rituel.v1';
let S = {logs:{}, bw:{}, tests:{}, overrides:{}, weekOverride:null, session:null, wake:true};
try{ const raw=localStorage.getItem(KEY); if(raw) S=Object.assign(S,JSON.parse(raw)); }catch(e){}
function save(){ const j=JSON.stringify(S); try{ localStorage.setItem(KEY, j); }catch(e){} idbSet(j); }
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open('rituel',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbSet(j){ try{ idb().then(d=>{ d.transaction('kv','readwrite').objectStore('kv').put(j,KEY); }).catch(()=>{}); }catch(e){} }
function idbGet(){ return new Promise(res=>{ try{ idb().then(d=>{ const q=d.transaction('kv').objectStore('kv').get(KEY); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }).catch(()=>res(null)); }catch(e){ res(null); } }); }
try{ navigator.storage&&navigator.storage.persist&&navigator.storage.persist(); }catch(e){}

function weekFor(iso){ const w=WEEKS.find(w=>iso>=w.from&&iso<=w.to); if(w) return w.n; return iso<WEEKS[0].from?1:WEEKS.length; }
function cycleOver(){ return todayISO()>WEEKS[WEEKS.length-1].to; }
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
    fbAuth.getRedirectResult().catch(e=>console.warn('redirect',e));
    fbAuth.onAuthStateChanged(u=>{ USER=u||null; onAuth(); });
  }catch(e){ console.warn('firebase init',e); setSync('off','local'); }
}
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }
async function signOut(){ unsubs.forEach(u=>u()); unsubs=[]; await fbAuth.signOut(); }
function col(name){ return fbDb.collection('users').doc(USER.uid).collection(name); }

async function onAuth(){
  unsubs.forEach(u=>u()); unsubs=[];
  if(!USER){ PROGRAM_LOADED=false; showGate(); syncStatusIdle(); return; }
  restoreShell(); setSync('pend','connexion…'); listenMeta();
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
  el.innerHTML=`<h2>Réglages</h2>
  <h3>Compte</h3>
  ${USER?`<p>Connecté : <b>${esc(USER.displayName||'')}</b> <span class="muted small">${esc(USER.email||'')}</span>${USER.providerData&&USER.providerData.some(p=>p.providerId==='password')&&!USER.emailVerified?' <button class="link" id="verifBtn">e-mail non vérifié · renvoyer le lien</button>':''}</p><p class="small muted">Tes séances sont synchronisées sur tous tes appareils. Hors ligne, tout est conservé sur le téléphone puis envoyé au retour du réseau.</p><div class="row2"><button class="btn" id="signOut">Se déconnecter</button></div>`
        :''}
  <h3>Profil</h3>
  <details class="more" id="profDet"><summary>Modifier mon profil</summary>${USER?profileForm(PROFILE||{}):''}</details>
  <h3>Sauvegarde</h3>
  <div class="row2"><button class="btn" id="expBtn">Exporter le journal (JSON)</button><label class="btn" for="impFile">Importer</label><input id="impFile" type="file" accept="application/json" hidden></div>
  <h3>Appareil</h3>
  <div class="row2"><label class="gtgrow"><input type="checkbox" id="wakeOpt" ${S.wake!==false?'checked':''}> Garder l'écran allumé pendant une séance</label></div>
  <div class="row2"><button class="btn" id="notifBtn">Autoriser les notifications</button><span class="small muted" id="notifMsg">${window.Notification?({granted:'autorisées',denied:'refusées',default:'pas encore demandées'}[Notification.permission]||Notification.permission):'non supporté sur cet appareil'}</span></div>
  <h3>Confidentialité</h3>
  <p class="small muted">Tes données (profil, séances, analyses) sont stockées en Europe sur Firebase et transmises à l'API Anthropic uniquement pour les analyses du coach. <a href="confidentialite.html" target="_blank" rel="noopener">Politique de confidentialité</a>.</p>
  ${USER?`<div class="row2"><button class="btn sm" id="delBtn">Supprimer mon compte et mes données</button></div>`:''}
  <p class="small muted">Version ${APP_VERSION}. <button class="link" id="reloadBtn">Recharger l'application</button></p>`;
  const so=$('#signOut'); if(so) so.onclick=signOut;
  const db_=$('#delBtn'); if(db_) db_.onclick=async()=>{ if(!confirm('Supprimer définitivement ton compte, ton programme et tout ton journal ? Cette action est irréversible.')) return; if(prompt('Tape SUPPRIMER pour confirmer')!=='SUPPRIMER') return; try{ const fn=fbFn.httpsCallable('deleteAccount'); await fn({}); try{ localStorage.clear(); }catch(e){} alert('Compte supprimé.'); location.reload(); }catch(e){ alert('Échec : '+(e.message||e)+'. Si le message parle de connexion récente, déconnecte-toi, reconnecte-toi puis réessaie.'); } };
  const vb=$('#verifBtn'); if(vb) vb.onclick=async()=>{ try{ await USER.sendEmailVerification(); vb.textContent='lien envoyé'; }catch(e){ vb.textContent='échec : '+e.message; } };
  if($('#profForm')) bindProfileForm(()=>{ $('#profDet').open=false; alert('Profil enregistré. Le coach en tient compte dès la prochaine analyse.'); });
  $('#expBtn').onclick=()=>{ const blob=new Blob([JSON.stringify(snapshot(),null,1)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rituel-journal-'+todayISO()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); };
  $('#impFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); mergeInto(S,d); save(); render(); alert('Import fusionné.'); }catch(err){ alert('Fichier invalide.'); } }; rd.readAsText(f); };
  $('#wakeOpt').onchange=e=>{ S.wake=e.target.checked; save(); if(!S.wake) releaseWake(); };
  $('#notifBtn').onclick=async()=>{ if(!window.Notification) return; const p=await Notification.requestPermission(); $('#notifMsg').textContent=({granted:'autorisées',denied:'refusées',default:'pas encore demandées'}[p]||p); };
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
  if(!COACH.items.length) h+=`<p class="small muted">Aucune analyse. Termine une séance puis lance l'analyse.</p>`;
  COACH.items.forEach(it=>{
    h+=`<div class="ana"><div class="anah"><b>${esc(it.title||it.logKey||'')}</b><span class="small muted">${it.createdAt?new Date(it.createdAt).toLocaleDateString('fr-FR'):''}</span></div><div class="anab">${esc(it.analysis||'').replace(/\n/g,'<br>')}</div>${it.nextFocus?`<p class="coachline"><b>Prochaine fois</b> ${esc(it.nextFocus)}</p>`:''}`;
    if(it.adjustments&&it.adjustments.length){ h+=`<div class="adj"><b class="small">Ajustements proposés pour la prochaine séance</b><ul>${it.adjustments.map(a=>`<li><b>${esc(a.name||a.exId)}</b> : ${esc(a.change)}${a.reason?' <span class="muted">— '+esc(a.reason)+'</span>':''}</li>`).join('')}</ul>${it.applied?'<span class="tag ok">appliqué</span>':`<button class="btn sm acc" data-apply="${it.id}">Appliquer</button>`}</div>`; }
    h+=`</div>`;
  });
  el.innerHTML=h;
  const ab=$('#anaBtn'); if(ab) ab.onclick=()=>analyseSession(logKey(date,ses.id));
  $('#askForm').onsubmit=e=>{ e.preventDefault(); const v=$('#askInput').value; $('#askInput').value=''; askCoach(v); };
  el.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>applyOverride(COACH.items.find(i=>i.id===b.dataset.apply)));
}

/* ---------- Palier 2 : profil et programme par utilisateur ----------
   users/{uid}/meta/profile  — qui est l'athlète (saisi à la première connexion, modifiable dans Réglages)
   users/{uid}/meta/program  — son programme, généré par le coach à partir du profil (ou importé)
   Sans compte : écran d'accueil uniquement. */
let PROFILE=null, PROGRAM_LOADED=false, DEFAULT_PROGRAM=null, DEFAULT_CYCLE_HTML='';
const GOALS=[['force','Force maximale'],['masse','Prise de muscle'],['seche','Sécher, se dessiner'],['endurance','Endurance musculaire'],['puissance','Puissance, vitesse'],['tractions','Tractions (nombre)'],['jambes','Rattraper les jambes'],['bras','Bras et pectoraux'],['sante','Santé, mobilité, dos'],['perf','Performance sportive / opérationnelle']];
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
  restoreShell(); document.querySelector('.tabs').hidden=true;
  const m=document.querySelector('main');
  if(step==='profile'||!PROFILE){ m.innerHTML=`<section class="onb"><h2>Ton profil</h2><p class="small muted">Le coach construit ton programme et ses analyses à partir de ces réponses. Modifiable ensuite dans Réglages.</p>${profileForm(PROFILE||{})}</section>`; bindProfileForm(()=>showOnboarding('program')); return; }
  m.innerHTML=`<section class="onb"><h2>Ton programme</h2>
    <p>Le coach va construire un mésocycle de 4 semaines à partir de ton profil, de ton matériel et de tes objectifs : séances, exercices, séries, RIR, tempo, repos, avec pour chaque exercice pourquoi il est là et comment l'exécuter.</p>
    <div class="row2"><button class="btn fill" id="genBtn">Générer mon programme</button></div>
    <p class="small muted" id="genMsg"></p>
    ${DEFAULT_PROGRAM?`<details class="more"><summary>Autre option</summary><p class="small">Importer le programme « ${esc(DEFAULT_PROGRAM.cycleName||'Fondations')} » tel quel (prévu pour un athlète confirmé, 6 séances par semaine, parc ON AIR Lyon).</p><button class="btn sm" id="importBtn">Importer ce programme</button></details>`:''}
  </section>`;
  $('#genBtn').onclick=()=>generateProgram();
  const ib=$('#importBtn'); if(ib) ib.onclick=()=>saveProgram(DEFAULT_PROGRAM, DEFAULT_CYCLE_HTML);
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
    <label>Salle et matériel<textarea name="equipment" rows="3" placeholder="Ex. : ON AIR Lyon, parc complet Technogym / Hammer Strength / Panatta, cages, presse, poulies. Ou : garage, barre, haltères jusqu'à 30 kg, barre de traction." required>${esc(p.equipment||'')}</textarea></label>
    <label>Contraintes, blessures, métier<textarea name="constraints" rows="2" placeholder="Ex. : gardes de 24 h, épaule droite sensible, pas de squat lourd, entraînement le matin">${esc(p.constraints||'')}</textarea></label>
    <label>Expérience et repères actuels<textarea name="experience" rows="2" placeholder="Ex. : squat 100 kg × 5, 35 tractions, développé couché 80 kg, 3 ans de PPL">${esc(p.experience||'')}</textarea></label>
    <div class="row2"><button class="btn fill" type="submit">Enregistrer</button></div></form>`;
}
function bindProfileForm(after){
  $('#profForm').onsubmit=async e=>{ e.preventDefault(); const f=new FormData(e.target); const p={}; for(const [k,v] of f.entries()){ if(k==='goals') (p.goals=p.goals||[]).push(v); else p[k]=String(v).trim(); }
    ['age','height','weight','days','minutes'].forEach(k=>p[k]=Number(p[k])); p.updatedAt=Date.now(); if(!PROFILE||!PROFILE.createdAt) p.createdAt=Date.now(); else p.createdAt=PROFILE.createdAt;
    PROFILE=p; try{ await fbDb.collection('users').doc(USER.uid).collection('meta').doc('profile').set(p); }catch(err){ alert('Enregistrement impossible : '+err.message); return; }
    after&&after(); };
}
async function generateProgram(){
  const msg=$('#genMsg'), btn=$('#genBtn'); if(btn){ btn.disabled=true; btn.textContent='Génération en cours…'; }
  if(msg) msg.textContent='Le coach rédige ton mésocycle, compte une à deux minutes.';
  try{ const fn=fbFn.httpsCallable('coach',{timeout:540000}); await fn({mode:'program'}); }
  catch(e){ if(msg) msg.textContent='Échec : '+(e.message||e); if(btn){ btn.disabled=false; btn.textContent='Réessayer'; } }
}
async function saveProgram(prog, cycleHtml){
  const doc=JSON.parse(JSON.stringify(prog)); doc.cycleHtml=cycleHtml||doc.cycleHtml||''; doc.savedAt=Date.now();
  await fbDb.collection('users').doc(USER.uid).collection('meta').doc('program').set(doc);
}
function applyProgram(p){
  PROGRAM=p; if(p.weeks&&p.weeks.length) WEEKS=p.weeks; PROGRAM_LOADED=true;
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
    let prof=null, prog=null; snap.docs.forEach(d=>{ if(d.id==='profile') prof=d.data(); if(d.id==='program') prog=d.data(); });
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
async function requestWake(){ if(S.wake===false) return; try{ if('wakeLock' in navigator && !wakeLock){ wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{wakeLock=null;}); } }catch(e){} }
function releaseWake(){ try{ wakeLock&&wakeLock.release(); }catch(e){} wakeLock=null; }
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&sessionActive()) requestWake(); });
function sessionActive(){ if(!PROGRAM.sessions.length) return false; const l=S.logs[logKey(todayISO(),curSession().id)]; return !!(l&&!l.done&&Object.keys(l.sets).length); }

/* ---------- timer ---------- */
let T={end:0,total:0,raf:0,label:'',fired:false};
let audioCtx=null;
function unlockAudio(){ try{ if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); } if(audioCtx.state==='suspended') audioCtx.resume(); }catch(e){} }
function beep(n=3){ try{ if(!audioCtx) return; let t=audioCtx.currentTime; for(let i=0;i<n;i++){ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.type='square'; o.frequency.value=880; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.4,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.22); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.25); t+=0.32; } }catch(e){} }
function startTimer(sec,l1,l2){ unlockAudio(); T.end=Date.now()+sec*1000; T.total=sec; T.fired=false; $('#tL1').textContent=l1; $('#tL2').textContent=l2||''; $('#timer').classList.add('on'); cancelAnimationFrame(T.raf); tick(); }
function stopTimer(){ cancelAnimationFrame(T.raf); $('#timer').classList.remove('on'); document.title='Rituel'; }
function tick(){
  const left=Math.round((T.end-Date.now())/1000); const a=Math.abs(left);
  $('#tT').textContent=(left<0?'+':'')+Math.floor(a/60)+':'+String(a%60).padStart(2,'0');
  $('#tT').classList.toggle('over',left<0);
  $('#tBar').style.width=Math.max(0,Math.min(100,100*(1-left/T.total)))+'%';
  document.title=(left<=0?'GO · ':Math.floor(a/60)+':'+String(a%60).padStart(2,'0')+' · ')+'Rituel';
  if(left<=0&&!T.fired){ T.fired=true; beep(3); try{navigator.vibrate&&navigator.vibrate([200,100,200,100,400]);}catch(e){} if(document.hidden&&window.Notification&&Notification.permission==='granted'){ try{ new Notification('Repos terminé',{body:T.label||'Série suivante'}); }catch(e){} } }
  if(left<=-60){ stopTimer(); return; }
  T.raf=requestAnimationFrame(()=>setTimeout(tick,250));
}
$('#tStop').onclick=stopTimer; $('#tPlus').onclick=()=>{T.end+=30000;T.total+=30;}; $('#tMinus').onclick=()=>{T.end-=15000;};
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&$('#timer').classList.contains('on')) tick(); });

/* ---------- render: séance ---------- */
function render(){ if(!PROGRAM.sessions.length||!PROGRAM_LOADED||!$('#tab-seance')) return; renderSeance(); renderProgramme(); renderSuivi(); renderReglages(); renderCoach(); const w=WEEKS[curWeek()-1]; $('#weekChip').textContent=`S${w.n}`; }

function renderSeance(){
  if(!$('#tab-seance')||!PROGRAM.sessions.length) return;
  const wk=curWeek(), W=WEEKS[wk-1], date=todayISO(), ses=curSession(), log=getLog(date,ses.id);
  const el=$('#tab-seance'); let h='';
  h+=`<div class="days">`+PROGRAM.sessions.map(s=>{ const done=Object.values(S.logs).some(l=>l.session===s.id&&l.week===wk&&l.done); return `<button data-s="${s.id}" aria-pressed="${s.id===ses.id}" class="${done?'done':''}"><b>${esc(s.dayName.slice(0,3))}</b><span>${esc(s.name.split(' ')[0])}</span></button>`; }).join('')+`<button data-s="rest" aria-pressed="false"><b>Dim</b><span>Repos</span></button></div>`;
  h+=`<div class="sesshead"><h2>${esc(ses.name)}</h2><span class="meta">${esc(ses.sub)} · ${esc(ses.duration)}${ses.place?' · '+esc(ses.place):''} · ${fmtD(date)}${PROGRAM.cycleName?' · '+esc(PROGRAM.cycleName):''}</span><span class="meta" id="elapsed"></span></div>`;
  h+=`<div class="banner info"><b>${esc(W.label)}</b> · ${fmtD(W.from)}–${fmtD(W.to)} — ${esc(W.rirNote)}</div>`;
  if(ses.note) h+=`<div class="banner">${esc(ses.note)}</div>`;
  if(wk===4&&ses.id==='jambesA') h+=`<div class="banner ok">Test tractions à froid avant la séance : 2 × 8 espacées de 2 min, repos 5 min, une série max stricte filmée. Saisis le résultat dans Suivi.</div>`;
  if(cycleOver()) h+=`<div class="banner">Cycle terminé le ${fmtD(WEEKS[WEEKS.length-1].to)}. Les prescriptions affichées sont celles de la décharge en attendant le cycle suivant.</div>`;
  if(log.done) h+=`<div class="banner ok">Séance validée. Tu peux encore corriger les valeurs.</div>`;
  if(!ses.exercises.some(ex=>lastRef(ex.id,date))) h+=`<p class="hint">Première fois sur cette séance : note la charge de chaque série sérieuse, elle servira de référence la semaine prochaine.</p>`;
  const prevLog=Object.values(S.logs).filter(l=>l.session===ses.id&&l.date<date&&l.notes).sort((a,b)=>a.date<b.date?1:-1)[0];
  if(prevLog) h+=`<p class="small muted" style="margin:-4px 0 12px"><b>Notes du ${fmtD(prevLog.date)} :</b> ${esc(prevLog.notes)}</p>`;
  const wu=(PROGRAM.warmup||{})[ses.id.replace(/[AB]$/,'')]; if(wu) h+=`<details class="more wu"><summary>Échauffement · 8-10 min</summary><p class="small">${esc(PROGRAM.warmup.common)}</p><p class="small">${esc(wu)}</p><p class="small">${esc(PROGRAM.warmup.ramp)}</p></details>`;
  if(ses.gtg){ h+=`<div class="ex gtg"><div class="exh"><span class="n">GTG</span><span class="name">Tractions sous-maximales 3 × 15</span></div><p class="mach">Après l'échauffement, après l'exercice 3, avant la fin. Loin de l'échec, prise pronation.</p><div class="gtgrow">${[0,1,2].map(i=>`<label><input type="checkbox" data-gtg="${i}" ${log.gtg[i]?'checked':''}> Bloc ${i+1}</label>`).join('')}</div></div>`; }
  ses.exercises.forEach(ex=>{
    const p=rx(ex,wk); const done=(log.sets[ex.id]||[]).filter(s=>s&&s.done).length; const complete=done>=p.sets;
    const ref=lastRef(ex.id,date);
    const flags=(log.flags||{})[ex.id]||{};
    h+=`<div class="ex ${complete?'complete':''} ${flags.skip?'skipped':''}" data-ex="${ex.id}"><div class="exh"><span class="n">${ex.n}</span><span class="name">${esc(ex.name)}${ex.star?'<span class="star" title="+1 série en S2/S3">★</span>':''}</span>${flags.alt?'<span class="tag">alternative</span>':''}${flags.skip?'<span class="tag">sauté</span>':''}</div>`;
    h+=`<p class="mach">${esc(ex.machine)}${ex.alt?' <span class="muted">· alt. '+esc(ex.alt)+'</span>':''}${ex.url?` <a href="${esc(ex.url)}" target="_blank" rel="noopener">voir ↗</a>`:''}</p>`;
    h+=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}${ex.per?' '+esc(ex.per):''}</b>${p.rir!=null?`<b><i>RIR</i>${p.rir}</b>`:''}<b><i>tempo</i>${esc(ex.tempo)}</b><b><i>repos</i>${esc(p.restText)}</b>${ex.mode==='emom'?'<span>départ à départ</span>':''}</div>`;
    if(ex.chargeNote&&!/^RIR \d( → \d)*$/.test(ex.chargeNote)) h+=`<p class="small muted" style="margin:0 0 6px">${esc(ex.chargeNote)}</p>`;
    const ov=((S.overrides||{})[ses.id]||{}).adj; const o=ov&&ov[ex.id]; if(o) h+=`<p class="coachline"><b>Coach</b> ${esc(o.change)}${o.reason?' <span class="muted">— '+esc(o.reason)+'</span>':''}</p>`;
    if(ref){ const best=ref.sets.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0); const top=ref.sets.find(s=>s.w)||ref.sets[0]; let tgt=''; if(top&&top.w&&wk>1&&wk<4){ const hi=parseInt(String(p.reps).split('-').pop()); const allHi=ref.sets.every(s=>s.r>=hi); tgt=allHi?` → <span class="tgt">cible ${Math.round(top.w*1.025*2)/2} kg</span>`:` → <span class="tgt">même charge, +1 rep</span>`; } if(wk===4&&top&&top.w) tgt=` → <span class="tgt">décharge ≈ ${Math.round(top.w*0.9*2)/2} kg</span>`; h+=`<p class="ref">Dernier (${fmtD(ref.date)}, S${ref.week}) : <b>${esc(fmtSets(ref.sets))}</b>${tgt}</p>`; }
    else h+=`<p class="ref none"></p>`;
    // sets grid
    h+=`<div class="sets"><span class="hd"></span><span class="hd">${/lest/i.test(ex.name)?'lest kg':ex.mode==='emom'?'—':ex.mode==='max'?'assist kg':!ex.rir?'charge':'kg'}</span><span class="hd">reps</span><span class="hd">RIR</span><span class="hd"></span>`;
    const arr=log.sets[ex.id]||[]; const prev=ref?ref.sets:[];
    for(let i=0;i<p.sets;i++){
      const s=arr[i]||{}; const pf=prev[i]||prev[prev.length-1]||{};
      const nextIdx=arr.filter(x=>x&&x.done).length; const enabled=s.done||i<=nextIdx;
      h+=`<span class="i">${i+1}</span>`;
      h+=`<input type="number" inputmode="decimal" step="0.5" data-f="w" data-i="${i}" placeholder="${pf.w??''}" value="${s.w??''}" ${enabled?'':'disabled'}>`;
      h+=`<input type="number" inputmode="numeric" data-f="r" data-i="${i}" placeholder="${pf.r??String(p.reps).split('-')[0].replace(/\D.*/,'')}" value="${s.r??''}" ${enabled?'':'disabled'}>`;
      h+=`<input type="number" inputmode="numeric" data-f="rir" data-i="${i}" placeholder="${p.rir??''}" value="${s.rir??''}" ${enabled?'':'disabled'}>`;
      h+=`<button class="go ${s.done?'done':''}" data-i="${i}" ${enabled?'':'disabled'} aria-label="Valider la série ${i+1}">${s.done?'✓':'▶'}</button>`;
    }
    h+=`</div>`;
    if(ex.mode==='emom') h+=`<div class="row2"><button class="btn sm acc" data-emom="start">Top série</button><span class="small muted">Lance le chrono de 90 s à chaque départ. Valide la série avec ▶ quand elle est faite.</span></div>`;
    h+=`<div class="row2 flags"><button class="link" data-flag="alt">${flags.alt?'✓ alternative utilisée':'machine absente → alternative'}</button><button class="link" data-flag="skip">${flags.skip?'✓ sauté · annuler':'sauter'}</button></div>`;
    h+=`<div class="row2"><button class="btn sm" data-rest="${p.rest}">Repos ${esc(p.restText)}</button><button class="btn sm" data-rest="60">1:00</button><button class="btn sm" data-rest="120">2:00</button><button class="btn sm" data-rest="180">3:00</button></div>`;
    h+=`<details class="more"><summary>Pourquoi · exécution · ce qu'on cherche</summary><dl class="dl">`;
    if(ex.reco) h+=`<dt>Reconnaissance</dt><dd>${esc(ex.reco)}</dd>`;
    if(ex.why) h+=`<dt>Pourquoi</dt><dd>${esc(ex.why)}</dd>`;
    if(ex.target) h+=`<dt>Cible</dt><dd>${esc(ex.target)}</dd>`;
    if(ex.exec) h+=`<dt>Exécution</dt><dd>${esc(ex.exec)}</dd>`;
    if(ex.seek) h+=`<dt class="seek">Ce qu'on cherche</dt><dd>${esc(ex.seek)}</dd>`;
    h+=`</dl></details></div>`;
  });
  h+=`<div class="notes"><h3>Notes de séance</h3><textarea id="notes" placeholder="Douleur, RIR réel, machine absente, sommeil, garde…">${esc(log.notes)}</textarea></div>`;
  h+=`<div class="endrow"><button class="btn ${log.done?'':'fill'}" id="endBtn">${log.done?'Rouvrir la séance':'Séance terminée'}</button><span class="small muted">${Object.keys(log.sets).length?Object.values(log.sets).flat().filter(s=>s&&s.done).length+' séries validées':'Aucune série validée'}</span></div>`;
  el.innerHTML=h;

  // events
  el.querySelectorAll('.days button').forEach(b=>b.onclick=()=>{ const id=b.dataset.s; if(id==='rest'){ el.innerHTML=`<div class="days">${el.querySelector('.days').innerHTML}</div><h2>Dimanche — repos</h2><p>Marche 30 à 60 min, mobilité hanches et épaules 20 min. Pas de tractions. Pesée demain matin à jeun.</p>`; el.querySelectorAll('.days button').forEach(x=>x.onclick=()=>{S.session=x.dataset.s==='rest'?S.session:x.dataset.s;save();renderSeance();}); return; } S.session=id; save(); renderSeance(); });
  el.querySelectorAll('[data-gtg]').forEach(c=>c.onchange=()=>{ log.gtg[+c.dataset.gtg]=c.checked; touch(log); });
  el.querySelectorAll('.ex[data-ex]').forEach(card=>{
    const exId=card.dataset.ex; const ex=ses.exercises.find(e=>e.id===exId); const p=rx(ex,wk);
    const arr=()=>{ if(!log.sets[exId]) log.sets[exId]=[]; return log.sets[exId]; };
    card.querySelectorAll('input[data-f]').forEach(inp=>inp.onchange=()=>{ const a=arr(); const i=+inp.dataset.i; a[i]=a[i]||{}; a[i][inp.dataset.f]=inp.value===''?null:Number(inp.value); touch(log); });
    card.querySelectorAll('.go').forEach(b=>b.onclick=()=>{
      const i=+b.dataset.i; const a=arr(); a[i]=a[i]||{};
      const row=f=>card.querySelector(`input[data-f="${f}"][data-i="${i}"]`);
      ['w','r','rir'].forEach(f=>{ const inp=row(f); const v=inp.value!==''?Number(inp.value):(inp.placeholder!==''&&f!=='rir'?Number(inp.placeholder):null); a[i][f]=isNaN(v)?null:v; });
      if(a[i].done){ a[i].done=false; touch(log); renderSeance(); return; }
      a[i].done=true; a[i].t=Date.now(); touch(log);
      const last=i>=p.sets-1;
      if(!last) startTimer(p.rest,`Repos · ${ex.name}`,`Série ${i+2}/${p.sets} · ${p.reps}${p.rir!=null?' @RIR '+p.rir:''}`);
      else { const nx=ses.exercises[ex.n]; if(nx) startTimer(Math.min(p.rest,120),`Suivant · ${nx.name}`,`${rx(nx,wk).sets} × ${rx(nx,wk).reps} · ${nx.machine}`); }
      renderSeance(); card.scrollIntoView({block:'nearest'});
    });
    card.querySelectorAll('[data-rest]').forEach(b=>b.onclick=()=>startTimer(+b.dataset.rest,`Repos · ${ex.name}`,''));
    card.querySelectorAll('[data-flag]').forEach(b=>b.onclick=()=>{ log.flags=log.flags||{}; const f=log.flags[exId]||(log.flags[exId]={}); f[b.dataset.flag]=!f[b.dataset.flag]; touch(log); renderSeance(); });
    const em=card.querySelector('[data-emom]'); if(em) em.onclick=()=>startTimer(p.rest,`EMOM · série ${arr().filter(s=>s&&s.done).length+1}/${p.sets}`,`${p.reps} reps strictes, repart au top`);
  });
  $('#notes').onchange=e=>{ log.notes=e.target.value; touch(log); };
  updateElapsed(log);
  $('#endBtn').onclick=()=>{ log.done=!log.done; touch(log); stopTimer(); if(log.done){ releaseWake(); if(USER&&navigator.onLine){ analyseSession(logKey(log.date,log.session)); document.querySelector('.tabs button[data-tab="coach"]').click(); } } renderSeance(); if(log.done) window.scrollTo({top:0}); };
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

/* ---------- render: suivi ---------- */
let suiviEx=null;
function renderSuivi(){
  const el=$('#tab-suivi'); if(!el) return; const date=todayISO();
  const bws=Object.values(S.bw).sort((a,b)=>a.date<b.date?1:-1); const tests=Object.values(S.tests).sort((a,b)=>a.date<b.date?1:-1);
  const doneCount=Object.values(S.logs).filter(l=>l.done).length;
  const emom=Object.values(S.logs).filter(l=>l.session==='pullB'&&l.sets['pullB-1']).map(l=>({date:l.date,total:l.sets['pullB-1'].filter(s=>s&&s.done).reduce((a,s)=>a+(s.r||0),0)})).sort((a,b)=>a.date<b.date?1:-1);
  let h=`<h2>Suivi</h2><div class="kv">
    <div><div class="k">${bws[0]?bws[0].kg.toFixed(1)+' kg':'—'}</div><div class="l">poids${bws[0]?' · '+fmtD(bws[0].date):''} · cible ≤ 70</div></div>
    <div><div class="k">${tests[0]?tests[0].reps:'35'}</div><div class="l">tractions max${tests[0]?' · '+fmtD(tests[0].date):' · départ'} · cible 40-43</div></div>
    <div><div class="k">${emom[0]?emom[0].total:'—'}</div><div class="l">reps EMOM dernière Pull B</div></div>
    <div><div class="k">${doneCount}</div><div class="l">séances validées</div></div></div>`;
  h+=`<h3>Poids de corps</h3><p class="small muted">Lundi et jeudi, à jeun. La moyenne compte, pas la valeur isolée.</p><div class="inline"><input type="date" id="bwDate" value="${date}"><input type="number" step="0.1" inputmode="decimal" id="bwKg" placeholder="kg"><button class="btn sm acc" id="bwAdd">Enregistrer</button></div>`;
  if(bws.length){ const avg7=bws.filter(b=>b.date>=addDays(date,-7)); h+=`<p class="small">Moyenne 7 j : <b>${avg7.length?(avg7.reduce((a,b)=>a+b.kg,0)/avg7.length).toFixed(1):'—'} kg</b> · ${bws.slice(0,8).map(b=>fmtD(b.date)+' '+b.kg.toFixed(1)).join(' · ')}</p>`; }
  h+=`<h3>Test tractions</h3><div class="inline"><input type="date" id="tDate" value="${date}"><input type="number" inputmode="numeric" id="tReps" placeholder="reps"><button class="btn sm acc" id="tAdd">Enregistrer</button></div>`;
  if(tests.length) h+=`<p class="small">${tests.map(t=>fmtD(t.date)+' : '+t.reps).join(' · ')}</p>`;
  h+=`<h3>Progression par exercice</h3><div class="inline"><select id="exSel">`;
  PROGRAM.sessions.forEach(s=>{ h+=`<optgroup label="${esc(s.name)}">`; s.exercises.forEach(ex=>{ h+=`<option value="${ex.id}" ${suiviEx===ex.id?'selected':''}>${ex.n}. ${esc(ex.name)}</option>`; }); h+=`</optgroup>`; });
  h+=`</select></div><div id="exHist"></div>`;
  h+=`<h3>Journal</h3>`;
  const logs=Object.values(S.logs).filter(l=>Object.keys(l.sets).length||l.done||l.notes).sort((a,b)=>a.date<b.date?1:-1);
  if(!logs.length) h+=`<p class="muted small">Rien encore.</p>`;
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
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); ['seance','coach','programme','suivi','reglages'].forEach(t=>{ const s=$('#tab-'+t); if(s) s.hidden=t!==b.dataset.tab; }); window.scrollTo({top:0}); });
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
  showGate(); initFirebase();
  if('serviceWorker' in navigator){
    // Mise à jour automatique : quand un nouveau service worker prend la main, on recharge (sauf chrono en cours, on attend la fin de la séance).
    let refreshing=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(refreshing) return; refreshing=true; if($('#timer')&&$('#timer').classList.contains('on')){ setSync('pend','mise à jour prête'); return; } location.reload(); });
    navigator.serviceWorker.register('sw.js').then(r=>{ r.update().catch(()=>{}); setInterval(()=>r.update().catch(()=>{}),60*60*1000); r.addEventListener('updatefound',()=>{ const w=r.installing; w&&w.addEventListener('statechange',()=>{ if(w.state==='installed'&&navigator.serviceWorker.controller) setSync('pend','mise à jour…'); }); }); }).catch(()=>{});
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) navigator.serviceWorker.getRegistration().then(r=>r&&r.update().catch(()=>{})); });
  }
}
boot();
