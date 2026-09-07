
const APP_VERSION='1.2.0';
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
let S = {logs:{}, bw:{}, tests:{}, weekOverride:null, session:null, gh:null, dirty:false, lastSync:0, wake:true};
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
function touch(log){ log.updatedAt=Date.now(); save(); markDirty(); requestWake(); }


// history of an exercise: [{date,week,sets:[{w,r,rir}]}] newest first
function history(exId){
  return Object.values(S.logs).filter(l=>l.sets[exId]&&l.sets[exId].some(s=>s&&s.done)).map(l=>({date:l.date,week:l.week,sets:l.sets[exId].filter(s=>s&&s.done)})).sort((a,b)=>a.date<b.date?1:-1);
}
function lastRef(exId, date){ return history(exId).find(h=>h.date<date)||null; }
function e1rm(w,r){ if(!w||!r) return 0; return r===1?w:w*(1+r/30); }
function fmtSets(sets){ return sets.map(s=>(s.w?s.w+'×':'')+(s.r??'?')+(s.rir!=null?'@'+s.rir:'')).join(' · '); }

/* ---------- synchro GitHub ----------
   Les données vivent d'abord sur l'appareil (localStorage). Quand il y a du réseau,
   elles sont fusionnées avec data/journal.json d'un dépôt GitHub via l'API Contents,
   avec un token à droits limités (Contents read/write sur ce seul dépôt).
   Fusion document par document sur updatedAt : le plus récent gagne. */
