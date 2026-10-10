/* Rituel — fonction Coach.
   Porte la clé Anthropic côté serveur, lit le journal de l'utilisateur dans Firestore,
   appelle Claude et enregistre l'analyse. Deux modes : "analyse" (après une séance)
   et "chat" (question libre). L'utilisateur doit être authentifié. */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const program = require('./program.json');

admin.initializeApp();
const db = admin.firestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const REVENUECAT_WEBHOOK_SECRET = defineSecret('REVENUECAT_WEBHOOK_SECRET');
const MODEL = defineString('COACH_MODEL', { default: 'auto' });
// Base de l'API (surchargée par l'émulateur de test, qui pointe vers un modèle simulé).
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
let resolvedModel = null;
// 'auto' : choisit le Sonnet le plus récent disponible sur le compte (bon rapport qualité/coût pour ce coach).
async function resolveModel(apiKey, wanted) {
  if (wanted && wanted !== 'auto') return wanted;
  if (resolvedModel) return resolvedModel;
  const r = await fetch(API_BASE + '/v1/models?limit=100', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
  if (r.status === 401) throw new HttpsError('failed-precondition', 'Clé API Anthropic refusée (401). La clé enregistrée côté serveur est invalide ou révoquée : régénère une clé sur console.anthropic.com et enregistre-la à nouveau.');
  if (!r.ok) throw new HttpsError('internal', 'Impossible de lister les modèles Anthropic (' + r.status + ').');
  const ids = ((await r.json()).data || []).map(m => m.id);
  const pick = ids.find(i => /sonnet/.test(i)) || ids.find(i => /opus/.test(i)) || ids[0];
  if (!pick) throw new HttpsError('internal', 'Aucun modèle disponible sur ce compte.');
  resolvedModel = pick; return pick;
}

const COACH_STYLE = `Style : tu parles à ton athlète comme un coach de salle qui le connaît, en français naturel, en « tu », phrases complètes. Direct et exigeant, sans réassurance, sans ton de prof, mais pas télégraphique : jamais de notation abrégée dans un texte qui lui est adressé (pas de « 10 reps = bas de fourchette », pas de « @RIR », pas de « → », pas de « +2,5 % justifié »). Tu dis la même chose en clair : « tu as fait 10 reps sur une cible de 10 à 12, tu es au bas de la cible : on garde la charge et on vise 12 avant de monter ». Le jargon (RIR, fourchette, tempo) est utilisé seulement si tu le dis en clair à côté la première fois (« RIR 2, c'est-à-dire deux reps en réserve »). Une personne qui débute doit comprendre chaque phrase ; un athlète confirmé reçoit en plus le vrai niveau de détail (techniques d'intensification, tempo, arbitrages). Pas de listes à puces sauf pour les ajustements. Tu es honnête : si la récupération ne suit pas, si une charge est incohérente, si un choix est une erreur, tu le dis.`;

function systemFor(profile, program) {
  const p = profile || {};
  const goals = (p.goals || []).join(', ');
  const prog = program ? `Cycle en cours : ${program.cycleName || 'programme personnalisé'}. Semaines : ${(program.weeks || []).map(w => `${w.label} (${w.from} → ${w.to}) : ${w.rirNote || ''}`).join(' | ')}. Règle de progression : charge +2,5 % quand le haut de fourchette de reps est atteint sur toutes les séries au RIR prescrit, sinon même charge +1 rep.` : 'Aucun programme encore.';
  return `Tu es le préparateur physique personnel de l'utilisateur : 15 ans de terrain en force athlétique, hypertrophie, préparation physique et réathlétisation. Tu le suis individuellement.

Profil : ${p.name || 'athlète'}, ${p.sex === 'f' ? 'femme' : 'homme'}, ${p.age || '?'} ans, ${p.height || '?'} cm, ${p.weight || '?'} kg. Niveau : ${p.level || 'non précisé'}. Objectifs : ${goals || 'non précisés'}${p.goalsText ? ' — ' + p.goalsText : ''}. ${p.days || '?'} séances/semaine, ${p.minutes || '?'} min par séance.
Matériel disponible : ${(p.gear || []).length ? p.gear.map(g => ({ salle: 'salle complète (machines guidées, barres, poulies)', halteres: 'haltères', barre: 'barre olympique et disques', kettlebell: 'kettlebells', elastiques: 'élastiques', traction: 'barre de traction', trx: 'TRX / sangles', corps: 'poids du corps uniquement', cardio: 'cardio' }[g] || g)).join(', ') : 'non précisé'}${p.equipment ? ' — ' + p.equipment : ''}. Règle absolue : ne prescris que des exercices réalisables avec ce matériel ; s'il n'y a pas de salle, aucune machine.
Autres pratiques à intégrer : ${p.sports || 'aucune'}${p.sports ? ' — organise le volume et la récupération autour de ces pratiques, ne les contredis pas.' : ''}
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

// Faits calculés pour l'analyse : le modèle lit des chiffres déjà comparés (prescription, aujourd'hui, dernière fois, fourchette atteinte, e1RM), il ne les recalcule pas.
function e1rm(w, r) { if (!w || !r) return 0; return r === 1 ? w : w * (1 + r / 30); }
function rangeOf(reps) { const m = String(reps || '').match(/(\d+)\s*[-–à]\s*(\d+)/); if (m) return [Number(m[1]), Number(m[2])]; const n = parseInt(reps); return isNaN(n) ? null : [n, n]; }
function computeFacts(log, prevLogs, idx, week) {
  const lines = [];
  for (const [exId, sets] of Object.entries(log.sets || {})) {
    const ex = idx[exId]; if (!ex || ex.mode === 'emom') continue;
    const done = (sets || []).filter(s => s && s.done); if (!done.length) continue;
    const range = rangeOf(ex.reps); const rirTarget = Array.isArray(ex.rir) ? ex.rir[Math.max(0, (week || 1) - 1)] : null;
    const top = done.reduce((m, s) => (e1rm(s.w, s.r) > e1rm(m.w, m.r) ? s : m), done[0]);
    const prev = prevLogs.map(l => (l.sets || {})[exId]).map(a => (a || []).filter(s => s && s.done)).find(a => a.length);
    const prevTop = prev ? prev.reduce((m, s) => (e1rm(s.w, s.r) > e1rm(m.w, m.r) ? s : m), prev[0]) : null;
    const allInRange = range ? done.every(s => s.r != null && s.r >= range[0]) : null; const allTop = range ? done.every(s => s.r != null && s.r >= range[1]) : null;
    const rirs = done.map(s => s.rir).filter(x => x != null); const minRir = rirs.length ? Math.min(...rirs) : null;
    const d = prevTop && top.w && prevTop.w ? Math.round(100 * (e1rm(top.w, top.r) - e1rm(prevTop.w, prevTop.r)) / e1rm(prevTop.w, prevTop.r)) : null;
    let verdict = 'données incomplètes';
    if (range && top.w) {
      if (allTop && (minRir == null || minRir >= (rirTarget ?? 0))) verdict = 'haut de fourchette atteint sur toutes les séries au RIR prescrit → +2,5 % la prochaine fois';
      else if (allInRange) verdict = 'dans la fourchette, haut non atteint partout → même charge, viser le haut de fourchette';
      else verdict = 'sous le bas de fourchette sur au moins une série → charge trop haute ou fatigue, à confirmer';
      if (minRir != null && rirTarget != null && minRir < rirTarget - 1) verdict += ' ; RIR plus bas que prévu (' + minRir + ' pour ' + rirTarget + ')';
    }
    lines.push(`- ${ex.name} : prescrit ${ex.sets}×${ex.reps}${rirTarget != null ? ' RIR ' + rirTarget : ''} · fait ${done.map(s => `${s.w != null ? s.w + 'kg×' : ''}${s.r ?? '?'}${s.rir != null ? ' RIR' + s.rir : ''}`).join(', ')} · meilleure série ${top.w ? top.w + ' kg × ' + top.r : (top.r + ' reps')} (e1RM ${Math.round(e1rm(top.w, top.r))} kg)${prevTop ? ` · dernière fois ${prevTop.w ? prevTop.w + ' kg × ' + prevTop.r : prevTop.r + ' reps'} (e1RM ${Math.round(e1rm(prevTop.w, prevTop.r))} kg${d != null ? ', ' + (d > 0 ? '+' : '') + d + ' %' : ''})` : ' · première fois'} · ${verdict}`);
  }
  return lines.join('\n');
}
function fmtLog(log, idx) {
  const lines = [];
  for (const [exId, sets] of Object.entries(log.sets || {})) {
    const ex = idx[exId]; if (!ex) continue;
    const done = (sets || []).filter(s => s && s.done);
    const flags = (log.flags || {})[exId] || {};
    if (!done.length) { if (flags.skip) lines.push(`${ex.n}. ${ex.name} : SAUTÉ volontairement ce jour (ne pas le compter comme un manque de données)`); continue; }
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
    .map(l => `### ${l.date} · ${(prog.sessions.find(s => s.id === l.session) || {}).name || l.session} · S${l.week}${isDone(l) ? (l.done ? '' : ' (clôturée automatiquement)') : ' (en cours aujourd\'hui)'}\n${fmtLog(l, idx)}${l.notes ? '\nNotes : ' + l.notes : ''}`);
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
// Certains modèles récents refusent tool_choice "tool" (appel d'outil forcé). On essaie forcé, puis en "auto" avec
// consigne explicite, et en dernier recours on lit le JSON dans le texte. Le mode qui marche est mémorisé par modèle.
const TOOL_MODE = {};
async function claudeJSON(apiKey, model, system, messages, schema, maxTokens = 2500) {
  const tool = { name: 'reponse', description: 'Réponse structurée du coach.', input_schema: schema };
  const call = async (forced) => fetch(API_BASE + '/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: forced ? system : system + '\n\nRéponds obligatoirement en appelant l\'outil « reponse », sans texte libre.', messages, tools: [tool], tool_choice: forced ? { type: 'tool', name: 'reponse' } : { type: 'auto' } })
  });
  let forced = TOOL_MODE[model] !== 'auto';
  let r = await call(forced);
  if (!r.ok && forced && r.status === 400) {
    const t = await r.text();
    if (/tool_choice/i.test(t)) { TOOL_MODE[model] = 'auto'; forced = false; r = await call(false); }
    else throw new HttpsError('internal', `Anthropic 400: ${t.slice(0, 300)}`);
  }
  if (!r.ok) { const t = await r.text(); throw new HttpsError('internal', `Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json(); LAST_USAGE = j.usage || null;
  const use = (j.content || []).find(c => c.type === 'tool_use');
  if (use && use.input) return use.input;
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
  throw new HttpsError('internal', 'Le coach n\'a pas renvoyé de réponse structurée.');
}

// Démos visuelles : association de chaque exercice à une fiche photo (free-exercise-db, domaine public). Un seul appel par programme.
const DEMO_IDS = require('./demo-ids.json'); const DEMO_SET = new Set(DEMO_IDS);
const DEMO_SCHEMA = { type: 'object', required: ['map'], properties: { map: { type: 'array', items: { type: 'object', required: ['exId', 'demoId'], properties: { exId: { type: 'string' }, demoId: { type: 'string', description: 'Identifiant exact pris dans la liste fournie, ou "" si aucune fiche ne montre un mouvement proche.' } } } } } };
async function mapDemos(apiKey, model, exercises) {
  const list = exercises.filter(e => e && e.id && e.name).map(e => `${e.id} | ${e.name} | ${e.machine || ''} | ${e.target || ''}`);
  if (!list.length) return {};
  const user = `Pour chaque exercice ci-dessous, choisis dans la liste de fiches l'identifiant qui montre exactement le même mouvement : même geste ET même groupe musculaire cible, de préférence le même matériel (machine, barre, haltère, câble). Une fiche d'un autre groupe musculaire ou d'un geste différent est une erreur grave : dans le doute, renvoie "" plutôt qu'une approximation. Ne réponds qu'avec les identifiants de la liste.\n\nExercices (id | nom | matériel | cible) :\n${list.join('\n')}\n\nFiches disponibles :\n${DEMO_IDS.join(', ')}`;
  try {
    const parsed = await claudeJSON(apiKey, model, 'Tu associes des exercices de musculation à des fiches de démonstration. Réponds uniquement via l\'outil.', [{ role: 'user', content: user }], DEMO_SCHEMA, 3000);
    const out = {}; (parsed.map || []).forEach(m => { if (m && m.exId && DEMO_SET.has(String(m.demoId || ''))) out[String(m.exId)] = String(m.demoId); });
    return out;
  } catch (e) { return {}; }
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['title', 'verdict', 'exercises', 'adjustments', 'nextFocus'],
  properties: {
    title: { type: 'string', description: 'Ex. « Push A · S1 »' },
    verdict: { type: 'string', maxLength: 700, description: 'Lecture de coach en 3 à 5 phrases (700 caractères max), adressée à l\'athlète en « tu » : ce que les chiffres disent de la séance par rapport à la précédente et à l\'intention de la semaine (RIR visé), le fait marquant (une progression nette, une incohérence, un signal de fatigue ou de douleur), et la décision que tu prends pour la suite. Phrases complètes, précises, chiffrées. Pas de télégraphique, pas de liste, pas de raisonnement à voix haute ni d\'auto-correction.' },
    cue: { type: 'string', maxLength: 220, description: 'Un seul point technique concret pour la prochaine séance de ce type (exécution, tempo, amplitude, respiration, placement), choisi d\'après les données ou la note de l\'athlète. Une phrase.' },
    questions: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 160 }, description: 'Ce que tu dois faire confirmer à l\'athlète avant de trancher : une charge aberrante (ex. 14 kg puis 30 kg sur le même exercice : unité, machine ou erreur de saisie ?), une douleur mentionnée, une série manquante. Vide si rien ne l\'exige. Formulé en question directe.' },
    exercises: { type: 'array', description: 'Une entrée par exercice réalisé, dans l\'ordre de la séance.', items: { type: 'object', required: ['exId', 'name', 'done', 'read'], properties: { exId: { type: 'string' }, name: { type: 'string' }, done: { type: 'string', description: 'Réalisé, compact : « 4×5 à 80 kg · RIR 3/2/1/4 »' }, read: { type: 'string', description: 'Lecture en une ou deux phrases, chiffrée : où on se situe dans la fourchette, cohérence charge/RIR avec la dernière référence, ce qu\'on en déduit et, si utile, le correctif technique.' }, status: { type: 'string', enum: ['ok', 'up', 'hold', 'warn'], description: 'ok = conforme ; up = progression à faire ; hold = même charge, viser plus de reps ; warn = incohérence, douleur ou charge à revoir' } } } },
    adjustments: { type: 'array', items: { type: 'object', required: ['exId', 'change', 'reason'], properties: { exId: { type: 'string' }, name: { type: 'string' }, change: { type: 'string', description: 'Prescription concrète pour la prochaine fois, ex. « 4 × 5-6 à 82,5 kg (RIR 3) »' }, reason: { type: 'string', description: 'Justification en une phrase.' }, load: { type: 'number' } } } },
    nextFocus: { type: 'string', description: 'Une phrase : la priorité de la prochaine séance de ce type.' }
  }
};

