/* Test des fonctions Coach sans émulateur : Firestore en mémoire, paramètres/secrets simulés, modèle simulé (tests/mock-model.js).
   Enchaîne le parcours d'un nouvel utilisateur côté serveur : programme → analyse → chat → séance sans salle → fiches photos,
   puis le bilan hebdomadaire. Usage : node tests/functions-run.js  (lance lui-même le modèle simulé sur le port 4011). */
const path = require('path'); const Module = require('module');
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:4011';

// ---- Firestore en mémoire : juste la surface utilisée par functions/index.js ----
const store = {}; // chemin complet -> données
const INC = Symbol('inc'), ARR_RM = Symbol('arrRemove'), DEL = Symbol('delete');
function applyMerge(target, src) { for (const [k, v] of Object.entries(src || {})) { if (v && v[INC] !== undefined) target[k] = (target[k] || 0) + v[INC]; else if (v && v[ARR_RM]) target[k] = (target[k] || []).filter(x => !v[ARR_RM].includes(x)); else if (v && v[DEL]) delete target[k]; else target[k] = v; } return target; }
function docRef(p) {
  return {
    path: p, id: p.split('/').pop(),
    collection: n => colRef(p + '/' + n),
    async get() { const d = store[p]; return { exists: !!d, id: p.split('/').pop(), data: () => d ? JSON.parse(JSON.stringify(d)) : undefined, ref: docRef(p) }; },
    async set(data, opts) { const clean = JSON.parse(JSON.stringify(data, (k, v) => (v && (v[INC] !== undefined || v[ARR_RM] || v[DEL])) ? '__SENTINEL__' : v)); if (opts && opts.merge) store[p] = applyMerge(store[p] || {}, data); else { store[p] = applyMerge({}, data); } return; },
    async delete() { delete store[p]; }
  };
}
function colRef(p, filters = [], order = null, lim = null) {
  return {
    path: p, doc: id => docRef(p + '/' + (id || 'auto' + Math.random().toString(36).slice(2))),
    async listDocuments() { const ids = new Set(Object.keys(store).filter(k => k.startsWith(p + '/')).map(k => k.slice(p.length + 1).split('/')[0])); return [...ids].map(id => docRef(p + '/' + id)); },
    where: (f, op, v) => colRef(p, filters.concat([[f, op, v]]), order, lim), orderBy: (f, dir) => colRef(p, filters, [f, dir || 'asc'], lim), limit: n => colRef(p, filters, order, n),
    async get() { let docs = Object.entries(store).filter(([k]) => k.startsWith(p + '/') && k.slice(p.length + 1).indexOf('/') < 0).map(([k, d]) => ({ id: k.split('/').pop(), data: () => JSON.parse(JSON.stringify(d)), ref: docRef(k) }));
      filters.forEach(([f, op, v]) => { docs = docs.filter(x => { const a = x.data()[f]; return op === '>=' ? a >= v : op === '<=' ? a <= v : op === '==' ? a === v : op === '>' ? a > v : a < v; }); });
      if (order) docs.sort((a, b) => { const x = a.data()[order[0]], y = b.data()[order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
      if (lim) docs = docs.slice(0, lim); return { docs, empty: !docs.length, size: docs.length }; }
  };
}
const fakeDb = { collection: n => colRef(n), async runTransaction(fn) { const tx = { get: ref => ref.get(), set: (ref, d) => { store[ref.path] = JSON.parse(JSON.stringify(d)); } }; return fn(tx); }, async recursiveDelete(ref) { Object.keys(store).filter(k => k.startsWith(ref.path)).forEach(k => delete store[k]); } };
const fakeAdmin = { initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue: { increment: n => ({ [INC]: n }), arrayRemove: (...a) => ({ [ARR_RM]: a }), delete: () => ({ [DEL]: true }) } }), auth: () => ({ deleteUser: async () => {} }) };
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const handlers = {};
const fakeHttps = { HttpsError, onCall: (opts, fn) => { const h = typeof opts === 'function' ? opts : fn; return h; }, onRequest: (opts, fn) => fn };
const fakeSched = { onSchedule: (opts, fn) => fn };
const fakeParams = { defineSecret: () => ({ value: () => 'sk-ant-test-local-000000000000000000000000' }), defineString: (n, o) => ({ value: () => (o && o.default) || 'auto' }) };
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'firebase-functions/v2/https') return fakeHttps;
  if (req === 'firebase-functions/v2/scheduler') return fakeSched;
  if (req === 'firebase-functions/params') return fakeParams;
  return origLoad.apply(this, arguments);
};

