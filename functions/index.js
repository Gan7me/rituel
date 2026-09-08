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
  if (!r.ok) throw new HttpsError('internal', 'Impossible de lister les modèles Anthropic (' + r.status + ').');
  const ids = ((await r.json()).data || []).map(m => m.id);
  const pick = ids.find(i => /sonnet/.test(i)) || ids.find(i => /opus/.test(i)) || ids[0];
  if (!pick) throw new HttpsError('internal', 'Aucun modèle disponible sur ce compte.');
  resolvedModel = pick; return pick;
}

const SYSTEM = `Tu es le préparateur physique de l'utilisateur : 15 ans de terrain en force athlétique, hypertrophie et préparation physique de sportifs opérationnels (pompiers, militaires, calisthénie). Tu le suis comme un athlète confirmé.

Profil : homme, 43 ans, 1m78, 69 kg, sportif de haut niveau, pompier professionnel (gardes de 24 h), entraînement quotidien. Salles ON AIR Lyon, parc complet (Technogym, Hammer Strength, Gym 80, Panatta, Eleiko, Glutebuilder).
Objectifs par priorité : rapport poids/puissance maximal à poids stable ; passer de 35 à 70 tractions strictes ; combler le point faible jambes (force et masse) ; hypertrophie bras et pectoraux, physique dense et strié ; puissance, vitesse, endurance.
Cycle en cours : mésocycle "Fondations" septembre 2026, 6 séances/semaine (Jambes A, Push A, Pull A, Jambes B, Push B, Pull B). S1 calibrage RIR 3, S2 RIR 2 (+1 série sur les exercices ★), S3 RIR 1 avec techniques d'intensification, S4 décharge (séries −40 %, charges S2 −10 %, test tractions à froid). Règle de progression : charge +2,5 % quand le haut de fourchette de reps est atteint sur toutes les séries au RIR prescrit, sinon même charge +1 rep. Nutrition : construction, +250 kcal, poids plafonné à 70 kg. Prévention coudes/épaules prioritaire vu le volume de traction.

Style : français, direct, technique, sans réassurance ni ton pédagogique, phrases courtes, pas de listes à puces sauf pour les ajustements. Tu es honnête : si la récupération ne suit pas, si une charge est incohérente, si un choix est une erreur, tu le dis.`;

const SCHEMA_NOTE = `Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"title":"Jambes A · 07/09 · S1","analysis":"texte d'analyse en 6 à 12 phrases : qualité de la séance, cohérence des charges et des RIR, progression par rapport aux séances précédentes, points d'alerte (douleur, fatigue, garde), ce qu'on retient","adjustments":[{"exId":"jambesA-1","name":"Pendulum squat","change":"4 × 6-8 à 125 kg (RIR 2)","reason":"8 reps atteintes sur les 4 séries à RIR 3","load":125}],"nextFocus":"une phrase sur la priorité de la prochaine séance de ce type"}
Les exId doivent être ceux du programme. Ne propose un ajustement que s'il est justifié par les données. "load" est optionnel (kg).`;

function exerciseIndex() {
  const idx = {};
  for (const s of program.sessions) for (const e of s.exercises) idx[e.id] = { ...e, session: s.name };
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

async function loadContext(uid, limit = 14) {
  const base = db.collection('users').doc(uid);
  const [logs, bw, tests] = await Promise.all([
    base.collection('logs').orderBy('date', 'desc').limit(limit).get(),
    base.collection('bw').orderBy('date', 'desc').limit(8).get(),
    base.collection('tests').orderBy('date', 'desc').limit(5).get()
  ]);
  const idx = exerciseIndex();
  const sessions = logs.docs.map(d => d.data()).filter(l => Object.keys(l.sets || {}).length)
    .map(l => `### ${l.date} · ${(program.sessions.find(s => s.id === l.session) || {}).name || l.session} · S${l.week}${l.done ? '' : ' (non terminée)'}\n${fmtLog(l, idx)}${l.notes ? '\nNotes : ' + l.notes : ''}`);
  const weights = bw.docs.map(d => d.data()).map(b => `${b.date} ${b.kg} kg`).join(', ');
  const pull = tests.docs.map(d => d.data()).map(t => `${t.date} ${t.reps}`).join(', ');
  return `## Journal (du plus récent au plus ancien)\n${sessions.join('\n\n') || '(vide)'}\n\n## Poids de corps\n${weights || '(aucune pesée)'}\n\n## Tests tractions max\n${pull || '35 au départ'}`;
}

async function claude(apiKey, model, system, messages, maxTokens = 1500) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  if (!r.ok) { const t = await r.text(); throw new HttpsError('internal', `Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json();
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

exports.coach = onCall({ region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid; const { mode } = req.data || {};
  const apiKey = ANTHROPIC_API_KEY.value(); const model = await resolveModel(apiKey, MODEL.value());
  const context = await loadContext(uid);
  const idx = exerciseIndex();
  const programSummary = program.sessions.map(s => `${s.name} (${s.id}) : ` + s.exercises.map(e => `${e.id} ${e.name} ${e.setsText || ''}`).join(' ; ')).join('\n');

  if (mode === 'analyse') {
    const logKey = String(req.data.logKey || '');
    const snap = await db.collection('users').doc(uid).collection('logs').doc(logKey).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Séance introuvable.');
    const log = snap.data();
    const sessionName = (program.sessions.find(s => s.id === log.session) || {}).name || log.session;
    const user = `Programme :\n${programSummary}\n\n${context}\n\n## Séance à analyser\n${log.date} · ${sessionName} · S${log.week}${log.done ? '' : ' (non terminée)'}\n${fmtLog(log, idx)}${log.notes ? '\nNotes : ' + log.notes : ''}\n\n${SCHEMA_NOTE}`;
    const text = await claude(apiKey, model, SYSTEM, [{ role: 'user', content: user }], 1800);
    let parsed;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
    catch (e) { parsed = { title: `${sessionName} · ${log.date}`, analysis: text, adjustments: [] }; }
    parsed.adjustments = (parsed.adjustments || []).filter(a => a && idx[a.exId]).map(a => ({ exId: a.exId, name: idx[a.exId].name, change: String(a.change || ''), reason: String(a.reason || ''), load: typeof a.load === 'number' ? a.load : null }));
    const doc = { ...parsed, logKey, session: log.session, createdAt: Date.now(), applied: false, model };
    await db.collection('users').doc(uid).collection('coach').doc(logKey).set(doc);
    return doc;
  }

  if (mode === 'chat') {
    const msgs = (req.data.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpsError('invalid-argument', 'Message manquant.');
    const sys = `${SYSTEM}\n\nProgramme :\n${programSummary}\n\n${context}\n\nSemaine en cours : S${req.data.week || '?'}. Réponds en moins de 200 mots sauf si la question demande un plan détaillé.`;
    const text = await claude(apiKey, model, sys, msgs, 900);
    return { text };
  }
  throw new HttpsError('invalid-argument', 'mode inconnu');
});