async function claude(apiKey, model, system, messages, maxTokens = 1500) {
  const r = await fetch(API_BASE + '/v1/messages', {
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
 "durationWeeks":4, "cycleReason":"une phrase : pourquoi cette durée (3 = reprise ou débutant à recalibrer vite, 4 = standard, 5-6 = athlète confirmé en accumulation longue)",
 "weeks":[{"n":1,"label":"S1 …","from":"AAAA-MM-JJ","to":"AAAA-MM-JJ","rirNote":"..."}, … autant que durationWeeks (3 à 6), la dernière toujours en décharge ; "rir" de chaque exercice a autant de valeurs que de semaines],
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
      let rir = Array.isArray(e.rir) ? e.rir.map(x => parseInt(x)).filter(x => !isNaN(x)) : null; if (rir && rir.length < 3) rir = null;
      const restSec = Math.max(20, Math.min(600, parseInt(e.restSec) || 90));
      ses.exercises.push({ id: id + '-' + n, n, name: String(e.name || 'Exercice'), machine: String(e.machine || ''), alt: String(e.alt || ''), star: !!e.star, sets, reps: String(e.reps || '8-12'), per: String(e.per || ''), rir: rir || [3, 2, 1, 4], tempo: String(e.tempo || '2-0-1-0'), restSec, restText: String(e.restText || (restSec >= 60 ? Math.round(restSec / 60) + ' min' : restSec + ' s')), mode: ['normal', 'max', 'emom'].includes(e.mode) ? e.mode : 'normal', setsText: `${sets} × ${e.reps || ''}`, chargeNote: rir ? `RIR ${rir[0]} → ${rir[1]} → ${rir[2]}` : '', reco: String(e.reco || ''), why: String(e.why || ''), target: String(e.target || ''), exec: String(e.exec || ''), seek: String(e.seek || ''), url: /^https:\/\/www\.google\.com\/search/.test(String(e.url || '')) ? e.url : 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(String(e.machine || e.name || '')) });
      if (e.mode === 'emom' && Array.isArray(e.weeks)) ses.exercises[ses.exercises.length - 1].weeks = e.weeks;
    });
    if (ses.exercises.length) out.sessions.push(ses);
  });
  // semaines : 3 à 6 (choisies par le coach), la dernière en décharge, à partir du lundi de départ
  const N = Math.max(3, Math.min(6, (Array.isArray(p.weeks) && p.weeks.length) || parseInt(p.durationWeeks) || 4));
  const plan = { 3: [['S1 calibrage', 'RIR 3 · établir les références, tout noter'], ['S2 intensification', 'RIR 1 · +2,5 à 5 %'], ['S3 décharge', 'RIR 4 · séries −40 % · charges −10 %']],
    4: [['S1 calibrage', 'RIR 3 · établir les références, tout noter'], ['S2 accumulation', 'RIR 2 · +1 série sur les ★ · +2,5 % ou +1 rep'], ['S3 intensification', 'RIR 1 · +2,5 à 5 % · techniques d\'intensification'], ['S4 décharge', 'RIR 4 · séries −40 % · charges S2 −10 %']],
    5: [['S1 calibrage', 'RIR 3 · établir les références'], ['S2 accumulation', 'RIR 2 · +1 série sur les ★'], ['S3 accumulation 2', 'RIR 2 · +2,5 % ou +1 rep'], ['S4 intensification', 'RIR 1 · +2,5 à 5 % · intensification'], ['S5 décharge', 'RIR 4 · séries −40 % · charges −10 %']],
    6: [['S1 calibrage', 'RIR 3 · établir les références'], ['S2 accumulation', 'RIR 2 · +1 série sur les ★'], ['S3 accumulation 2', 'RIR 2 · +2,5 % ou +1 rep'], ['S4 intensification', 'RIR 1 · +2,5 à 5 %'], ['S5 intensification 2', 'RIR 0-1 · techniques d\'intensification'], ['S6 décharge', 'RIR 4 · séries −40 % · charges −10 %']] }[N];
  const labels = plan.map(x => x[0]), notes = plan.map(x => x[1]);
  out.durationWeeks = N; out.cycleReason = String(p.cycleReason || '');
  out.sessions.forEach(se => se.exercises.forEach(e => { const r = e.rir.slice(); const deload = r[r.length - 1]; const body = r.slice(0, -1); while (body.length < N - 1) body.push(body[body.length - 1] ?? 2); e.rir = body.slice(0, N - 1).concat([deload]); }));
  const start = new Date(startISO + 'T12:00:00');
  for (let i = 0; i < N; i++) {
    const f = new Date(start); f.setDate(start.getDate() + 7 * i); const t = new Date(f); t.setDate(f.getDate() + 6);
    const src = Array.isArray(p.weeks) && p.weeks[i] ? p.weeks[i] : {};
    out.weeks.push({ n: i + 1, label: String(src.label || labels[i]), from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10), rirNote: String(src.rirNote || notes[i]) });
  }
  return out;
}
// Garde-fous par niveau : bornes de volume, RIR minimum, alertes. Appliqués après normalisation, avant enregistrement.
const LEVEL_CAPS = { debutant: { setsPerSession: 16, exPerSession: 6, minRir: 2, maxSetsPerEx: 4 }, intermediaire: { setsPerSession: 22, exPerSession: 8, minRir: 1, maxSetsPerEx: 5 }, confirme: { setsPerSession: 28, exPerSession: 9, minRir: 0, maxSetsPerEx: 6 }, avance: { setsPerSession: 32, exPerSession: 10, minRir: 0, maxSetsPerEx: 8 } };
function applyGuardrails(prog, profile) {
  const lvl = LEVEL_CAPS[(profile || {}).level] || LEVEL_CAPS.intermediaire; const notes = [];
  prog.sessions.forEach(s => {
    if (s.exercises.length > lvl.exPerSession) { notes.push(`${s.name} : ${s.exercises.length} exercices ramenés à ${lvl.exPerSession}`); s.exercises = s.exercises.slice(0, lvl.exPerSession); }
    s.exercises.forEach((e, j) => { e.n = j + 1; e.id = s.id + '-' + e.n; if (e.sets > lvl.maxSetsPerEx) { notes.push(`${e.name} : ${e.sets} séries → ${lvl.maxSetsPerEx}`); e.sets = lvl.maxSetsPerEx; } e.rir = e.rir.map(r => Math.max(lvl.minRir, r)); });
    let total = s.exercises.reduce((a, e) => a + e.sets, 0);
    while (total > lvl.setsPerSession) { const big = s.exercises.reduce((m, e) => e.sets > m.sets ? e : m, s.exercises[0]); if (big.sets <= 2) break; big.sets -= 1; total -= 1; notes.push(`${s.name} : volume ramené à ${lvl.setsPerSession} séries (−1 sur ${big.name})`); }
  });
  if (notes.length) prog.guardrails = notes;
  return prog;
}
function nextMonday() { const d = new Date(); const day = d.getDay(); const diff = day === 1 ? 0 : (8 - day) % 7; d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10); }

