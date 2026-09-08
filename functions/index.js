/* Rituel — fonction Coach.
   Porte la clé Anthropic côté serveur, lit le journal de l'utilisateur dans Firestore,
   appelle Claude et enregistre l'analyse. Deux modes : "analyse" (après une séance)
   et "chat" (question libre). L'utilisateur doit être authentifié. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const program = require('./program.json');

admin.initializeApp();
const db = admin.firestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MODEL = defineString('COACH_MODEL', { default: 'auto' });
let resolvedModel = null;
// 'auto' : choisit le Sonnet le plus récent disponible sur le compte (bon rapport qualité/coût pour ce coach).
async function resolveModel(apiKey, wanted) {
  if (wanted && wanted !== 'auto') return wanted;
  if (resolvedModel) return resolvedModel;
  const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
  if (r.status === 401) throw new HttpsError('failed-precondition', 'Clé API Anthropic refusée (401). La clé enregistrée côté serveur est invalide ou révoquée : régénère une clé sur console.anthropic.com et enregistre-la à nouveau.');
  if (!r.ok) throw new HttpsError('internal', 'Impossible de lister les modèles Anthropic (' + r.status + ').');
  const ids = ((await r.json()).data || []).map(m => m.id);
  const pick = ids.find(i => /sonnet/.test(i)) || ids.find(i => /opus/.test(i)) || ids[0];
  if (!pick) throw new HttpsError('internal', 'Aucun modèle disponible sur ce compte.');
  resolvedModel = pick; return pick;
}

const COACH_STYLE = `Style : français, direct, technique, sans réassurance ni ton pédagogique, phrases courtes, pas de listes à puces sauf pour les ajustements. Tu es honnête : si la récupération ne suit pas, si une charge est incohérente, si un choix est une erreur, tu le dis. Tu adaptes l'exigence au niveau déclaré : un débutant reçoit des consignes simples et sûres, un athlète avancé un vrai niveau de détail (RIR, tempo, techniques d'intensification).`;

function systemFor(profile, program) {
  const p = profile || {};
  const goals = (p.goals || []).join(', ');
  const prog = program ? `Cycle en cours : ${program.cycleName || 'programme personnalisé'}. Semaines : ${(program.weeks || []).map(w => `${w.label} (${w.from} → ${w.to}) : ${w.rirNote || ''}`).join(' | ')}. Règle de progression : charge +2,5 % quand le haut de fourchette de reps est atteint sur toutes les séries au RIR prescrit, sinon même charge +1 rep.` : 'Aucun programme encore.';
  return `Tu es le préparateur physique personnel de l'utilisateur : 15 ans de terrain en force athlétique, hypertrophie, préparation physique et réathlétisation. Tu le suis individuellement.

Profil : ${p.name || 'athlète'}, ${p.sex === 'f' ? 'femme' : 'homme'}, ${p.age || '?'} ans, ${p.height || '?'} cm, ${p.weight || '?'} kg. Niveau : ${p.level || 'non précisé'}. Objectifs : ${goals || 'non précisés'}${p.goalsText ? ' — ' + p.goalsText : ''}. ${p.days || '?'} séances/semaine, ${p.minutes || '?'} min par séance.
Matériel : ${p.equipment || 'non précisé'}.
Contraintes : ${p.constraints || 'aucune déclarée'}.
Repères : ${p.experience || 'aucun déclaré'}.
${prog}

${COACH_STYLE}`;
}

const SCHEMA_NOTE = `Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"title":"Jambes A · 07/09 · S1","analysis":"texte d'analyse en 6 à 12 phrases : qualité de la séance, cohérence des charges et des RIR, progression par rapport aux séances précédentes, points d'alerte (douleur, fatigue, garde), ce qu'on retient","adjustments":[{"exId":"jambesA-1","name":"Pendulum squat","change":"4 × 6-8 à 125 kg (RIR 2)","reason":"8 reps atteintes sur les 4 séries à RIR 3","load":125}],"nextFocus":"une phrase sur la priorité de la prochaine séance de ce type"}
Les exId doivent être ceux du programme. Ne propose un ajustement que s'il est justifié par les données. "load" est optionnel (kg).`;

function exerciseIndex(prog) {
  const idx = {};
  for (const s of prog.sessions) for (const e of s.exercises) idx[e.id] = { ...e, session: s.name };
  return idx;
}

function fmtLog(log, idx) {
  const lines = [];
  for (const [exId, sets] of Object.entries(log.sets || {})) {
    const ex = idx[exId]; if (!ex) continue;
    const done = (sets || []).filter(s => s && s.done);
    if (!done.length) continue;
    const flags = (log.flags || {})[exId] || {};
    lines.push(`${ex.n}. ${ex.name} [${ex.setsText || ''} ${ex.rir ? 'RIR ' + ex.rir.join('/') : ''}] : ` +
      done.map(s => `${s.w != null ? s.w + 'kg×' : ''}${s.r ?? '?'}${s.rir != null ? '@RIR' + s.rir : ''}`).join(', ') +
      (flags.alt ? ' (machine alternative)' : '') + (flags.skip ? ' (sauté)' : ''));
  }
  return lines.join('\n');
}

async function loadMeta(uid) {
  const base = db.collection('users').doc(uid).collection('meta');
  const [pr, pg] = await Promise.all([base.doc('profile').get(), base.doc('program').get()]);
  return { profile: pr.exists ? pr.data() : null, program: pg.exists && pg.data().sessions ? pg.data() : null };
}

async function loadContext(uid, prog, limit = 14) {
  const base = db.collection('users').doc(uid);
  const [logs, bw, tests] = await Promise.all([
    base.collection('logs').orderBy('date', 'desc').limit(limit).get(),
    base.collection('bw').orderBy('date', 'desc').limit(8).get(),
    base.collection('tests').orderBy('date', 'desc').limit(5).get()
  ]);
  const idx = exerciseIndex(prog);
  const sessions = logs.docs.map(d => d.data()).filter(l => Object.keys(l.sets || {}).length)
    .map(l => `### ${l.date} · ${(prog.sessions.find(s => s.id === l.session) || {}).name || l.session} · S${l.week}${l.done ? '' : ' (non terminée)'}\n${fmtLog(l, idx)}${l.notes ? '\nNotes : ' + l.notes : ''}`);
  const weights = bw.docs.map(d => d.data()).map(b => `${b.date} ${b.kg} kg`).join(', ');
  const pull = tests.docs.map(d => d.data()).map(t => `${t.date} ${t.reps}`).join(', ');
  return `## Journal (du plus récent au plus ancien)\n${sessions.join('\n\n') || '(vide)'}\n\n## Poids de corps\n${weights || '(aucune pesée)'}\n\n## Tests tractions max\n${pull || '35 au départ'}`;
}

// Sortie structurée garantie : on force un appel d'outil dont le schéma est le JSON attendu.
let LAST_USAGE = null;
// Tarif indicatif USD par million de tokens (entrée, sortie) selon la famille de modèle.
function priceFor(model) { if (/opus/.test(model)) return [15, 75]; if (/haiku/.test(model)) return [0.8, 4]; return [3, 15]; }
function costUsd(model, usage) { const [i, o] = priceFor(model); const u = usage || {}; return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o) / 1e6; }
async function recordUsage(uid, mode, model) {
  const u = LAST_USAGE || {}; const cost = costUsd(model, u);
  const ref = db.collection('users').doc(uid).collection('meta').doc('usage');
  await ref.set({ tokensIn: admin.firestore.FieldValue.increment(u.input_tokens || 0), tokensOut: admin.firestore.FieldValue.increment(u.output_tokens || 0), costUsd: admin.firestore.FieldValue.increment(cost), lastCostUsd: cost, lastMode: mode, lastModel: model }, { merge: true });
  return cost;
}
async function claudeJSON(apiKey, model, system, messages, schema, maxTokens = 2500) {
  const tool = { name: 'reponse', description: 'Réponse structurée du coach.', input_schema: schema };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools: [tool], tool_choice: { type: 'tool', name: 'reponse' } })
  });
  if (!r.ok) { const t = await r.text(); throw new HttpsError('internal', `Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json(); LAST_USAGE = j.usage || null;
  const use = (j.content || []).find(c => c.type === 'tool_use');
  if (!use || !use.input) throw new HttpsError('internal', 'Le coach n\'a pas renvoyé de réponse structurée.');
  return use.input;
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['title', 'verdict', 'exercises', 'adjustments', 'nextFocus'],
  properties: {
    title: { type: 'string', description: 'Ex. « Push A · S1 »' },
    verdict: { type: 'string', description: 'Verdict de la séance en 2 à 3 phrases courtes : calibrage global, ce que dit la note de l\'athlète confrontée aux chiffres, signal de fatigue ou de douleur s\'il y en a. Conclusion finale uniquement, jamais de raisonnement à voix haute ni de correction en cours de phrase.' },
    exercises: { type: 'array', description: 'Une entrée par exercice réalisé, dans l\'ordre de la séance.', items: { type: 'object', required: ['exId', 'name', 'done', 'read'], properties: { exId: { type: 'string' }, name: { type: 'string' }, done: { type: 'string', description: 'Réalisé, compact : « 4×5 à 80 kg · RIR 3/2/1/4 »' }, read: { type: 'string', description: 'Lecture en une phrase : où on se situe dans la fourchette, cohérence charge/RIR, ce qu\'on en déduit.' }, status: { type: 'string', enum: ['ok', 'up', 'hold', 'warn'], description: 'ok = conforme ; up = progression à faire ; hold = même charge, viser plus de reps ; warn = incohérence, douleur ou charge à revoir' } } } },
    adjustments: { type: 'array', items: { type: 'object', required: ['exId', 'change', 'reason'], properties: { exId: { type: 'string' }, name: { type: 'string' }, change: { type: 'string', description: 'Prescription concrète pour la prochaine fois, ex. « 4 × 5-6 à 82,5 kg (RIR 3) »' }, reason: { type: 'string', description: 'Justification en une phrase.' }, load: { type: 'number' } } } },
    nextFocus: { type: 'string', description: 'Une phrase : la priorité de la prochaine séance de ce type.' }
  }
};

async function claude(apiKey, model, system, messages, maxTokens = 1500) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  if (!r.ok) { const t = await r.text(); throw new HttpsError('internal', `Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json(); LAST_USAGE = j.usage || null;
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

const PROGRAM_SCHEMA = `Réponds UNIQUEMENT avec un objet JSON valide (pas de texte autour, pas de balises). Schéma :
{"cycleName":"Mésocycle 1 · <thème> · <mois année>",
 "rationale":"texte en markdown léger (paragraphes, ## titres, listes -) : lecture du cycle, arbitrages, structure hebdomadaire, progression semaine par semaine, gestion des contraintes, prévention. 300 à 600 mots.",
 "nutrition":"cibles concrètes en 100 à 200 mots (calories, protéines, glucides, lipides, timing), adaptées au profil et à l'objectif. Si le profil ne permet pas d'estimer, dis-le.",
 "warmup":{"common":"...","<groupe>":"...","ramp":"..."},
 "weeks":[{"n":1,"label":"S1 …","from":"AAAA-MM-JJ","to":"AAAA-MM-JJ","rirNote":"..."}, … 4 semaines, la 4e en décharge],
 "sessions":[{"id":"s1","day":1,"dayName":"Lundi","name":"<nom court, ex. Jambes A>","sub":"<dominante>","duration":"60 min","place":"","gtg":false,"note":"",
   "exercises":[{"n":1,"name":"...","machine":"<nom exact marque + modèle si connu, sinon description>","alt":"<alternative si la machine est absente>","star":true,
     "sets":4,"reps":"6-8","per":"","rir":[3,2,1,4],"tempo":"3-1-X-0","restSec":180,"restText":"3 min","mode":"normal",
     "reco":"comment reconnaître la machine (1 phrase)","why":"rôle dans le programme (1-2 phrases)","target":"muscle ou portion ciblée","exec":"exécution : position, trajectoire, points clés, erreurs (2-3 phrases)","seek":"sensation ou résultat attendu (1 phrase)",
     "url":"https://www.google.com/search?tbm=isch&q=<nom+machine+encodé>"}]}]}
Règles : ids de séance s1…sN ; ids d'exercice = "<sessionId>-<n>" implicites (ne pas les écrire). "day" = 1 lundi … 6 samedi, 0 dimanche ; autant de séances que de jours demandés dans le profil, réparties intelligemment. "rir" = 4 valeurs, une par semaine (S4 décharge). "star" = exercices prioritaires qui gagnent une série en S2 et S3. "mode" : "normal", "max" (série au max de reps) ou "emom". Tempo en 4 chiffres (excentrique-pause-concentrique-pause, X = explosif). Choisis des exercices réalisables avec le matériel déclaré, en utilisant vraiment les machines si la salle en a. 5 à 8 exercices par séance selon la durée. Pas de texte hors JSON.`;

function normalizeProgram(p, startISO) {
  const out = { cycleName: String(p.cycleName || 'Mésocycle'), rationale: String(p.rationale || ''), nutrition: String(p.nutrition || ''), warmup: p.warmup && typeof p.warmup === 'object' ? p.warmup : null, weeks: [], sessions: [] };
  const dn = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  (Array.isArray(p.sessions) ? p.sessions : []).forEach((s, i) => {
    const id = /^[a-z0-9]+$/i.test(String(s.id || '')) ? String(s.id) : 's' + (i + 1);
    const day = Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 ? s.day : ((i % 6) + 1);
    const ses = { id, day, dayName: dn[day], name: String(s.name || 'Séance ' + (i + 1)), sub: String(s.sub || ''), duration: String(s.duration || ''), place: String(s.place || ''), gtg: !!s.gtg, note: String(s.note || ''), exercises: [] };
    (Array.isArray(s.exercises) ? s.exercises : []).forEach((e, j) => {
      const n = j + 1; const sets = Math.max(1, Math.min(8, parseInt(e.sets) || 3));
      let rir = Array.isArray(e.rir) ? e.rir.map(x => parseInt(x)).filter(x => !isNaN(x)) : null; if (rir && rir.length < 4) rir = null;
      const restSec = Math.max(20, Math.min(600, parseInt(e.restSec) || 90));
      ses.exercises.push({ id: id + '-' + n, n, name: String(e.name || 'Exercice'), machine: String(e.machine || ''), alt: String(e.alt || ''), star: !!e.star, sets, reps: String(e.reps || '8-12'), per: String(e.per || ''), rir: rir ? rir.slice(0, 4) : [3, 2, 1, 4], tempo: String(e.tempo || '2-0-1-0'), restSec, restText: String(e.restText || (restSec >= 60 ? Math.round(restSec / 60) + ' min' : restSec + ' s')), mode: ['normal', 'max', 'emom'].includes(e.mode) ? e.mode : 'normal', setsText: `${sets} × ${e.reps || ''}`, chargeNote: rir ? `RIR ${rir[0]} → ${rir[1]} → ${rir[2]}` : '', reco: String(e.reco || ''), why: String(e.why || ''), target: String(e.target || ''), exec: String(e.exec || ''), seek: String(e.seek || ''), url: /^https:\/\/www\.google\.com\/search/.test(String(e.url || '')) ? e.url : 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(String(e.machine || e.name || '')) });
      if (e.mode === 'emom' && Array.isArray(e.weeks)) ses.exercises[ses.exercises.length - 1].weeks = e.weeks;
    });
    if (ses.exercises.length) out.sessions.push(ses);
  });
  // semaines : 4, à partir du lundi de départ
  const start = new Date(startISO + 'T12:00:00');
  const labels = ['S1 calibrage', 'S2 accumulation', 'S3 intensification', 'S4 décharge'];
  const notes = ['RIR 3 · établir les références, tout noter', 'RIR 2 · +1 série sur les ★ · +2,5 % ou +1 rep', 'RIR 1 · +2,5 à 5 % · techniques d\'intensification', 'RIR 4 · séries −40 % · charges S2 −10 %'];
  for (let i = 0; i < 4; i++) {
    const f = new Date(start); f.setDate(start.getDate() + 7 * i); const t = new Date(f); t.setDate(f.getDate() + 6);
    const src = Array.isArray(p.weeks) && p.weeks[i] ? p.weeks[i] : {};
    out.weeks.push({ n: i + 1, label: String(src.label || labels[i]), from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10), rirNote: String(src.rirNote || notes[i]) });
  }
  return out;
}
function nextMonday() { const d = new Date(); const day = d.getDay(); const diff = day === 1 ? 0 : (8 - day) % 7; d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10); }

const QUOTAS = { program: 4, analyse: 60, chat: 300 }; // par mois et par compte : plafonne le coût IA
async function checkQuota(uid, mode) {
  const month = new Date().toISOString().slice(0, 7);
  const ref = db.collection('users').doc(uid).collection('meta').doc('usage');
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {};
    const cur = d.month === month ? d : { month, program: 0, analyse: 0, chat: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    if ((cur[mode] || 0) >= QUOTAS[mode]) throw new HttpsError('resource-exhausted', `Quota mensuel atteint pour « ${mode} » (${QUOTAS[mode]}). Il se renouvelle le 1er du mois.`);
    cur[mode] = (cur[mode] || 0) + 1; cur.updatedAt = Date.now();
    tx.set(ref, cur); return cur;
  });
}

exports.deleteAccount = onCall({ region: 'europe-west1' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid;
  await db.recursiveDelete(db.collection('users').doc(uid));
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

exports.coach = onCall({ region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid; const { mode } = req.data || {};
  if (!QUOTAS[mode]) throw new HttpsError('invalid-argument', 'mode inconnu');
  await checkQuota(uid, mode);
  // Nettoyage : un secret collé depuis Windows peut contenir BOM, octets nuls, retours à la ligne ou guillemets.
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
  if (!/^sk-ant-/.test(apiKey)) throw new HttpsError('failed-precondition', 'Clé API Anthropic absente ou mal formée côté serveur (doit commencer par sk-ant-).');
  const model = await resolveModel(apiKey, MODEL.value());
  const meta = await loadMeta(uid);
  if (!meta.profile) throw new HttpsError('failed-precondition', 'Profil manquant.');

  if (mode === 'program') {
    const sys = systemFor(meta.profile, null);
    const user = `Construis le mésocycle de 4 semaines de cet athlète (départ le ${nextMonday()}). Sois concret et exigeant au niveau déclaré. ${PROGRAM_SCHEMA}`;
    const text = await claude(apiKey, model, sys, [{ role: 'user', content: user }], 16000);
    let parsed;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
    catch (e) { throw new HttpsError('internal', 'Le coach a renvoyé un programme illisible, relance la génération.'); }
    const prog = normalizeProgram(parsed, nextMonday());
    if (!prog.sessions.length) throw new HttpsError('internal', 'Programme vide, relance la génération.');
    prog.generatedAt = Date.now(); prog.model = model; prog.profileSnapshot = meta.profile;
    await db.collection('users').doc(uid).collection('meta').doc('program').set(prog);
    await recordUsage(uid, 'program', model);
    return { ok: true, sessions: prog.sessions.length };
  }

  const prog = meta.program || program; // repli : programme embarqué
  const context = await loadContext(uid, prog);
  const idx = exerciseIndex(prog);
  const SYSTEM = systemFor(meta.profile, prog);
  const programSummary = prog.sessions.map(s => `${s.name} (${s.id}) : ` + s.exercises.map(e => `${e.id} ${e.name} ${e.setsText || ''}`).join(' ; ')).join('\n');

  if (mode === 'analyse') {
    const logKey = String(req.data.logKey || '');
    const snap = await db.collection('users').doc(uid).collection('logs').doc(logKey).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Séance introuvable.');
    const log = snap.data();
    const sessionName = (prog.sessions.find(s => s.id === log.session) || {}).name || log.session;
    const guide = `Consignes d'analyse : compare chaque exercice à sa prescription et à la dernière référence (charge, reps, RIR). Si l'athlète écrit que c'était facile, ou si les reps dépassent le haut de fourchette au RIR prescrit, tu augmentes la charge (règle : +2,5 % quand le haut de fourchette est atteint partout, +5 % si la note dit "facile" et que les RIR déclarés sont ≥ 3) et tu le dis exercice par exercice. Si une charge manque, tu le signales et tu demandes de la noter. Tu ne fais pas de généralités : chaque phrase s'appuie sur une donnée de la séance ou de l'historique. Tu livres des conclusions, pas ton raisonnement : pas de « attention », « en fait », « donc » en cascade, pas d'auto-correction. Attention aux fourchettes : 12 reps sur 12-15 est le bas de la fourchette. Propose un ajustement pour chaque exercice où les données le justifient.`;
    const user = `Programme :\n${programSummary}\n\n${context}\n\n## Séance à analyser\n${log.date} · ${sessionName} · S${log.week}${log.done ? '' : ' (non terminée)'}\n${fmtLog(log, idx)}${log.notes ? '\nNote de l\'athlète : ' + log.notes : ''}\n\n${guide}`;
    const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], ANALYSIS_SCHEMA, 2500);
    parsed.exercises = (parsed.exercises || []).filter(e => e && idx[e.exId]).map(e => ({ exId: e.exId, name: idx[e.exId].name, done: String(e.done || ''), read: String(e.read || ''), status: ['ok', 'up', 'hold', 'warn'].includes(e.status) ? e.status : 'ok' }));
    parsed.analysis = String(parsed.verdict || '');
    parsed.title = parsed.title || `${sessionName} · ${log.date}`;
    parsed.adjustments = (parsed.adjustments || []).filter(a => a && idx[a.exId]).map(a => ({ exId: a.exId, name: idx[a.exId].name, change: String(a.change || ''), reason: String(a.reason || ''), load: typeof a.load === 'number' ? a.load : null }));
    const cost = await recordUsage(uid, 'analyse', model);
    const doc = { ...parsed, logKey, session: log.session, createdAt: Date.now(), applied: false, model, costUsd: cost };
    await db.collection('users').doc(uid).collection('coach').doc(logKey).set(doc);
    return doc;
  }

  if (mode === 'chat') {
    const msgs = (req.data.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpsError('invalid-argument', 'Message manquant.');
    const sys = `${SYSTEM}\n\nProgramme :\n${programSummary}\n\n${context}\n\nSemaine en cours : S${req.data.week || '?'}. Réponds en moins de 200 mots sauf si la question demande un plan détaillé.`;
    const text = await claude(apiKey, model, sys, msgs, 900);
    const cost = await recordUsage(uid, 'chat', model);
    return { text, costUsd: cost };
  }
  throw new HttpsError('invalid-argument', 'mode inconnu');
});