const GH = {
  cfg(){ return S.gh || {owner:'', repo:'', branch:'main', path:'data/journal.json', token:''}; },
  ready(){ const c=this.cfg(); return !!(c.owner&&c.repo&&c.token); },
  url(){ const c=this.cfg(); return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path}`; },
  headers(){ return {'Authorization':'Bearer '+this.cfg().token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}; },
  async pull(){
    const r=await fetch(this.url()+'?ref='+encodeURIComponent(this.cfg().branch),{headers:this.headers(),cache:'no-store'});
    if(r.status===404) return {sha:null,data:null};
    if(!r.ok) throw new Error('GitHub '+r.status);
    const j=await r.json();
    const txt=decodeURIComponent(escape(atob(j.content.replace(/\n/g,''))));
    return {sha:j.sha,data:JSON.parse(txt)};
  },
  async push(data,sha){
    const c=this.cfg();
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(data,null,1))));
    const body={message:'journal '+new Date().toISOString().slice(0,16).replace('T',' '),content,branch:c.branch};
    if(sha) body.sha=sha;
    const r=await fetch(this.url(),{method:'PUT',headers:{...this.headers(),'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===409||r.status===422) throw Object.assign(new Error('conflict'),{conflict:true});
    if(!r.ok) throw new Error('GitHub '+r.status);
    return (await r.json()).content.sha;
  }
};

function mergeInto(local, remote){ // returns true if local changed
  let changed=false;
  for(const col of ['logs','bw','tests']){
    const L=local[col]||(local[col]={}), R=(remote&&remote[col])||{};
    for(const k in R){ if(!L[k]||(R[k].updatedAt||0)>(L[k].updatedAt||0)){ L[k]=R[k]; changed=true; } }
  }
  return changed;
}
function snapshot(){ return {version:1, exportedAt:new Date().toISOString(), logs:S.logs, bw:S.bw, tests:S.tests}; }
function sameData(a,b){ return JSON.stringify({l:a.logs,b:a.bw,t:a.tests})===JSON.stringify({l:b.logs,b:b.bw,t:b.tests}); }

function setSync(cls,txt){ const c=$('#syncChip'); c.className='chip sync '+cls; c.textContent=txt; }
function syncStatusIdle(){
  if(!GH.ready()) return setSync('off','local');
  if(!navigator.onLine) return setSync('pend','hors ligne');
  setSync(S.dirty?'pend':'on', S.dirty?'à sync':'sync ok');
}
let syncing=false, syncTimer=0;
function markDirty(){ S.dirty=true; save(); syncStatusIdle(); clearTimeout(syncTimer); syncTimer=setTimeout(()=>sync(),20000); }
async function sync(manual){
  if(!GH.ready()){ syncStatusIdle(); return; }
  if(!navigator.onLine||syncing){ syncStatusIdle(); return; }
  syncing=true; setSync('pend','synchro…');
  try{
    for(let attempt=0;attempt<2;attempt++){
      const {sha,data}=await GH.pull();
      const changedLocal=mergeInto(S,data);
      if(changedLocal){ save(); render(); }
      if(!data||!sameData(snapshot(),data)){
        try{ await GH.push(snapshot(),sha); }
        catch(e){ if(e.conflict&&attempt===0) continue; throw e; }
      }
      break;
    }
    S.dirty=false; S.lastSync=Date.now(); save(); syncStatusIdle();
  }catch(e){
    console.warn('sync',e);
    setSync('pend', /401|403/.test(e.message)?'token refusé':'sync échouée');
    if(manual) alert('Synchronisation impossible : '+e.message);
  }
  syncing=false;
}
window.addEventListener('online',()=>sync());
window.addEventListener('offline',syncStatusIdle);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) sync(); });
$('#syncChip').onclick=()=>sync(true);

/* ---------- réglages ---------- */
function renderReglages(){
  const c=GH.cfg(); const el=$('#tab-reglages');
  const guess=(()=>{ const m=location.hostname.match(/^([^.]+)\.github\.io$/); return m?m[1]:''; })();
  el.innerHTML=`<h2>Réglages</h2>
  <h3>Synchronisation GitHub</h3>
  <p class="small muted">Un dépôt <b>privé</b> séparé de l'application, dans lequel le fichier <span class="mono">data/journal.json</span> est écrit. Le token doit être un « fine-grained personal access token » limité à ce dépôt avec la permission Contents : Read and write.</p>
  <div class="form">
    <label>Propriétaire (compte GitHub)<input id="ghOwner" value="${esc(c.owner||guess)}" autocapitalize="off" autocomplete="off"></label>
    <label>Dépôt de données<input id="ghRepo" value="${esc(c.repo||'rituel-data')}" autocapitalize="off" autocomplete="off"></label>
    <label>Branche<input id="ghBranch" value="${esc(c.branch||'main')}" autocapitalize="off"></label>
    <label>Token<input id="ghToken" type="password" value="${esc(c.token||'')}" autocomplete="off" placeholder="github_pat_…"></label>
    <div class="row2"><button class="btn acc" id="ghSave">Enregistrer</button><button class="btn" id="ghTest">Tester</button><span class="small muted" id="ghMsg"></span></div>
  </div>
  <h3>Sauvegarde</h3>
  <div class="row2"><button class="btn" id="expBtn">Exporter le journal (JSON)</button><label class="btn" for="impFile">Importer</label><input id="impFile" type="file" accept="application/json" hidden></div>
  <p class="small muted">L'export est le fichier à m'envoyer si la synchro n'est pas configurée. L'import fusionne sans écraser ce qui est plus récent.</p>
  <h3>Appareil</h3>
  <div class="row2"><label class="gtgrow"><input type="checkbox" id="wakeOpt" ${S.wake!==false?'checked':''}> Garder l'écran allumé pendant une séance</label></div>
  <div class="row2"><button class="btn" id="notifBtn">Autoriser les notifications</button><span class="small muted" id="notifMsg">${window.Notification?('état : '+Notification.permission):'non supporté'}</span></div>
  <p class="small muted">Version ${APP_VERSION}. <button class="link" id="reloadBtn">Recharger l'application</button></p>`;
  const msg=$('#ghMsg');
  $('#ghSave').onclick=()=>{ S.gh={owner:$('#ghOwner').value.trim(),repo:$('#ghRepo').value.trim(),branch:$('#ghBranch').value.trim()||'main',path:'data/journal.json',token:$('#ghToken').value.trim()}; save(); msg.textContent='enregistré'; syncStatusIdle(); sync(true); };
  $('#ghTest').onclick=async()=>{ $('#ghSave').click(); msg.textContent='test…'; try{ const r=await GH.pull(); msg.textContent=r.data?`OK · ${Object.keys(r.data.logs||{}).length} séances sur GitHub`:'OK · dépôt vide, premier envoi au prochain sync'; }catch(e){ msg.textContent='échec : '+e.message; } };
  $('#expBtn').onclick=()=>{ const blob=new Blob([JSON.stringify(snapshot(),null,1)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rituel-journal-'+todayISO()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); };
  $('#impFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); mergeInto(S,d); markDirty(); render(); alert('Import fusionné.'); }catch(err){ alert('Fichier invalide.'); } }; rd.readAsText(f); };
  $('#wakeOpt').onchange=e=>{ S.wake=e.target.checked; save(); if(!S.wake) releaseWake(); };
  $('#notifBtn').onclick=async()=>{ if(!window.Notification) return; const p=await Notification.requestPermission(); $('#notifMsg').textContent='état : '+p; };
  $('#reloadBtn').onclick=async()=>{ if(navigator.serviceWorker){ const r=await navigator.serviceWorker.getRegistration(); if(r){ await r.update(); } } location.reload(); };
}

/* ---------- wake lock ---------- */
let wakeLock=null;
async function requestWake(){ if(S.wake===false) return; try{ if('wakeLock' in navigator && !wakeLock){ wakeLock=await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release',()=>{wakeLock=null;}); } }catch(e){} }
function releaseWake(){ try{ wakeLock&&wakeLock.release(); }catch(e){} wakeLock=null; }
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&sessionActive()) requestWake(); });
function sessionActive(){ const l=S.logs[logKey(todayISO(),curSession().id)]; return !!(l&&!l.done&&Object.keys(l.sets).length); }

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
function render(){ if(!PROGRAM.sessions.length) return; renderSeance(); renderProgramme(); renderSuivi(); renderReglages(); const w=WEEKS[curWeek()-1]; $('#weekChip').textContent=`S${w.n}`; }

function renderSeance(){
  const wk=curWeek(), W=WEEKS[wk-1], date=todayISO(), ses=curSession(), log=getLog(date,ses.id);
  const el=$('#tab-seance'); let h='';
  h+=`<div class="days">`+PROGRAM.sessions.map(s=>{ const done=Object.values(S.logs).some(l=>l.session===s.id&&l.week===wk&&l.done); return `<button data-s="${s.id}" aria-pressed="${s.id===ses.id}" class="${done?'done':''}"><b>${esc(s.dayName.slice(0,3))}</b><span>${esc(s.name.split(' ')[0])}</span></button>`; }).join('')+`<button data-s="rest" aria-pressed="false"><b>Dim</b><span>Repos</span></button></div>`;
  h+=`<div class="sesshead"><h2>${esc(ses.name)}</h2><span class="meta">${esc(ses.sub)} · ${esc(ses.duration)}${ses.place?' · '+esc(ses.place):''} · ${fmtD(date)}</span><span class="meta" id="elapsed"></span></div>`;
  h+=`<div class="banner info"><b>${esc(W.label)}</b> · ${fmtD(W.from)}–${fmtD(W.to)} — ${esc(W.rirNote)}</div>`;
  if(ses.note) h+=`<div class="banner">${esc(ses.note)}</div>`;
  if(wk===4&&ses.id==='jambesA') h+=`<div class="banner ok">Test tractions à froid avant la séance : 2 × 8 espacées de 2 min, repos 5 min, une série max stricte filmée. Saisis le résultat dans Suivi.</div>`;
  if(cycleOver()) h+=`<div class="banner">Cycle terminé le ${fmtD(WEEKS[WEEKS.length-1].to)}. Les prescriptions affichées sont celles de la décharge en attendant le cycle suivant.</div>`;
  if(log.done) h+=`<div class="banner ok">Séance validée. Tu peux encore corriger les valeurs.</div>`;
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
    h+=`<div class="rx"><b>${p.sets} × ${esc(p.reps)}${ex.per?' '+esc(ex.per):''}</b>${p.rir!=null?`<span>RIR</span><b>${p.rir}</b>`:''}<span>tempo</span><b>${esc(ex.tempo)}</b><span>repos</span><b>${esc(p.restText)}</b>${ex.mode==='emom'?'<span>départ à départ</span>':''}</div>`;
    if(ex.chargeNote&&!/^RIR \d( → \d)*$/.test(ex.chargeNote)) h+=`<p class="small muted" style="margin:0 0 6px">${esc(ex.chargeNote)}</p>`;
    if(ref){ const best=ref.sets.reduce((m,s)=>Math.max(m,e1rm(s.w,s.r)),0); const top=ref.sets.find(s=>s.w)||ref.sets[0]; let tgt=''; if(top&&top.w&&wk>1&&wk<4){ const hi=parseInt(String(p.reps).split('-').pop()); const allHi=ref.sets.every(s=>s.r>=hi); tgt=allHi?` → <span class="tgt">cible ${Math.round(top.w*1.025*2)/2} kg</span>`:` → <span class="tgt">même charge, +1 rep</span>`; } if(wk===4&&top&&top.w) tgt=` → <span class="tgt">décharge ≈ ${Math.round(top.w*0.9*2)/2} kg</span>`; h+=`<p class="ref">Dernier (${fmtD(ref.date)}, S${ref.week}) : <b>${esc(fmtSets(ref.sets))}</b>${tgt}</p>`; }
    else h+=`<p class="ref">Aucune référence. Note la charge de la première série sérieuse.</p>`;
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
  if(!GH.ready()&&Object.keys(log.sets).length) el.insertAdjacentHTML('afterbegin','<div class="banner">Synchro non configurée : tes séries ne sont que sur ce téléphone. Onglet ⚙ pour brancher le dépôt.</div>');
  $('#endBtn').onclick=()=>{ log.done=!log.done; touch(log); stopTimer(); if(log.done){ releaseWake(); sync(); } renderSeance(); if(log.done) window.scrollTo({top:0}); };
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
  const wk=curWeek(); let h=`<h2>Programme · S${wk}</h2><p class="small muted">Prescriptions de la semaine affichée. Change de semaine avec la puce en haut.</p>`;
  PROGRAM.sessions.forEach(s=>{
    h+=`<h3>${esc(s.dayName)} — ${esc(s.name)} <span class="muted small">(${esc(s.sub)})</span></h3><div class="pcard">`;
    s.exercises.forEach(ex=>{ const p=rx(ex,wk); h+=`<div class="prow"><span class="n">${ex.n}</span><span class="nm">${esc(ex.name)}${ex.star?' <span style="color:var(--accent)">★</span>':''}</span><span class="rx2">${p.sets}×${esc(p.reps)}${p.rir!=null?' · RIR '+p.rir:''}</span><span class="mc">${esc(ex.machine)} · ${esc(ex.tempo)} · repos ${esc(p.restText)}</span></div>`; });
    h+=`</div>`;
  });
  $('#tab-programme').innerHTML=h;
}

/* ---------- render: suivi ---------- */
let suiviEx=null;
function renderSuivi(){
  const el=$('#tab-suivi'); const date=todayISO();
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
  $('#bwAdd').onclick=()=>{ const d=$('#bwDate').value, kg=parseFloat($('#bwKg').value); if(!d||isNaN(kg)) return; S.bw[d]={date:d,kg,updatedAt:Date.now()}; markDirty(); renderSuivi(); };
  $('#tAdd').onclick=()=>{ const d=$('#tDate').value, r=parseInt($('#tReps').value); if(!d||isNaN(r)) return; S.tests[d]={date:d,reps:r,updatedAt:Date.now()}; markDirty(); renderSuivi(); };
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
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); ['seance','programme','suivi','cycle','reglages'].forEach(t=>$('#tab-'+t).hidden=t!==b.dataset.tab); window.scrollTo({top:0}); });
$('#weekChip').onclick=()=>{ const auto=weekFor(todayISO()); const cur=curWeek(); const nx=cur%WEEKS.length+1; S.weekOverride=nx===auto?null:nx; save(); render(); };
document.addEventListener('pointerdown',unlockAudio,{once:true});
document.addEventListener('pointerdown',()=>{ if(window.Notification&&Notification.permission==='default'){ try{Notification.requestPermission();}catch(e){} } },{once:true});

/* ---------- démarrage ---------- */
async function boot(){
  if(!Object.keys(S.logs).length){ const j=await idbGet(); if(j){ try{ const d=JSON.parse(j); if(Object.keys(d.logs||{}).length) S=Object.assign(S,d); }catch(e){} } }
  try{
    const [p,c]=await Promise.all([fetch('program.json').then(r=>r.json()), fetch('cycle.html').then(r=>r.text())]);
    PROGRAM=p; if(p.weeks&&p.weeks.length) WEEKS=p.weeks; $('#tab-cycle').innerHTML=c; document.querySelector('.brand small').textContent=p.cycleName||'';
  }catch(e){ $('#tab-seance').innerHTML='<p>Impossible de charger le programme. Recharge la page avec du réseau une première fois.</p>'; return; }
  render(); syncStatusIdle(); sync();
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').then(r=>{ r.addEventListener('updatefound',()=>{ const w=r.installing; w&&w.addEventListener('statechange',()=>{ if(w.state==='installed'&&navigator.serviceWorker.controller) setSync('pend','mise à jour dispo · recharge'); }); }); }).catch(()=>{}); }
}
boot();