// Forfaits : gratuit (découverte) et premium. Le forfait vient de meta/billing.plan (posé par le webhook de paiement) ; les administrateurs sont premium.
const ADMIN_EMAILS = ['ganeme.asloune@nexisafe.com', 'gads@live.fr'];
const PLANS = {
  free: { program: 2, analyse: 8, chat: 30, substitute: 2, demo: 4 },
  premium: { program: 6, analyse: 60, chat: 300, substitute: 12, demo: 10 }
};
const QUOTAS = PLANS.premium; // référence des modes connus
async function planFor(uid, email) {
  if (ADMIN_EMAILS.includes(String(email || '').toLowerCase())) return 'premium';
  const b = await db.collection('users').doc(uid).collection('meta').doc('billing').get();
  const d = b.exists ? b.data() : {};
  if (d.plan === 'premium' && (!d.expiresAt || d.expiresAt > Date.now())) return 'premium';
  return 'free';
}
async function refundQuota(uid, mode) { try { await db.collection('users').doc(uid).collection('meta').doc('usage').set({ [mode]: admin.firestore.FieldValue.increment(-1) }, { merge: true }); } catch (e) {} } // par mois et par compte : plafonne le coût IA
async function checkQuota(uid, mode, plan) {
  const month = parisISO().slice(0, 7); const limits = PLANS[plan] || PLANS.free;
  const ref = db.collection('users').doc(uid).collection('meta').doc('usage');
  const label = { program: 'programmes', analyse: 'analyses', chat: 'questions', substitute: 'séances sans salle', demo: 'fiches' }[mode] || mode;
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {};
    const cur = d.month === month ? d : { month, program: 0, analyse: 0, chat: 0, substitute: 0, demo: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    cur.plan = plan; cur.limits = limits;
    if ((cur[mode] || 0) >= limits[mode]) throw new HttpsError('resource-exhausted', plan === 'free' ? `QUOTA_FREE:${label}:${limits[mode]}` : `Quota mensuel atteint : ${limits[mode]} ${label}. Il se renouvelle le 1er du mois.`);
    cur[mode] = (cur[mode] || 0) + 1; cur.updatedAt = Date.now();
    tx.set(ref, cur); return cur;
  });
}