// ---- modèle simulé ----
process.env.PORT = '4011';
require('./mock-model.js');

const fns = require(path.join(__dirname, '..', 'functions', 'index.js'));
let failures = 0; const assert = (c, m) => { if (!c) { failures++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = (uid, data) => fns.coach({ auth: { uid }, data });

(async () => {
  await sleep(300);
  const uid = 'user_test_1';
  console.log('Nouvel utilisateur');
  let err = null; try { await call(uid, { mode: 'chat', messages: [{ role: 'user', content: 'Bonjour' }] }); } catch (e) { err = e; }
  assert(err && err.code === 'failed-precondition', 'sans profil : refus propre (' + (err && err.message) + ')');
  store[`users/${uid}/meta/profile`] = { name: 'Testeur', age: 34, height: 176, weight: 74, level: 'intermediaire', goals: ['masse'], days: 3, minutes: 60, gear: ['salle'], equipment: 'Salle complète' };

  console.log('Programme');
  const r1 = await call(uid, { mode: 'program' });
  assert(r1 && r1.ok && r1.sessions === 3, 'programme généré (3 séances)');
  const prog = store[`users/${uid}/meta/program`];
  assert(prog && prog.sessions[0].exercises[0].id === 's1-1' && prog.weeks.length === 4, 'programme normalisé et enregistré (ids, 4 semaines)');
  assert(prog.demos && Object.keys(prog.demos).length >= 1, 'fiches photos associées à la génération');
  const usage = store[`users/${uid}/meta/usage`];
  assert(usage && usage.program === 1 && usage.costUsd > 0, 'quota et coût enregistrés');

  console.log('Analyse');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const logKey = `${today}_s1`;
  store[`users/${uid}/logs/${logKey}`] = { date: today, session: 's1', week: 1, done: true, sets: { 's1-1': [{ w: 60, r: 8, rir: 2, done: true }, { w: 60, r: 8, rir: 1, done: true }], 's1-2': [{ w: 120, r: 10, rir: 2, done: true }] }, flags: { 's1-3': { skip: true } }, notes: 'Facile', updatedAt: Date.now() };
  const a = await call(uid, { mode: 'analyse', logKey, week: 1 });
  assert(a && a.analysis && a.exercises.length >= 1 && a.exercises.every(e => /^s1-\d$/.test(e.exId)), 'analyse enregistrée avec des exercices connus');
  assert(typeof a.cue === 'string' && Array.isArray(a.questions), 'point technique et questions présents');
  assert(store[`users/${uid}/coach/${logKey}`], 'analyse écrite dans coach/');
  let e2 = null; store[`users/${uid}/logs/vide_s1`] = { date: today, session: 's1', week: 1, done: true, sets: {}, updatedAt: 1 };
  try { await call(uid, { mode: 'analyse', logKey: 'vide_s1' }); } catch (e) { e2 = e; }
  assert(e2 && e2.code === 'failed-precondition', 'séance sans série refusée sans analyse');

  console.log('Chat');
  const c = await call(uid, { mode: 'chat', messages: [{ role: 'user', content: 'Je fais quoi ce soir ?' }], week: 1, session: 's1' });
  assert(c && typeof c.text === 'string' && c.text.length > 10, 'réponse du chat (' + c.text.slice(0, 40) + '…)');

  console.log('Sans salle');
  const s = await call(uid, { mode: 'substitute', sessionId: 's1', gear: ['halteres', 'elastiques'], note: 'hôtel', week: 1 });
  assert(s && s.exercises && s.exercises.length >= 3 && s.exercises[0].id === 's1-sub1', 'séance de remplacement construite');
  assert(store[`users/${uid}/overrides/s1`] && store[`users/${uid}/overrides/s1`].substitute, 'remplacement enregistré dans overrides/');

  console.log('Fiches photos');
  delete prog.demos; const d = await call(uid, { mode: 'demo' });
  assert(d && d.ok && store[`users/${uid}/meta/program`].demos, 'association des fiches à la demande');

  console.log('Quota');
  store[`users/${uid}/meta/usage`].chat = 300; let e3 = null;
  try { await call(uid, { mode: 'chat', messages: [{ role: 'user', content: 'x' }] }); } catch (e) { e3 = e; }
  assert(e3 && e3.code === 'resource-exhausted', 'quota atteint : refus explicite');

  console.log('Bilan hebdomadaire');
  store[`users/${uid}/meta/push`] = { expo: [] };
  await fns.weeklyReview();
  const bilan = Object.entries(store).find(([k, v]) => k.startsWith(`users/${uid}/coach/week-`));
  assert(bilan && (bilan[1].type === 'bilan' || bilan[1].type === 'cycleEnd'), 'bilan généré pour la semaine');

  console.log('Deuxième utilisateur isolé');
  const uid2 = 'user_test_2';
  store[`users/${uid2}/meta/profile`] = { name: 'Deux', age: 50, height: 170, weight: 80, level: 'debutant', goals: ['sante'], days: 2, minutes: 45, gear: ['halteres'] };
  const r2 = await call(uid2, { mode: 'program' });
  assert(r2 && r2.ok, 'programme généré pour le second utilisateur');
  const p2 = store[`users/${uid2}/meta/program`];
  assert(p2.sessions.every(se => se.exercises.length <= 6 && se.exercises.every(e => e.rir.every(r => r >= 2))), 'garde-fous débutant appliqués (≤ 6 exercices, RIR ≥ 2)');
  assert(p2.sessions.length === 2, 'conformité : exactement les 2 séances demandées (programme générique refusé puis corrigé)');
  assert(p2.sessions.every(se => se.exercises.every(e => !/machine|poulie|presse|tirage/i.test(e.name + ' ' + e.machine))), 'conformité : aucune machine sans salle');
  assert(p2.checks && p2.checks.attempts >= 1 && p2.checks.errors.length === 0 && !p2.degraded, 'contrôle de conformité : zéro erreur, textes du coach présents');
  assert(!Object.keys(store).some(k => k.startsWith(`users/${uid2}/logs/`)), 'aucune donnée de l\'utilisateur 1 chez l\'utilisateur 2');

  console.log('Jamais sans programme');
  const uidP = 'user_test_panne';
  store[`users/${uidP}/meta/profile`] = { name: 'Panne', age: 30, height: 175, weight: 70, level: 'intermediaire', goals: ['masse'], days: 3, minutes: 60, gear: ['halteres'] };
  const rr3 = await call(uidP, { mode: 'program' });
  const pp3 = store[`users/${uidP}/meta/program`];
  assert(rr3 && rr3.ok && pp3 && pp3.sessions.length === 3 && pp3.degraded === 'coach' && pp3.generatedAt, 'coach en panne : programme « moteur seul » livré quand même (3 séances, marqué dégradé)');
  assert(pp3.sessions.every(se => se.exercises.length >= 4 && se.exercises.every(e => e.name && e.sets && e.reps)), 'moteur seul : chaque séance complète (nom, séries, répétitions)');
  assert((store[`users/${uidP}/meta/genstate`] || {}).status === 'done', 'moteur seul : état de génération terminé, pas d\'erreur affichée');
  const uidT = 'user_test_tetu';
  store[`users/${uidT}/meta/profile`] = { name: 'Têtu', age: 30, height: 175, weight: 70, level: 'intermediaire', goals: ['masse'], days: 3, minutes: 60, gear: ['halteres'], spec: { daysList: [0, 2, 4], zones: [{ zone: 'epaule', sev: 'douleur' }], refuse: [] } };
  const rr4 = await call(uidT, { mode: 'program' });
  const pp4 = store[`users/${uidT}/meta/program`];
  assert(rr4 && rr4.ok && pp4 && pp4.checks && pp4.checks.errors.length === 0, 'coach hors sujet : le programme vient du moteur, zéro erreur');
  assert(pp4.sessions.every(se => se.exercises.every(e => !/machine|poulie|presse|hack|leg extension|tirage vertical/i.test(e.name + ' ' + e.machine))), 'réparation : plus aucune machine sans salle');
  assert(pp4.sessions.every(se => se.exercises.every(e => e.exId && e.exec && e.why)), 'bibliothèque : chaque exercice a un identifiant et ses textes de fiche');
  store[`users/${uidT}/meta/usage`] = { month: new Date().toISOString().slice(0, 7), program: 2, analyse: 0, chat: 0, substitute: 0, demo: 0 };
  store[`users/${uidT}/meta/program`] = null; delete store[`users/${uidT}/meta/program`];
  const rr5 = await call(uidT, { mode: 'program' });
  assert(rr5 && rr5.ok, 'quota gratuit atteint mais aucun programme : la génération passe quand même');

  console.log('Forfaits et administration');
  store[`users/${uid2}/meta/usage`].analyse = 8; let e4 = null;
  store[`users/${uid2}/logs/${today}_s1`] = { date: today, session: 's1', week: 1, done: true, sets: { 's1-1': [{ w: 20, r: 10, rir: 2, done: true }] }, updatedAt: 1 };
  try { await call(uid2, { mode: 'analyse', logKey: `${today}_s1` }); } catch (e) { e4 = e; }
  assert(e4 && /QUOTA_FREE:analyses:8/.test(e4.message), 'forfait gratuit : 8 analyses puis message de limite (' + (e4 && e4.message) + ')');
  store[`users/${uid2}/meta/billing`] = { plan: 'premium', expiresAt: Date.now() + 86400000 };
  const a2 = await call(uid2, { mode: 'analyse', logKey: `${today}_s1` });
  assert(a2 && a2.analysis, 'forfait premium : l\'analyse passe au-delà de la limite gratuite');
  let e5 = null; try { await fns.adminStats({ auth: { uid: uid2, token: { email: 'x@y.z' } }, data: {} }); } catch (e) { e5 = e; }
  assert(e5 && e5.code === 'permission-denied', 'administration refusée à un utilisateur ordinaire');
  store['errors/e1'] = { uid, t: Date.now(), src: 'analyse', msg: 'Test erreur', ver: '3.15.0' };
  const st = await fns.adminStats({ auth: { uid: 'admin', token: { email: 'ganeme.asloune@nexisafe.com' } }, data: {} });
  assert(st.users === 4 && st.withProgram === 4 && st.premium === 1 && st.errors.length === 1 && st.costMonth > 0, 'tableau de bord : comptes, programmes, premium, erreurs, coût');
  console.log('Abonnement (webhook)');
  console.log('Fiche structurée (entretien guidé)');
  const uid4 = 'user_test_4'; store[`users/${uid4}/meta/profile`] = { name: 'Nadia', level: 'confirme', goals: ['force', 'jambes'], gear: ['salle'], days: 3, minutes: 60, constraints: 'cheville (douleur)', spec: { goalMain: 'force', daysList: [1, 3, 5], minutes: 60, zones: [{ zone: 'cheville', sev: 'douleur', note: '' }], refuse: ['1h'], likes: ['lourd'] } };
  const r4 = await call(uid4, { mode: 'program' }); const p4 = store[`users/${uid4}/meta/program`];
  assert(r4 && r4.ok && p4.sessions.length === 3, 'fiche : 3 séances sur les 3 jours fixés');
  assert(p4.sessions.map(s => s.day).sort().join(',') === '2,4,6', 'fiche : jours replacés sur mardi, jeudi, samedi');
  assert(p4.sessions.every(s => s.exercises.every(e => !/mollet/i.test(e.name))), 'fiche : cheville douloureuse → exercices de mollets retirés après reprise');
  assert(p4.checks.attempts >= 1 && !p4.checks.errors.length, 'fiche : conforme sans reprise');
  console.log('Moteur de structure');
  const uid5 = 'user_test_5'; store[`users/${uid5}/meta/profile`] = { name: 'Claire', level: 'debutant', goals: ['perte'], gear: ['halteres', 'elastiques'], days: 3, minutes: 45, constraints: 'genou (opéré)', spec: { goalMain: 'perte', daysList: [0, 2, 4], minutes: 45, zones: [{ zone: 'genou', sev: 'opere', note: '' }], refuse: [], likes: [] } };
  const r5 = await call(uid5, { mode: 'program' }); const p5 = store[`users/${uid5}/meta/program`];
  assert(r5 && r5.ok && p5.sessions.length === 3 && p5.engine && p5.engine.v === 2, 'moteur : 3 séances, structure issue des règles');
  assert(p5.sessions.every(se => se.exercises.every(e => !['squat', 'lunge', 'kneeext'].includes(e.pattern))), 'moteur : genou opéré → aucun schéma squat / fente / leg extension');
  assert(p5.sessions.every(se => se.exercises.some(e => e.pattern === 'cond')), 'moteur : objectif perte → finisher court chaque séance');
  assert(p5.sessions.every(se => se.exercises.reduce((a, e) => a + e.sets, 0) <= 16 && se.exercises.every(e => e.rir[0] >= 3)), 'moteur : bornes débutant (≤ 16 séries, RIR ≥ 3 en S1)');
  assert(p5.sessions.every(se => se.exercises.every(e => e.rule && e.sets && e.reps)), 'moteur : règle de progression portée par chaque exercice');
  const uid3 = 'user_test_3'; store[`users/${uid3}/meta/profile`] = { name: 'Trois', level: 'intermediaire', goals: ['force'], gear: ['salle'], days: 3, minutes: 60 };
  await fns._applyBillingEvent({ type: 'INITIAL_PURCHASE', app_user_id: uid3, product_id: 'rituel_premium_mensuel', store: 'APP_STORE', expiration_at_ms: Date.now() + 30 * 86400000, purchased_at_ms: Date.now() });
  assert(store[`users/${uid3}/meta/billing`].plan === 'premium', 'achat initial → premium');
  store[`users/${uid3}/meta/usage`] = { month: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 7), chat: 31 };
  const c3 = await call(uid3, { mode: 'chat', messages: [{ role: 'user', content: 'test premium' }] });
  assert(c3 && c3.text, 'abonné premium : au-delà de la limite gratuite, le chat passe');
  await fns._applyBillingEvent({ type: 'CANCELLATION', app_user_id: uid3, expiration_at_ms: Date.now() + 10 * 86400000 });
  assert(store[`users/${uid3}/meta/billing`].plan === 'premium' && store[`users/${uid3}/meta/billing`].cancelledAt, 'résiliation : premium conservé jusqu\'à l\'échéance');
  await fns._applyBillingEvent({ type: 'EXPIRATION', app_user_id: uid3, expiration_at_ms: Date.now() - 1000 });
  assert(store[`users/${uid3}/meta/billing`].plan === 'free', 'expiration → retour au gratuit');
  const r3 = await fns._applyBillingEvent({ type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc' });
  assert(r3.skipped, 'événement anonyme ignoré');
  console.log('Faits calculés');
  const idx = { 'x-1': { name: 'Hack squat', sets: 4, reps: '6-8', rir: [3, 2, 1, 4], mode: 'normal' } };
  const facts = fns._computeFacts({ sets: { 'x-1': [{ w: 100, r: 8, rir: 2, done: true }, { w: 100, r: 8, rir: 2, done: true }] } }, [{ sets: { 'x-1': [{ w: 95, r: 8, rir: 2, done: true }] } }], idx, 2);
  assert(/haut de fourchette atteint.*\+2,5 %/.test(facts) && /dernière fois 95 kg × 8/.test(facts) && /\+5 %/.test(facts), 'haut de fourchette partout → +2,5 %, écart e1RM calculé (' + facts.slice(0, 60) + '…)');
  const facts2 = fns._computeFacts({ sets: { 'x-1': [{ w: 100, r: 6, rir: 0, done: true }, { w: 100, r: 5, rir: 0, done: true }] } }, [], idx, 2);
  assert(/sous le bas de fourchette/.test(facts2) && /RIR plus bas que prévu/.test(facts2), 'série sous la fourchette et RIR trop bas signalés');
  const calls = await (await fetch('http://127.0.0.1:4011/__calls')).json();
  console.log(`\n${failures} échec(s) · ${calls.length} appels au modèle simulé`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('exception', e); process.exit(1); });