// Tableau de bord administrateur : comptes, programmes, séances et erreurs des 7 derniers jours, coût IA du mois.
exports.adminStats = onCall({ region: 'europe-west1' }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const since = isoDaysAgo(7); const sinceMs = Date.now() - 7 * 86400000; const month = parisISO().slice(0, 7);
  const users = await db.collection('users').listDocuments();
  let withProgram = 0, sessions7 = 0, costMonth = 0, calls = 0, premium = 0; const perUser = [];
  for (const u of users) {
    const [pg, us, pr, bl, lg] = await Promise.all([u.collection('meta').doc('program').get(), u.collection('meta').doc('usage').get(), u.collection('meta').doc('profile').get(), u.collection('meta').doc('billing').get(), u.collection('logs').where('date', '>=', since).get()]);
    const hasProg = pg.exists && !!pg.data().sessions; if (hasProg) withProgram++;
    const usage = us.exists ? us.data() : {}; if (usage.month === month) { costMonth += usage.costUsd || 0; calls += (usage.analyse || 0) + (usage.chat || 0) + (usage.program || 0) + (usage.substitute || 0) + (usage.demo || 0); }
    const n7 = lg.docs.filter(d => isDone(d.data())).length; sessions7 += n7;
    const plan = bl.exists && bl.data().plan === 'premium' && (!bl.data().expiresAt || bl.data().expiresAt > Date.now()) ? 'premium' : 'free'; if (plan === 'premium') premium++;
    let email = '', disabled = false, created = null; try { const au = await admin.auth().getUser(u.id); email = au.email || ''; disabled = !!au.disabled; created = au.metadata && au.metadata.creationTime ? new Date(au.metadata.creationTime).getTime() : null; } catch (e) {}
    const bd = bl.exists ? bl.data() : {};
    perUser.push({ uid: u.id.slice(0, 6), uidFull: u.id, email, disabled, created, lastAt: usage.updatedAt || null, admin: ADMIN_EMAILS.includes(email.toLowerCase()), name: pr.exists ? (pr.data().name || '') : '', program: hasProg, sessions7: n7, plan: ADMIN_EMAILS.includes(email.toLowerCase()) ? 'premium' : plan, source: bd.source || '', store: bd.store || '', expiresAt: bd.expiresAt || null, cost: usage.month === month ? Math.round((usage.costUsd || 0) * 100) / 100 : 0, lastMode: usage.lastMode || '' });
  }
  const errs = await db.collection('errors').where('t', '>=', sinceMs).orderBy('t', 'desc').limit(100).get();
  const errors = errs.docs.map(d => d.data()).map(e => ({ t: e.t, uid: String(e.uid || '').slice(0, 6), src: e.src, msg: String(e.msg || '').slice(0, 160), ver: e.ver }));
  const health = (await db.collection('system').doc('health').get()).data() || null;
  return { users: users.length, withProgram, premium, sessions7, calls, costMonth: Math.round(costMonth * 100) / 100, errors, health, perUser: perUser.sort((a, b) => b.sessions7 - a.sessions7).slice(0, 50) };
});

// Forfait posé à la main par l'administrateur (Premium offert pour N mois, ou retiré). Un abonnement payant repasse par le webhook.
exports.adminSetPlan = onCall({ region: 'europe-west1' }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const uid = String((req.data || {}).uid || ''); const plan = (req.data || {}).plan === 'premium' ? 'premium' : 'free'; const months = Math.max(0, Math.min(36, parseInt((req.data || {}).months) || 0));
  if (!uid) throw new HttpsError('invalid-argument', 'uid manquant');
  const ref = db.collection('users').doc(uid).collection('meta').doc('billing');
  if (plan === 'premium') { const exp = new Date(); exp.setMonth(exp.getMonth() + (months || 1)); await ref.set({ plan: 'premium', source: 'admin', store: '', expiresAt: exp.getTime(), since: Date.now(), updatedAt: Date.now() }, { merge: true }); console.log(`[billing] admin premium uid=${uid.slice(0, 6)} ${months || 1} mois`); return { plan, expiresAt: exp.getTime() }; }
  await ref.set({ plan: 'free', source: 'admin', expiresAt: Date.now(), updatedAt: Date.now() }, { merge: true }); console.log(`[billing] admin free uid=${uid.slice(0, 6)}`); return { plan };
});

// Actions d'administration sur un compte : remise à zéro des compteurs du mois, notification, blocage, suppression.
exports.adminAction = onCall({ region: 'europe-west1' }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const { uid, action, text } = req.data || {}; if (!uid || !action) throw new HttpsError('invalid-argument', 'uid et action requis');
  const base = db.collection('users').doc(String(uid));
  if (action === 'resetQuota') { await base.collection('meta').doc('usage').set({ month: parisISO().slice(0, 7), program: 0, analyse: 0, chat: 0, substitute: 0, demo: 0, updatedAt: Date.now() }, { merge: true }); await base.collection('meta').doc('genstate').delete().catch(() => {}); return { ok: true }; }
  if (action === 'push') { await sendPush(String(uid), 'Rituel', String(text || '').slice(0, 200), { tab: 'home' }); return { ok: true }; }
  if (action === 'block' || action === 'unblock') { await admin.auth().updateUser(String(uid), { disabled: action === 'block' }); return { ok: true, disabled: action === 'block' }; }
  if (action === 'delete') { await db.recursiveDelete(base); await admin.auth().deleteUser(String(uid)).catch(() => {}); return { ok: true }; }
  throw new HttpsError('invalid-argument', 'action inconnue');
});

// Webhook RevenueCat : source de vérité du forfait payant. L'app_user_id est l'uid Firebase (posé par la coquille à la connexion).
// Configuration côté RevenueCat : URL de cette fonction, en-tête Authorization = Bearer <REVENUECAT_WEBHOOK_SECRET>.
const PREMIUM_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE', 'TRANSFER'];
const END_EVENTS = ['EXPIRATION', 'BILLING_ISSUE'];
async function applyBillingEvent(ev) {
  const uid = String(ev.app_user_id || ''); if (!uid || /^\$RCAnonymousID/.test(uid)) return { skipped: 'anonyme' };
  const ref = db.collection('users').doc(uid).collection('meta').doc('billing');
  const base = { store: ev.store || '', productId: ev.product_id || '', environment: ev.environment || '', lastEvent: ev.type, updatedAt: Date.now() };
  if (PREMIUM_EVENTS.includes(ev.type)) { await ref.set({ ...base, plan: 'premium', expiresAt: ev.expiration_at_ms || null, since: ev.purchased_at_ms || Date.now() }, { merge: true }); return { plan: 'premium' }; }
  if (ev.type === 'CANCELLATION') { await ref.set({ ...base, cancelledAt: Date.now(), expiresAt: ev.expiration_at_ms || null }, { merge: true }); return { plan: 'premium', cancelled: true }; } // reste premium jusqu'à l'échéance
  if (END_EVENTS.includes(ev.type)) { await ref.set({ ...base, plan: 'free', expiresAt: ev.expiration_at_ms || Date.now() }, { merge: true }); return { plan: 'free' }; }
  if (ev.type === 'SUBSCRIPTION_PAUSED') { await ref.set({ ...base, plan: 'free' }, { merge: true }); return { plan: 'free' }; }
  await ref.set(base, { merge: true }); return { noted: ev.type };
}
exports.revenuecatWebhook = onRequest({ region: 'europe-west1', secrets: [REVENUECAT_WEBHOOK_SECRET] }, async (req, res) => {
  const secret = String(REVENUECAT_WEBHOOK_SECRET.value() || '').trim();
  const auth = String(req.get('authorization') || '');
  if (!secret || auth !== 'Bearer ' + secret) { res.status(401).send('non autorisé'); return; }
  const ev = (req.body && req.body.event) || null;
  if (!ev || !ev.type) { res.status(400).send('événement manquant'); return; }
  try { const r = await applyBillingEvent(ev); console.log(`[billing] ${ev.type} uid=${String(ev.app_user_id || '').slice(0, 6)} → ${JSON.stringify(r)}`); res.status(200).json(r); }
  catch (e) { console.error('[billing] erreur', e && e.message); res.status(500).send('erreur'); }
});
exports._applyBillingEvent = applyBillingEvent;
exports._computeFacts = computeFacts;

exports.deleteAccount = onCall({ region: 'europe-west1' }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid;
  await db.recursiveDelete(db.collection('users').doc(uid));
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

exports.coach = onCall({ region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
  // Journal lisible dans `firebase functions:log` (texte brut) : mode, durée, résultat ou erreur.
  const t0 = Date.now(); const mode0 = (req.data || {}).mode; const uid0 = req.auth ? req.auth.uid.slice(0, 6) : 'anon';
  try {
    const out = await coachImpl(req);
    console.log(`[coach] ${mode0} uid=${uid0} ok ${Date.now() - t0} ms · ${resolvedModel || MODEL.value()}`);
    return out;
  } catch (e) {
    console.error(`[coach] ${mode0} uid=${uid0} ERREUR ${e && e.code ? e.code : ''} : ${e && e.message ? e.message : e} (${Date.now() - t0} ms)`);
    throw e;
  }
});
async function generateProgramFor(uid, meta, apiKey, model) {
  const genRef = db.collection('users').doc(uid).collection('meta').doc('genstate');
    const sys = systemFor(meta.profile, null);
    const safety = { debutant: 'Débutant : 3 séances max, 4 à 6 exercices par séance, 12 à 16 séries, RIR jamais sous 2, pas de techniques d\'intensification, machines guidées et mouvements simples, échauffement détaillé, aucune charge suggérée en kg.', intermediaire: 'Intermédiaire : 16 à 22 séries par séance, RIR 3 → 1, une seule technique d\'intensification en S3.', confirme: 'Confirmé : 22 à 28 séries, RIR jusqu\'à 0 sur les isolations en S3, intensification ciblée.', avance: 'Avancé : volume et intensité d\'athlète, techniques d\'intensification justifiées.' }[(meta.profile || {}).level] || '';
    const constraints = (meta.profile || {}).constraints ? `Respecte strictement les contraintes déclarées (blessures, douleurs, métier) : exclus tout exercice qui les sollicite et propose une alternative. ` : '';
    const user = `Construis le mésocycle de 4 semaines de cet athlète (départ le ${nextMonday()}). Sois concret et exigeant au niveau déclaré. ${safety} ${constraints}${PROGRAM_SCHEMA}`;
    let prog;
    try {
      const text = await claude(apiKey, model, sys, [{ role: 'user', content: user }], 16000);
      let parsed;
      try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
      catch (e) { throw new HttpsError('internal', 'Le coach a renvoyé un programme illisible, relance la génération.'); }
      prog = applyGuardrails(normalizeProgram(parsed, nextMonday()), meta.profile);
      if (!prog.sessions.length) throw new HttpsError('internal', 'Programme vide, relance la génération.');
    } catch (e) { await refundQuota(uid, 'program'); throw e; } // un échec ne consomme pas une génération
    prog.generatedAt = Date.now(); prog.model = model; prog.profileSnapshot = meta.profile;
    await recordUsage(uid, 'program', model);
    prog.demos = await mapDemos(apiKey, model, prog.sessions.flatMap(se => se.exercises)); prog.demosAt = Date.now(); if (Object.keys(prog.demos).length) await recordUsage(uid, 'demo', model);
    await db.collection('users').doc(uid).collection('meta').doc('program').set(prog);
    await genRef.set({ status: 'done', at: Date.now() });
    return { ok: true, sessions: prog.sessions.length };
}
async function coachImpl(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid; const { mode } = req.data || {};
  if (!QUOTAS[mode]) throw new HttpsError('invalid-argument', 'mode inconnu');
  const plan = await planFor(uid, req.auth.token && req.auth.token.email);
  // Génération déjà en cours (l'appel précédent a été coupé côté téléphone) : on ne relance pas, on ne reconsomme pas, le programme arrivera par Firestore.
  const genRef = db.collection('users').doc(uid).collection('meta').doc('genstate');
  if (mode === 'program') { const g = await genRef.get(); const gd = g.exists ? g.data() : {}; if (gd.status === 'running' && Date.now() - (gd.startedAt || 0) < 8 * 60000) return { ok: true, running: true }; }
  await checkQuota(uid, mode, plan);
  // Nettoyage : un secret collé depuis Windows peut contenir BOM, octets nuls, retours à la ligne ou guillemets.
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
  if (!/^sk-ant-/.test(apiKey)) throw new HttpsError('failed-precondition', 'Clé API Anthropic absente ou mal formée côté serveur (doit commencer par sk-ant-).');
  const model = await resolveModel(apiKey, MODEL.value());
  const meta = await loadMeta(uid);
  if (!meta.profile) throw new HttpsError('failed-precondition', 'Profil manquant.');

  if (mode === 'program') {
    await genRef.set({ status: 'running', startedAt: Date.now() });
    try { return await generateProgramFor(uid, meta, apiKey, model); }
    catch (e) { await genRef.set({ status: 'error', message: String(e && e.message || e).slice(0, 300), at: Date.now() }); throw e; }
  }

  const prog = meta.program || program; // repli : programme embarqué
  const context = await loadContext(uid, prog);
  const idx = exerciseIndex(prog);
  // Repères temporels explicites : date du jour (Paris), séances faites sur 7 jours, semaine effective du cycle.
  const today = parisISO(); const dayName = new Date().toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  const weekLogs = await db.collection('users').doc(uid).collection('logs').where('date', '>=', isoDaysAgo(7)).get();
  const doneWeek = weekLogs.docs.map(d => d.data()).filter(l => isDone(l, today));
  const weeksDone = await weekIndexDone(uid, prog);
  const SYSTEM = systemFor(meta.profile, prog) + `\n\nRepères : aujourd'hui ${dayName} ${today}. Séances validées sur les 7 derniers jours : ${doneWeek.length} (${doneWeek.map(l => l.date + ' ' + ((prog.sessions.find(s => s.id === l.session) || {}).name || l.session)).join(', ') || 'aucune'}). Semaines effectuées depuis le début du cycle : ${weeksDone} sur ${(prog.weeks || []).length || 4}. Une séance d'un jour passé avec des séries enregistrées compte comme faite même si elle n'a pas été « terminée » dans l'app.`;
  const programSummary = prog.sessions.map(s => `${s.name} (${s.id}) : ` + s.exercises.map(e => `${e.id} ${e.name} ${e.setsText || ''}`).join(' ; ')).join('\n');

  if (mode === 'analyse') {
    const logKey = String(req.data.logKey || '');
    const snap = await db.collection('users').doc(uid).collection('logs').doc(logKey).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Séance introuvable.');
    const log = snap.data();
    const sessionName = (prog.sessions.find(s => s.id === log.session) || {}).name || log.session;
    const doneSets = Object.values(log.sets || {}).flat().filter(s => s && s.done).length;
    if (!doneSets) throw new HttpsError('failed-precondition', 'Aucune série enregistrée pour cette séance : rien à analyser.');
    const guide = `Consignes d'analyse. Tu es le coach de cet athlète, pas un rapport automatique : tu lis la séance comme un préparateur physique qui connaît son histoire. Exercice sauté : il l'a décidé, tu ne le comptes pas comme un manque de données, tu demandes seulement pourquoi si ça se répète. Charge aberrante d'une séance à l'autre (écart > 30 % sur le même exercice) : tu ne la juges pas, tu la fais confirmer dans « questions » (unité, machine différente, erreur de saisie) et tu neutralises cet exercice dans tes décisions. Compare chaque exercice à sa prescription et à la dernière référence (charge, reps, RIR). Si l'athlète écrit que c'était facile, ou si les reps dépassent le haut de fourchette au RIR prescrit, tu augmentes la charge (règle : +2,5 % quand le haut de fourchette est atteint partout, +5 % si la note dit "facile" et que les RIR déclarés sont ≥ 3) et tu le dis exercice par exercice. Si une charge manque, tu le signales et tu demandes de la noter. Tu ne fais pas de généralités : chaque phrase s'appuie sur une donnée de la séance ou de l'historique. Tu livres des conclusions, pas ton raisonnement : pas de « attention », « en fait », « donc » en cascade, pas d'auto-correction. Attention aux fourchettes : 12 reps sur 12-15 est le bas de la fourchette. Propose un ajustement pour chaque exercice où les données le justifient.`;
    const prevSnap = await db.collection('users').doc(uid).collection('logs').orderBy('date', 'desc').limit(40).get().catch(() => ({ docs: [] }));
    const prevLogs = prevSnap.docs.map(d => d.data()).filter(l => l.session === log.session && l.date < log.date).slice(0, 4);
    const facts = computeFacts(log, prevLogs, idx, log.week);
    const user = `Programme :\n${programSummary}\n\n${context}\n\n## Séance à analyser\n${log.date} · ${sessionName} · S${log.week}${log.done ? '' : ' (non terminée)'}\n${fmtLog(log, idx)}${log.notes ? '\nNote de l\'athlète : ' + log.notes : ''}\n\n## Faits calculés (fiables, à utiliser tels quels, ne recalcule pas)\n${facts || '(aucun)'}\n\n${guide}`;
    const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], ANALYSIS_SCHEMA, 3500);
    parsed.exercises = (parsed.exercises || []).filter(e => e && idx[e.exId]).map(e => ({ exId: e.exId, name: idx[e.exId].name, done: String(e.done || ''), read: String(e.read || ''), status: ['ok', 'up', 'hold', 'warn'].includes(e.status) ? e.status : 'ok' }));
    parsed.analysis = String(parsed.verdict || '');
    parsed.cue = String(parsed.cue || ''); parsed.questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map(q => String(q)).filter(Boolean).slice(0, 2);
    parsed.title = parsed.title || `${sessionName} · ${log.date}`;
    parsed.adjustments = (parsed.adjustments || []).filter(a => a && idx[a.exId]).map(a => ({ exId: a.exId, name: idx[a.exId].name, change: String(a.change || ''), reason: String(a.reason || ''), load: typeof a.load === 'number' ? a.load : null }));
    const cost = await recordUsage(uid, 'analyse', model);
    const doc = { ...parsed, logKey, session: log.session, createdAt: Date.now(), applied: false, model, costUsd: cost };
    await db.collection('users').doc(uid).collection('coach').doc(logKey).set(doc);
    return doc;
  }

  if (mode === 'substitute') {
    // Séance de remplacement du jour sans la salle : mêmes intentions, autre matériel. Enregistrée dans overrides/{sessionId}.substitute.
    const sid = String(req.data.sessionId || ''); const ses = prog.sessions.find(s => s.id === sid);
    if (!ses) throw new HttpsError('not-found', 'Séance inconnue.');
    const gear = (Array.isArray(req.data.gear) ? req.data.gear : []).map(String).slice(0, 10); const note = String(req.data.note || '').slice(0, 300);
    const week = Math.max(1, parseInt(req.data.week) || 1); const W = (prog.weeks || [])[week - 1] || {};
    const SUB_SCHEMA = { type: 'object', required: ['name', 'intro', 'exercises'], properties: { name: { type: 'string', description: 'Nom court, ex. « Jambes A · maison »' }, intro: { type: 'string', maxLength: 300, description: '2 phrases : ce qu\'on garde de la séance prévue, ce qu\'on change, et l\'intention (RIR, tempo) de la semaine.' }, exercises: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'object', required: ['name', 'machine', 'sets', 'reps', 'rir', 'tempo', 'restSec', 'why', 'exec'], properties: { name: { type: 'string' }, machine: { type: 'string', description: 'Matériel utilisé (ex. « élastique fort », « haltères », « poids du corps »)' }, replaces: { type: 'string', description: 'Exercice de la séance prévue qu\'il remplace' }, sets: { type: 'integer' }, reps: { type: 'string' }, rir: { type: 'integer' }, tempo: { type: 'string' }, restSec: { type: 'integer' }, why: { type: 'string' }, target: { type: 'string' }, exec: { type: 'string' }, seek: { type: 'string' } } } } } };
    const user = `Séance prévue aujourd'hui : ${ses.name} (${ses.sub}) — semaine ${W.label || week} : ${W.rirNote || ''}\nExercices prévus :\n${ses.exercises.map(e => `- ${e.name} · ${e.machine} · ${e.sets}×${e.reps} · RIR ${(e.rir || [])[week - 1] ?? ''} · tempo ${e.tempo} · cible ${e.target || ''}`).join('\n')}\n\nL'athlète n'a pas accès à sa salle aujourd'hui. Matériel disponible : ${gear.join(', ') || 'poids du corps uniquement'}. ${note ? 'Précision : ' + note : ''}\nConstruis la séance de remplacement : mêmes groupes musculaires et même intention (RIR, tempo, volume approché), uniquement avec ce matériel, techniques adaptées (tempo lent, pauses, unilatéral, partielles, séries longues) pour compenser la charge limitée. Chaque exercice remplace explicitement un exercice prévu. Exécution précise, erreurs à éviter.`;
    const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], SUB_SCHEMA, 3000);
    const exercises = (parsed.exercises || []).map((e, j) => { const restSec = Math.max(20, Math.min(300, parseInt(e.restSec) || 60)); const sets = Math.max(1, Math.min(6, parseInt(e.sets) || 3)); const rir = Math.max(0, Math.min(4, parseInt(e.rir) || 2)); return { id: `${sid}-sub${j + 1}`, n: j + 1, name: String(e.name || 'Exercice'), machine: String(e.machine || ''), alt: '', star: false, sets, reps: String(e.reps || '10-15'), per: '', rir: Array(6).fill(rir), tempo: String(e.tempo || '2-1-1-0'), restSec, restText: restSec >= 60 ? Math.round(restSec / 60) + ' min' : restSec + ' s', mode: 'normal', replaces: String(e.replaces || ''), why: String(e.why || ''), target: String(e.target || ''), exec: String(e.exec || ''), seek: String(e.seek || ''), reco: '' }; });
    if (exercises.length < 3) throw new HttpsError('internal', 'Séance de remplacement incomplète, relance.');
    const cost = await recordUsage(uid, 'substitute', model);
    const dm = await mapDemos(apiKey, model, exercises); exercises.forEach(e => { if (dm[e.id]) e.demo = dm[e.id]; }); if (Object.keys(dm).length) await recordUsage(uid, 'demo', model);
    const substitute = { name: String(parsed.name || ses.name + ' · sans salle'), intro: String(parsed.intro || ''), gear, exercises, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }), createdAt: Date.now(), model, costUsd: cost };
    await db.collection('users').doc(uid).collection('overrides').doc(sid).set({ substitute, updatedAt: Date.now() }, { merge: true });
    return substitute;
  }

  if (mode === 'demo') {
    // Programme déjà généré sans fiches : on les associe une fois et on les enregistre dans le programme.
    const exercises = prog.sessions.flatMap(se => se.exercises);
    const demos = await mapDemos(apiKey, model, exercises);
    await db.collection('users').doc(uid).collection('meta').doc('program').set({ demos, demosAt: Date.now() }, { merge: true });
    await recordUsage(uid, 'demo', model);
    return { ok: true, demos };
  }

  if (mode === 'chat') {
    const msgs = (req.data.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpsError('invalid-argument', 'Message manquant.');
    const sys = `${SYSTEM}\n\nProgramme :\n${programSummary}\n\n${context}\n\nSemaine en cours : S${req.data.week || '?'}. Réponds en moins de 200 mots sauf si la question demande un plan détaillé, et termine toujours ta réponse : jamais de phrase coupée.`;
    const text = await claude(apiKey, model, sys, msgs, 1800);
    const cost = await recordUsage(uid, 'chat', model);
    return { text, costUsd: cost };
  }
  throw new HttpsError('invalid-argument', 'mode inconnu');
}


/* ---------- Coach permanent : fonctions planifiées ----------
   weeklyReview : dimanche 19 h (Paris) — bilan de la semaine pour chaque athlète actif, relance sinon, cycle suivant en fin de mésocycle.
   dailyNudge   : chaque jour 18 h — relance après 3 jours sans séance (sans IA, pas de coût). */
const WEEK_SCHEMA = {
  type: 'object', required: ['title', 'verdict', 'highlights', 'nextWeek', 'alerts'],
  properties: {
    title: { type: 'string', description: 'Ex. « Bilan S2 · 8–14 septembre »' },
    verdict: { type: 'string', maxLength: 320, description: 'Bilan de la semaine en 2 à 3 phrases : assiduité (séances faites vs prévues), tendance des charges, cohérence RIR, poids de corps si suivi.' },
    highlights: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string', description: 'Ex. « Séances », « Progression pendulum », « Poids moyen »' }, value: { type: 'string', description: 'Chiffre ou fait court : « 3/4 », « 120 → 125 kg », « 69,4 kg (−0,3) »' }, status: { type: 'string', enum: ['ok', 'up', 'hold', 'warn'] } } }, description: '3 à 5 repères chiffrés de la semaine.' },
    nextWeek: { type: 'string', maxLength: 400, description: 'Consigne pour la semaine qui vient, en 2 à 4 phrases : intention (RIR, volume), un ou deux points concrets par séance clé.' },
    alerts: { type: 'array', items: { type: 'string' }, description: 'Signaux à ne pas ignorer : fatigue, douleur notée, écart de récupération, séance manquée récurrente. Vide si rien.' }
  }
};
// Push via le service Expo (gratuit, pas de FCM/APNs à configurer) : jetons enregistrés par l'app native dans meta/push.
async function sendPush(uid, title, body, data) {
  try {
    const snap = await db.collection('users').doc(uid).collection('meta').doc('push').get();
    const tokens = (snap.exists && Array.isArray(snap.data().expo)) ? snap.data().expo.filter(t => /^ExponentPushToken\[/.test(t)) : [];
    if (!tokens.length) return 0;
    const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(tokens.map(to => ({ to, title, body, sound: 'default', data: data || {}, channelId: 'rituel' }))) });
    const j = await r.json().catch(() => ({}));
    const bad = tokens.filter((t, i) => j.data && j.data[i] && j.data[i].status === 'error' && /DeviceNotRegistered/.test(JSON.stringify(j.data[i])));
    if (bad.length) await snap.ref.set({ expo: admin.firestore.FieldValue.arrayRemove(...bad) }, { merge: true });
    return tokens.length - bad.length;
  } catch (e) { console.warn('push', uid, e.message || e); return 0; }
}
function parisISO(d) { return (d || new Date()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return parisISO(d); }
// Une séance est considérée faite si elle a été terminée, ou si elle a des séries enregistrées un jour passé (jamais clôturée).
function isDone(l, today) { return !!(l && (l.done || (Object.keys(l.sets || {}).length && l.date < (today || parisISO())))); }
async function activeUsers() {
  const refs = await db.collection('users').listDocuments();
  const out = [];
  for (const ref of refs) { const pg = await ref.collection('meta').doc('program').get(); if (pg.exists && pg.data().sessions) out.push(ref.id); }
  return out;
}
async function weekIndexDone(uid, prog) {
  // semaines calendaires (depuis le départ du programme) contenant au moins une séance validée
  const start = (prog.weeks && prog.weeks[0] && prog.weeks[0].from) || isoDaysAgo(28);
  const logs = await db.collection('users').doc(uid).collection('logs').where('date', '>=', start).get();
  const weeks = new Set();
  logs.docs.map(d => d.data()).filter(l => isDone(l)).forEach(l => { const days = Math.round((new Date(l.date + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000); weeks.add(Math.floor(days / 7)); });
  return weeks.size;
}
// Veille du service : toutes les heures, on vérifie que la clé API répond. État dans system/health (lu par le tableau de bord
// administrateur) et notification aux administrateurs dès qu'elle tombe, puis quand elle revient.
exports.healthCheck = onSchedule({ schedule: '7 * * * *', timeZone: 'Europe/Paris', region: 'europe-west1', secrets: [ANTHROPIC_API_KEY] }, async () => {
  const ref = db.collection('system').doc('health'); const prev = (await ref.get()).data() || {};
  let ok = false, status = 0, msg = '';
  try {
    const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
    if (!/^sk-ant-/.test(apiKey)) { msg = 'clé absente ou mal formée'; }
    else { const r = await fetch(API_BASE + '/v1/models?limit=1', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }); status = r.status; ok = r.ok; if (!ok) msg = r.status === 401 ? 'clé refusée (401) : révoquée ou invalide' : 'réponse ' + r.status; }
  } catch (e) { msg = String(e && e.message || e); }
  await ref.set({ ok, status, msg, at: Date.now(), since: ok === !!prev.ok ? (prev.since || Date.now()) : Date.now() });
  if (ok !== !!prev.ok || (!ok && Date.now() - (prev.notifiedAt || 0) > 6 * 3600000)) {
    for (const email of ADMIN_EMAILS) { try { const u = await admin.auth().getUserByEmail(email); await sendPush(u.uid, ok ? 'Kai est de retour' : 'Kai est hors service', ok ? 'La clé API répond à nouveau.' : 'Clé API : ' + msg + '. Régénère-la et enregistre-la (functions:secrets:set).', { tab: 'reglages' }); } catch (e) {} }
    await ref.set({ notifiedAt: Date.now() }, { merge: true });
  }
  console.log(`[health] ${ok ? 'ok' : 'KO'} ${status} ${msg}`);
});

exports.weeklyReview = onSchedule({ schedule: '0 19 * * 0', timeZone: 'Europe/Paris', region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async () => {
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '');
  const model = await resolveModel(apiKey, MODEL.value());
  const since = isoDaysAgo(7); const weekId = 'week-' + parisISO();
  for (const uid of await activeUsers()) {
    try {
      const meta = await loadMeta(uid); const prog = meta.program; if (!prog) continue;
      const coachRef = db.collection('users').doc(uid).collection('coach');
      if ((await coachRef.doc(weekId).get()).exists) continue;
      const logs = await db.collection('users').doc(uid).collection('logs').where('date', '>=', since).get();
      const done = logs.docs.map(d => d.data()).filter(l => isDone(l));
      if (!done.length) {
        await coachRef.doc(weekId).set({ type: 'nudge', title: 'Semaine sans séance', analysis: 'Aucune séance validée cette semaine. Le cycle n\'avance pas tant que tu ne reprends pas : il t\'attend à la semaine où tu l\'as laissé. Reprends par la séance du jour, à charges égales, sans chercher à rattraper.', createdAt: Date.now(), applied: true, model: 'none', costUsd: 0 });
        await sendPush(uid, 'Semaine sans séance', 'Le cycle t\'attend où tu l\'as laissé. On reprend demain ?', { tab: 'coach' });
        continue;
      }
      const weeksDone = await weekIndexDone(uid, prog);
      const context = await loadContext(uid, prog, 12);
      const SYSTEM = systemFor(meta.profile, prog);
      const programSummary = prog.sessions.map(s => `${s.name} (${s.id}) : ` + s.exercises.map(e => `${e.id} ${e.name}`).join(' ; ')).join('\n');
      const user = `Programme :\n${programSummary}\n\n${context}\n\n## Bilan de la semaine écoulée (${since} → aujourd'hui)\nSéances validées cette semaine : ${done.length} sur ${prog.sessions.length} prévues. Semaines effectuées depuis le début du cycle : ${weeksDone} sur ${(prog.weeks || []).length || 4}.\nRédige le bilan hebdomadaire : conclusions seulement, chiffres à l'appui, pas de généralités. ${weeksDone >= ((prog.weeks || []).length || 4) ? 'Le mésocycle est terminé : dis-le clairement et annonce que le cycle suivant peut être généré.' : ''}`;
      const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], WEEK_SCHEMA, 1800);
      const cost = await recordUsage(uid, 'analyse', model);
      const cycleEnd = weeksDone >= ((prog.weeks || []).length || 4);
      await coachRef.doc(weekId).set({ type: cycleEnd ? 'cycleEnd' : 'bilan', title: parsed.title, analysis: parsed.verdict, highlights: parsed.highlights || [], nextWeek: parsed.nextWeek || '', alerts: parsed.alerts || [], createdAt: Date.now(), applied: true, model, costUsd: cost });
      await sendPush(uid, cycleEnd ? 'Cycle terminé' : (parsed.title || 'Bilan de la semaine'), String(parsed.verdict || '').slice(0, 140), { tab: 'coach' });
    } catch (e) { console.error('weeklyReview', uid, e.message || e); }
  }
});
exports.dailyNudge = onSchedule({ schedule: '0 18 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
  const cutoff = isoDaysAgo(3);
  for (const uid of await activeUsers()) {
    try {
      const base = db.collection('users').doc(uid);
      const last = await base.collection('logs').where('date', '>=', cutoff).get();
      // Série en jeu : jour planifié, séance non faite à 18 h, série d'au moins 2 jours → relance ciblée (une par jour).
      const today = parisISO(); const pg = await base.collection('meta').doc('program').get();
      const days = new Set(((pg.exists && pg.data().sessions) || []).map(x => x.day));
      const dow = new Date(today + 'T12:00:00Z').getUTCDay();
      if (days.has(dow) && !last.docs.some(d => d.data().date === today && isDone(d.data()))) {
        const hist = await base.collection('logs').where('date', '>=', isoDaysAgo(60)).get(); const done = new Set(hist.docs.filter(d => isDone(d.data())).map(d => d.data().date));
        let streak = 0, d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
        for (let i = 0; i < 60; i++) { const iso = d.toISOString().slice(0, 10); if (done.has(iso) || !days.has(d.getUTCDay())) streak++; else break; d.setUTCDate(d.getUTCDate() - 1); }
        if (streak >= 2) { await sendPush(uid, `Ta série de ${streak} jours est en jeu`, 'La séance du jour n\'est pas encore faite. Même courte, elle compte.', { tab: 'seance' }); continue; }
      }
      if (last.docs.some(d => d.data().done || Object.keys(d.data().sets || {}).length)) continue;
      const recent = await base.collection('coach').where('createdAt', '>=', Date.now() - 3 * 86400000).get();
      if (recent.docs.some(d => d.data().type === 'nudge')) continue;
      const id = 'nudge-' + parisISO();
      await base.collection('coach').doc(id).set({ type: 'nudge', title: 'Trois jours sans séance', analysis: 'Trois jours sans séance validée. Rien de grave si c\'est une garde ou une récupération choisie ; si c\'est un décrochage, reprends aujourd\'hui par la séance prévue, mêmes charges que la dernière fois, et note comment tu te sens. Le coach ajustera.', createdAt: Date.now(), applied: true, model: 'none', costUsd: 0 });
      await sendPush(uid, 'Trois jours sans séance', 'La séance du jour t\'attend. Mêmes charges que la dernière fois.', { tab: 'seance' });
    } catch (e) { console.error('dailyNudge', uid, e.message || e); }
  }
});
