/* Rituel — fonction Coach.
   Porte la clé Anthropic côté serveur, lit le journal de l'utilisateur dans Firestore,
   appelle Claude et enregistre l'analyse. Deux modes : "analyse" (après une séance)
   et "chat" (question libre). L'utilisateur doit être authentifié. */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

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


// Fiche structurée issue de l'entretien guidé : jours nommés, zones à ménager avec sévérité, refus et préférences. Lignes ajoutées au profil.
const DAY_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const ZONE_FR = { epaule: 'épaule', coude: 'coude', poignet: 'poignet', dos: 'dos et lombaires', hanche: 'hanche', genou: 'genou', cheville: 'cheville', cou: 'cou et cervicales' };
const REFUSE_FR = { cardio: 'aucun cardio long (finishers de 5 à 8 minutes au maximum)', burpees: 'aucun burpee', '1h': 'aucune séance au-delà de 60 minutes, échauffement compris', nobar: 'aucune barre olympique, haltères et machines seulement', nomachine: 'aucune machine guidée, barre et haltères seulement', nofail: 'aucune série à l\'échec, RIR 1 minimum même en intensification', nobody: 'aucune remarque sur le physique ou l\'apparence', nonotif: 'pas de relance' };
const LIKE_FR = { lourd: 'aime les charges lourdes : garde un exercice de force lourde par séance', circuits: 'aime les circuits : un circuit ou finisher par séance', tractions: 'aime les tractions : présentes à chaque séance de tirage', bras: 'aime l\'isolation des bras : la prévoir en fin de séance', mobilite: 'aime la mobilité : un bloc de mobilité par séance', explosif: 'aime l\'explosif : un mouvement explosif en début de séance', court: 'aime les séances courtes et intenses : densité élevée, repos courts' };
function specLines(p) {
  const s = p.spec; if (!s) return '';
  const out = [];
  if (Array.isArray(s.daysList) && s.daysList.length) out.push(`Jours d'entraînement fixés : ${s.daysList.map(k => DAY_FR[k]).join(', ')} (une séance par jour, "day" = 1 lundi … 6 samedi, 0 dimanche).`);
  if (Array.isArray(s.zones) && s.zones.length) out.push('Zones à ménager : ' + s.zones.map(z => `${ZONE_FR[z.zone] || z.zone} ${z.sev === 'opere' ? 'opéré(e) : exclusion stricte de tout exercice qui le sollicite directement, remplacement obligatoire' : z.sev === 'douleur' ? 'douloureux(se) : exclusion des exercices à risque, amplitude réduite ailleurs' : 'fragile : pas de charge maximale ni d\'amplitude extrême'}${z.note ? ' (' + z.note + ')' : ''}`).join(' ; ') + '.');
  if (Array.isArray(s.refuse) && s.refuse.length) out.push('Refus non négociables : ' + s.refuse.map(r => REFUSE_FR[r] || r).join(' ; ') + '.');
  if (Array.isArray(s.likes) && s.likes.length) out.push('Préférences : ' + s.likes.map(l => LIKE_FR[l] || l).join(' ; ') + '.');
  if (s.goalMain) out.push(`Objectif principal « ${s.goalMain} »${s.goalSecond ? ', secondaire « ' + s.goalSecond + ' »' : ''} : le principal gagne tous les arbitrages.`);
  return out.length ? '\n' + out.join('\n') : '';
}
function systemFor(profile, program) {
  const p = profile || {};
  const GOAL_LABELS = { force: 'force maximale', masse: 'prise de muscle', seche: 'sécher et se dessiner', endurance: 'endurance musculaire', puissance: 'puissance et vitesse', tractions: 'nombre de tractions', jambes: 'rattraper les jambes', bras: 'bras et pectoraux', sante: 'santé, mobilité, dos', perf: 'performance sportive ou opérationnelle', perte: 'perdre du poids (gras) en gardant le muscle', fessiers: 'fessiers et bas du corps (galbe, force)', silhouette: 'tonifier, silhouette harmonieuse', cardio: 'souffle et condition physique', equilibre: 'équilibre et poirier (handstand)', calisthenie: 'figures de force au poids du corps (levers, L-sit, muscle-up)', souplesse: 'souplesse et étirements' };
  const goals = (p.goals || []).map(g => GOAL_LABELS[g] || g).join(', ');
  const goalRules = { perte: 'Objectif perte de poids : le programme reste un entraînement de force (le muscle protège le métabolisme), avec des circuits ou finishers métaboliques courts, des pas quotidiens et un déficit calorique modéré expliqué dans le cycle ; tu suis la tendance du poids sur 2 à 4 semaines, jamais une pesée isolée, et tu ne fais jamais de remarque sur l\'apparence.', fessiers: 'Objectif fessiers : hip thrust, fentes, soulevé de terre roumain, abduction, et volume hebdomadaire élevé sur les fessiers (12 à 20 séries), le reste du corps en entretien équilibré.', silhouette: 'Objectif silhouette : corps entier équilibré, hypertrophie modérée, amplitude complète, pas de spécialisation extrême.', cardio: 'Objectif souffle : deux blocs cardio par semaine (intervalles courts et zone 2) intégrés au plan, en plus de la force.', sante: 'Objectif santé : amplitudes contrôlées, pas de charge maximale, travail postural et mobilité intégrés, progression lente.' };
  const rules = (p.goals || []).map(g => goalRules[g]).filter(Boolean).join(' ');
  const prog = program ? `Cycle en cours : ${program.cycleName || 'programme personnalisé'}. Semaines : ${(program.weeks || []).map(w => `${w.label} (${w.from} → ${w.to}) : ${w.rirNote || ''}`).join(' | ')}. Règle de progression : charge +2,5 % quand le haut de fourchette de reps est atteint sur toutes les séries au RIR prescrit, sinon même charge +1 rep.` : 'Aucun programme encore.';
  return `Tu es le préparateur physique personnel de l'utilisateur : 15 ans de terrain en force athlétique, hypertrophie, préparation physique et réathlétisation. Tu le suis individuellement.

Profil : ${p.name || 'athlète'}, ${p.sex === 'f' ? 'femme' : 'homme'}, ${p.age || '?'} ans, ${p.height || '?'} cm, ${p.weight || '?'} kg. Niveau : ${p.level || 'non précisé'}. Objectifs : ${goals || 'non précisés'}${p.goalsText ? ' — ' + p.goalsText : ''}. ${p.days || '?'} séances/semaine, ${p.minutes || '?'} min par séance.
Matériel disponible : ${(p.gear || []).length ? p.gear.map(g => ({ salle: 'salle complète (machines guidées, barres, poulies)', halteres: 'haltères', barre: 'barre olympique et disques', kettlebell: 'kettlebells', elastiques: 'élastiques', traction: 'barre de traction', trx: 'TRX / sangles', corps: 'poids du corps uniquement', cardio: 'cardio' }[g] || g)).join(', ') : 'non précisé'}${p.equipment ? ' — ' + p.equipment : ''}. Règle absolue : ne prescris que des exercices réalisables avec ce matériel ; s'il n'y a pas de salle, aucune machine.
Autres pratiques à intégrer : ${p.sports || 'aucune'}${p.sports ? ' — organise le volume et la récupération autour de ces pratiques, ne les contredis pas.' : ''}
Contraintes : ${p.constraints || 'aucune déclarée'}.${specLines(p)}
Repères : ${p.experience || 'aucun déclaré'}.${p.refTest ? ` Test de référence suivi : ${p.refTest}${p.refGoal ? ' (objectif ' + p.refGoal + ')' : ''}.` : ''}
${rules ? rules + '\n' : ''}${prog}

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
const ILLUS_IDS = require('./illus.json'); const ILLUS_FR = require('./illus-labels.json');
const LIB = require('./library.js');
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true'; // functions/.env : ENFORCE_APP_CHECK=true une fois App Check activé côté client
const PARCS = require('./parcs.json'); // machines exactes par enseigne (marque + modèle), affichées quand l'athlète a nommé son enseigne
// fiches dessinées avec leur libellé français (type de machine, marque indifférente) // fiches dessinées (personnage unique) : à privilégier quand le geste et le matériel sont identiques
async function mapDemos(apiKey, model, exercises) {
  const list = exercises.filter(e => e && e.id && e.name).map(e => `${e.id} | ${e.name} | ${e.machine || ''} | ${e.target || ''}`);
  if (!list.length) return {};
  const user = `Pour chaque exercice ci-dessous, choisis dans la liste de fiches l'identifiant qui montre exactement le même mouvement : même geste ET même groupe musculaire cible, de préférence le même matériel (machine, barre, haltère, câble). Une fiche d'un autre groupe musculaire ou d'un geste différent est une erreur grave : dans le doute, renvoie "" plutôt qu'une approximation. Un pendulum squat n'est pas un hack squat, un belt squat n'est pas une presse, une machine convergente n'est pas une poulie : si la fiche exacte n'existe pas, renvoie "". Ne réponds qu'avec les identifiants de la liste.\n\nExercices (id | nom | matériel | cible) :\n${list.join('\n')}\n\nFiches illustrées (identifiant — ce qu'elle montre), à privilégier : la marque n'a pas d'importance, le TYPE de machine et le geste doivent être identiques :\n${ILLUS_IDS.map(i => i + ' — ' + (ILLUS_FR[i] || i)).join('\n')}\n\nAutres fiches (photos) :\n${DEMO_IDS.filter(i => !ILLUS_IDS.includes(i)).join(', ')}`;
  try {
    const parsed = await claudeJSON(apiKey, model, 'Tu associes des exercices de musculation à des fiches de démonstration. Réponds uniquement via l\'outil.', [{ role: 'user', content: user }], DEMO_SCHEMA, 3000);
    const out = {}; (parsed.map || []).forEach(m => { if (m && m.exId && (DEMO_SET.has(String(m.demoId || '')) || ILLUS_IDS.includes(String(m.demoId || '')))) out[String(m.exId)] = String(m.demoId); });
    return out;
  } catch (e) { return {}; }
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['title', 'headline', 'tone', 'takeaways', 'lesson', 'verdict', 'exercises', 'adjustments', 'nextFocus'],
  properties: {
    title: { type: 'string', description: 'Ex. « Push A · S1 »' },
    headline: { type: 'string', maxLength: 70, description: 'Le verdict en une ligne de 70 caractères max, comme un titre : ex. « Séance solide, deux charges à monter », « Trop tôt pour aller à l\'échec », « Fatigue visible, on allège ».' },
    tone: { type: 'string', enum: ['good', 'ok', 'warn'], description: 'good = progression nette, ok = conforme, warn = signal (fatigue, douleur, incohérence, régression).' },
    takeaways: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string', maxLength: 130 }, description: '2 à 3 phrases courtes et autonomes, une idée chacune, chacune appuyée sur un chiffre de la séance : le fait, puis sa conséquence. Pas de connecteurs, pas de préambule.' },
    lesson: { type: 'string', maxLength: 240, description: 'Ce que l\'athlète apprend grâce à cette séance : un principe d\'entraînement illustré par SES chiffres (ex. pourquoi on garde 2 reps en réserve en S2, pourquoi le bas de fourchette ne justifie pas une hausse, ce que dit un RIR 0 sur une isolation). Une ou deux phrases, pédagogique mais pas condescendant.' },
    verdict: { type: 'string', maxLength: 700, description: 'Lecture de coach en 3 à 5 phrases (700 caractères max), adressée à l\'athlète en « tu » : ce que les chiffres disent de la séance par rapport à la précédente et à l\'intention de la semaine (RIR visé), le fait marquant (une progression nette, une incohérence, un signal de fatigue ou de douleur), et la décision que tu prends pour la suite. Phrases complètes, précises, chiffrées. Pas de télégraphique, pas de liste, pas de raisonnement à voix haute ni d\'auto-correction.' },
    cue: { type: 'string', maxLength: 220, description: 'Un seul point technique concret pour la prochaine séance de ce type (exécution, tempo, amplitude, respiration, placement), choisi d\'après les données ou la note de l\'athlète. Une phrase.' },
    questions: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 160 }, description: 'Ce que tu dois faire confirmer à l\'athlète avant de trancher : une charge aberrante (ex. 14 kg puis 30 kg sur le même exercice : unité, machine ou erreur de saisie ?), une douleur mentionnée, une série manquante. Vide si rien ne l\'exige. Formulé en question directe.' },
    exercises: { type: 'array', description: 'Une entrée par exercice réalisé, dans l\'ordre de la séance.', items: { type: 'object', required: ['exId', 'name', 'done', 'read'], properties: { exId: { type: 'string' }, name: { type: 'string' }, done: { type: 'string', description: 'Réalisé, compact : « 4×5 à 80 kg · RIR 3/2/1/4 »' }, read: { type: 'string', description: 'Lecture en une ou deux phrases, chiffrée : où on se situe dans la fourchette, cohérence charge/RIR avec la dernière référence, ce qu\'on en déduit et, si utile, le correctif technique.' }, status: { type: 'string', enum: ['ok', 'up', 'hold', 'warn'], description: 'ok = conforme ; up = progression à faire ; hold = même charge, viser plus de reps ; warn = incohérence, douleur ou charge à revoir' } } } },
    adjustments: { type: 'array', items: { type: 'object', required: ['exId', 'change', 'reason'], properties: { exId: { type: 'string' }, name: { type: 'string' }, change: { type: 'string', description: 'Prescription concrète pour la prochaine fois, ex. « 4 × 5-6 à 82,5 kg (RIR 3) »' }, reason: { type: 'string', description: 'Justification en une phrase.' }, load: { type: 'number' } } } },
    nextFocus: { type: 'string', description: 'Une phrase : la priorité de la prochaine séance de ce type.' }
  }
};

async function claude(apiKey, model, system, messages, maxTokens = 1500, timeoutMs = 210000) {
  // Délai borné : un appel qui traîne ne doit jamais bloquer l'utilisateur jusqu'à la fin de la fonction.
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(API_BASE + '/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }), signal: ctl.signal
    });
  } catch (e) { clearTimeout(timer); throw new HttpsError('deadline-exceeded', ctl.signal.aborted ? 'Le coach a mis trop de temps à répondre.' : 'Réseau indisponible vers le coach : ' + String(e && e.message || e).slice(0, 120)); }
  clearTimeout(timer);
  if (!r.ok) { const t = await r.text(); throw new HttpsError('internal', `Anthropic ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json(); LAST_USAGE = j.usage || null;
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

// (schéma de programme libre supprimé : le programme est construit par le moteur et la bibliothèque, le coach ne rédige que les textes)

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
async function checkQuota(uid, mode, plan, force) { // force : on compte l'usage mais on ne bloque jamais
  const month = parisISO().slice(0, 7); const limits = PLANS[plan] || PLANS.free;
  const ref = db.collection('users').doc(uid).collection('meta').doc('usage');
  const label = { program: 'programmes', analyse: 'analyses', chat: 'questions', substitute: 'séances sans salle', demo: 'fiches' }[mode] || mode;
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {};
    const cur = d.month === month ? d : { month, program: 0, analyse: 0, chat: 0, substitute: 0, demo: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    cur.plan = plan; cur.limits = limits;
    if (!force && (cur[mode] || 0) >= limits[mode]) throw new HttpsError('resource-exhausted', plan === 'free' ? `QUOTA_FREE:${label}:${limits[mode]}` : `Quota mensuel atteint : ${limits[mode]} ${label}. Il se renouvelle le 1er du mois.`);
    cur[mode] = (cur[mode] || 0) + 1; cur.updatedAt = Date.now();
    tx.set(ref, cur); return cur;
  });
}

// Tableau de bord administrateur : comptes, programmes, séances et erreurs des 7 derniers jours, coût IA du mois.
exports.adminStats = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const since = isoDaysAgo(7); const sinceMs = Date.now() - 7 * 86400000; const month = parisISO().slice(0, 7);
  const users = await db.collection('users').listDocuments();
  let withProgram = 0, sessions7 = 0, costMonth = 0, calls = 0, premium = 0; const perUser = [];
  const M = { accounts: 0, activated: 0, c7: 0, r7: 0, c30: 0, r30: 0 };
  for (const u of users) {
    const [pg, us, pr, bl, lg] = await Promise.all([u.collection('meta').doc('program').get(), u.collection('meta').doc('usage').get(), u.collection('meta').doc('profile').get(), u.collection('meta').doc('billing').get(), u.collection('logs').where('date', '>=', since).get()]);
    const hasProg = pg.exists && !!pg.data().sessions; if (hasProg) withProgram++;
    const usage = us.exists ? us.data() : {}; if (usage.month === month) { costMonth += usage.costUsd || 0; calls += (usage.analyse || 0) + (usage.chat || 0) + (usage.program || 0) + (usage.substitute || 0) + (usage.demo || 0); }
    const n7 = lg.docs.filter(d => isDone(d.data())).length; sessions7 += n7;
    const plan = bl.exists && bl.data().plan === 'premium' && (!bl.data().expiresAt || bl.data().expiresAt > Date.now()) ? 'premium' : 'free'; if (plan === 'premium') premium++;
    let email = '', disabled = false, created = null; try { const au = await admin.auth().getUser(u.id); email = au.email || ''; disabled = !!au.disabled; created = au.metadata && au.metadata.creationTime ? new Date(au.metadata.creationTime).getTime() : null; } catch (e) {}
    const bd = bl.exists ? bl.data() : {};
    // Mesure : activation (au moins une séance terminée), rétention J7 / J30 (activité après 7 / 30 jours, comptes assez anciens, hors admin)
    if (created && !ADMIN_EMAILS.includes(email.toLowerCase())) { const age = Date.now() - created; const lastAct = Math.max(usage.updatedAt || 0, ...lg.docs.map(d => new Date(d.data().date + 'T12:00:00Z').getTime())); const anyLog = (await u.collection('logs').limit(1).get()).size > 0;
      M.accounts++; if (anyLog) M.activated++; if (age > 7 * 86400000) { M.c7++; if (lastAct >= created + 7 * 86400000) M.r7++; } if (age > 30 * 86400000) { M.c30++; if (lastAct >= created + 30 * 86400000) M.r30++; } }
    perUser.push({ uid: u.id.slice(0, 6), uidFull: u.id, email, disabled, created, lastAt: usage.updatedAt || null, admin: ADMIN_EMAILS.includes(email.toLowerCase()), name: pr.exists ? (pr.data().name || '') : '', program: hasProg, generic: hasProg && !(pg.data() || {}).generatedAt, checks: hasProg ? ((pg.data() || {}).checks || null) : null, sessions7: n7, plan: ADMIN_EMAILS.includes(email.toLowerCase()) ? 'premium' : plan, source: bd.source || '', store: bd.store || '', expiresAt: bd.expiresAt || null, cost: usage.month === month ? Math.round((usage.costUsd || 0) * 100) / 100 : 0, lastMode: usage.lastMode || '' });
  }
  const errs = await db.collection('errors').where('t', '>=', sinceMs).orderBy('t', 'desc').limit(100).get();
  const errors = errs.docs.map(d => d.data()).map(e => ({ t: e.t, uid: String(e.uid || '').slice(0, 6), src: e.src, msg: String(e.msg || '').slice(0, 160), ver: e.ver }));
  const health = (await db.collection('system').doc('health').get()).data() || null;
  const bench = (await db.collection('system').doc('bench').get()).data() || null;
  return { metrics: M, bench, users: users.length, withProgram, premium, sessions7, calls, costMonth: Math.round(costMonth * 100) / 100, errors, health, perUser: perUser.sort((a, b) => b.sessions7 - a.sessions7).slice(0, 50) };
});

// Forfait posé à la main par l'administrateur (Premium offert pour N mois, ou retiré). Un abonnement payant repasse par le webhook.
exports.adminSetPlan = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const uid = String((req.data || {}).uid || ''); const plan = (req.data || {}).plan === 'premium' ? 'premium' : 'free'; const months = Math.max(0, Math.min(36, parseInt((req.data || {}).months) || 0));
  if (!uid) throw new HttpsError('invalid-argument', 'uid manquant');
  const ref = db.collection('users').doc(uid).collection('meta').doc('billing');
  if (plan === 'premium') { const exp = new Date(); exp.setMonth(exp.getMonth() + (months || 1)); await ref.set({ plan: 'premium', source: 'admin', store: '', expiresAt: exp.getTime(), since: Date.now(), updatedAt: Date.now() }, { merge: true }); console.log(`[billing] admin premium uid=${uid.slice(0, 6)} ${months || 1} mois`); return { plan, expiresAt: exp.getTime() }; }
  await ref.set({ plan: 'free', source: 'admin', expiresAt: Date.now(), updatedAt: Date.now() }, { merge: true }); console.log(`[billing] admin free uid=${uid.slice(0, 6)}`); return { plan };
});

// Actions d'administration sur un compte : remise à zéro des compteurs du mois, notification, blocage, suppression.
// Banc d'essai de personnalisation, à la demande (coûte de l'API) : des profils synthétiques variés, génération réelle, contrôle de conformité,
// et vérification que deux profils différents ne reçoivent pas le même programme. Rien n'est enregistré sur un compte.
const BENCH_PROFILES = [
  { name: 'Claire', sex: 'f', age: 34, height: 165, weight: 62, level: 'debutant', goals: ['perte', 'silhouette'], days: 3, minutes: 45, gear: ['halteres', 'elastiques'], constraints: '' },
  { name: 'Marc', sex: 'm', age: 55, height: 178, weight: 88, level: 'intermediaire', goals: ['sante', 'force'], days: 3, minutes: 60, gear: ['salle'], constraints: 'dos fragile, hernie discale L5 en 2022' },
  { name: 'Inès', sex: 'f', age: 27, height: 170, weight: 58, level: 'confirme', goals: ['fessiers', 'masse'], days: 4, minutes: 60, gear: ['salle'], constraints: '' },
  { name: 'Yanis', sex: 'm', age: 19, height: 182, weight: 70, level: 'debutant', goals: ['masse', 'bras'], days: 4, minutes: 75, gear: ['salle'], constraints: '' },
  { name: 'Sophie', sex: 'f', age: 46, height: 160, weight: 70, level: 'debutant', goals: ['perte', 'cardio'], days: 2, minutes: 40, gear: ['corps'], constraints: 'genou droit opéré, pas d\'impact' },
  { name: 'Karim', sex: 'm', age: 38, height: 175, weight: 80, level: 'avance', goals: ['force', 'puissance'], days: 5, minutes: 90, gear: ['salle', 'barre'], constraints: '', sports: 'rugby, deux entraînements par semaine' },
  { name: 'Léa', sex: 'f', age: 31, height: 168, weight: 64, level: 'intermediaire', goals: ['tractions', 'endurance'], days: 4, minutes: 50, gear: ['traction', 'halteres', 'kettlebell'], constraints: 'épaule gauche sensible' },
  { name: 'Paul', sex: 'm', age: 62, height: 172, weight: 76, level: 'debutant', goals: ['sante'], days: 2, minutes: 45, gear: ['halteres'], constraints: 'arthrose des genoux, hypertension' },
  { name: 'Nadia', sex: 'f', age: 41, height: 174, weight: 68, level: 'confirme', goals: ['perf', 'jambes'], days: 5, minutes: 70, gear: ['salle'], constraints: '', sports: 'trail, 60 km par semaine' },
  { name: 'Tom', sex: 'm', age: 24, height: 190, weight: 95, level: 'intermediaire', goals: ['seche', 'bras'], days: 6, minutes: 60, gear: ['salle'], constraints: 'coude droit (épicondylite)' },
  { name: 'Amel', sex: 'f', age: 52, height: 158, weight: 75, level: 'debutant', goals: ['perte', 'sante'], days: 3, minutes: 30, gear: ['elastiques', 'corps'], constraints: 'reprise après 10 ans sans sport' },
  { name: 'Hugo', sex: 'm', age: 35, height: 180, weight: 72, level: 'confirme', goals: ['tractions', 'endurance', 'puissance'], days: 6, minutes: 60, gear: ['salle', 'traction'], constraints: '', sports: 'pompier, gardes de 24 h' }
];
exports.adminEval = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
  const model = await resolveModel(apiKey, MODEL.value());
  const only = Array.isArray(req.data && req.data.names) ? req.data.names : null;
  const profiles = BENCH_PROFILES.filter(p => !only || only.includes(p.name));
  const results = await Promise.all(profiles.map(async p => {
    const t0 = Date.now();
    try {
      const prog = await buildProgram(p, apiKey, model);
      const sessions = prog.sessions.map(s => `${s.name} (${s.exercises.length})`);
      const personal = /^\s*(#+\s*)?Pour\s+/i.test(prog.rationale || '') || (prog.rationale || '').includes(p.name);
      return { name: p.name, ok: !prog.checks.errors.length, errors: prog.checks.errors, warnings: prog.checks.warnings, attempts: prog.checks.attempts, sessions, personal, signature: checkProgram(prog, p).signature, ms: Date.now() - t0, weeks: prog.weeks.length, cycleName: prog.cycleName };
    } catch (e) { return { name: p.name, ok: false, errors: [String(e && e.message || e)], warnings: [], sessions: [], ms: Date.now() - t0 }; }
  }));
  // distinctivité : deux profils ne doivent pas partager plus de la moitié de leurs exercices
  const sets = results.map(r => new Set(String(r.signature || '').split(/\|\|?/).filter(Boolean)));
  for (let i = 0; i < results.length; i++) { results[i].similar = []; for (let j = 0; j < results.length; j++) { if (i === j || !sets[i].size || !sets[j].size) continue; const inter = [...sets[i]].filter(x => sets[j].has(x)).length; const ratio = inter / Math.min(sets[i].size, sets[j].size); if (ratio > 0.5) results[i].similar.push(`${results[j].name} (${Math.round(ratio * 100)} %)`); } delete results[i].signature; }
  const summary = { total: results.length, ok: results.filter(r => r.ok && !r.similar.length).length, at: Date.now(), model };
  await db.collection('system').doc('bench').set({ summary, results });
  return { summary, results };
});
exports.adminAction = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  if (!req.auth || !ADMIN_EMAILS.includes(String(req.auth.token && req.auth.token.email || '').toLowerCase())) throw new HttpsError('permission-denied', 'Réservé à l\'administrateur.');
  const { uid, action, text } = req.data || {};
  if (action === 'purgeGeneric') { // tous les comptes : un programme sans date de génération est une copie du programme de base, il est retiré ; l'app propose alors la génération
    let n = 0; for (const u of await db.collection('users').listDocuments()) { try { const au = await admin.auth().getUser(u.id); if (ADMIN_EMAILS.includes(String(au.email || '').toLowerCase())) continue; } catch (e) {} const pg = await u.collection('meta').doc('program').get(); if (pg.exists && pg.data().sessions && !pg.data().generatedAt) { await u.collection('meta').doc('program').delete(); n++; } }
    return { ok: true, purged: n }; }
  if (action === 'reindexActive') { // construit l'index des comptes actifs à partir des programmes et des dernières séances
    let n = 0; for (const u of await db.collection('users').listDocuments()) { const pg = await u.collection('meta').doc('program').get(); if (!pg.exists || !pg.data().sessions) continue; const lg = await u.collection('logs').orderBy('date', 'desc').limit(1).get(); const lastDate = lg.empty ? null : lg.docs[0].data().date; const lastActiveAt = Math.max(pg.data().generatedAt || 0, lastDate ? Date.parse(lastDate + 'T12:00:00Z') : 0) || Date.now(); await touchActive(u.id, { hasProgram: true, pending: pg.data().degraded === 'coach', lastActiveAt }); n++; }
    return { ok: true, indexed: n }; }
  if (!uid || !action) throw new HttpsError('invalid-argument', 'uid et action requis');
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

exports.deleteAccount = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const uid = req.auth.uid;
  await db.recursiveDelete(db.collection('users').doc(uid));
  await admin.auth().deleteUser(uid);
  return { ok: true };
});

exports.coach = onCall({ region: 'europe-west1', enforceAppCheck: ENFORCE_APP_CHECK, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async (req) => {
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
// Contrôle de conformité d'un programme généré, déterministe et gratuit, appliqué à chaque génération pour tout le monde.
// Bloquant (régénération puis refus) : nombre de séances ≠ jours demandés, machine ou poulie sans salle, séance vide.
// Avertissement (conservé dans prog.checks) : contrainte déclarée possiblement sollicitée, séance très au-dessus du temps prévu.
const MACHINE_RE = /\b(machine|poulie|c[âa]ble|cable|presse|press machine|leg press|hack|smith|pec ?deck|lat ?pull|tirage|leverage|iso[- ]?lat|convergent|leg ?curl|leg ?ext(ension)?|standing calf|seated calf|chest press|technogym|panatta|gym ?80|hammer strength|eleiko|matrix|selection|sygnum|pure kraft)\b/i;
const CONSTRAINT_MAP = [[/genou/i, /squat|fente|lunge|leg ?ext|presse|hack|pendulum|saut|jump|pistol/i, 'genou'], [/[ée]paule/i, /d[ée]velopp[ée].*(militaire|[ée]paule|overhead)|shoulder press|[ée]l[ée]vation|dips?\b|traction|pull[- ]?up|arrach|snatch|upright/i, 'épaule'], [/\bdos\b|lombaire|hernie|sciatique/i, /soulev[ée] de terre|deadlift|good ?morning|rowing.*(barre|pench)|bent.?over|squat.*barre|back squat|hyperext/i, 'dos'], [/coude|[ée]picondyl/i, /curl|pushdown|extension.*triceps|skull|dips?\b/i, 'coude'], [/poignet/i, /pompes?|push[- ]?up|front squat|curl.*poignet|wrist/i, 'poignet'], [/hanche/i, /hip thrust|squat.*profond|fente|lunge|abduct|adduct/i, 'hanche'], [/cheville/i, /mollet|calf|saut|jump|fente|lunge/i, 'cheville']];
// « tirage élastique » ou « presse haltères au sol » ne sont pas des machines : le mot seul ne suffit pas.
const NOT_MACHINE_RE = /[ée]lastique|bande|haltère|haltere|kettlebell|poids du corps|serviette|au sol|sur banc|sac/i;
function isMachineEx(e) { if (e.exId && LIB.BY_ID[e.exId]) return (LIB.BY_ID[e.exId].tags || []).includes('machine'); const t = (e.name || '') + ' ' + (e.machine || ''); return MACHINE_RE.test(t) && !NOT_MACHINE_RE.test(t); }
function checkProgram(prog, profile) {
  const p = profile || {}; const gear = p.gear || []; const errors = [], warnings = [];
  if (!prog.sessions.length) errors.push('Aucune séance.');
  const wantDays = (p.spec && Array.isArray(p.spec.daysList) && p.spec.daysList.length) ? p.spec.daysList.length : Number(p.days);
  if (wantDays && prog.sessions.length !== wantDays && !(prog.engine && prog.engine.daysAdjusted === prog.sessions.length)) errors.push(`${prog.sessions.length} séance(s) pour ${wantDays} jour(s) demandé(s).`);
  if (gear.length && !gear.includes('salle')) {
    const bad = prog.sessions.flatMap(s => s.exercises).filter(isMachineEx).map(e => e.name);
    if (bad.length) errors.push('Machine ou poulie sans salle : ' + [...new Set(bad)].slice(0, 6).join(', ') + '.');
  }
  prog.sessions.forEach(s => { if (!s.exercises.length) errors.push(`${s.name} : aucun exercice.`); });
  const sp = p.spec || {};
  if (Array.isArray(sp.daysList) && sp.daysList.length && prog.sessions.length === sp.daysList.length) {
    const want = sp.daysList.map(k => (k + 1) % 7).sort().join(','); const got = prog.sessions.map(s => s.day).sort().join(',');
    if (want !== got) { const order = sp.daysList.slice().sort((a, b) => a - b); prog.sessions.sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7)).forEach((s, i) => { s.day = (order[i] + 1) % 7; s.dayName = DAY_FR[order[i]]; }); warnings.push('Jours replacés sur ceux de la fiche.'); }
  }
  (sp.zones || []).forEach(z => { const m = CONSTRAINT_MAP.find(([cre]) => cre.test(ZONE_FR[z.zone] || z.zone)); if (!m) return; const hit = prog.sessions.flatMap(s => s.exercises).filter(e => e.exId && LIB.BY_ID[e.exId] ? ((LIB.BY_ID[e.exId].zones || []).includes(z.zone) && !LIB.rehabOk(LIB.BY_ID[e.exId], sp.zones)) : m[1].test(e.name)).map(e => e.name); if (!hit.length) return; const msg = `${ZONE_FR[z.zone] || z.zone} (${z.sev}) : ${[...new Set(hit)].slice(0, 4).join(', ')}.`; if (z.sev === 'opere' || z.sev === 'douleur') errors.push('Zone à ménager sollicitée, ' + msg); else warnings.push('Zone fragile, vérifier ' + msg); });
  if ((sp.refuse || []).includes('nomachine')) { const bad = prog.sessions.flatMap(s => s.exercises).filter(isMachineEx).map(e => e.name); if (bad.length) errors.push('Refus des machines non respecté : ' + [...new Set(bad)].slice(0, 5).join(', ') + '.'); }
  if ((sp.refuse || []).includes('nobar')) { const bad = prog.sessions.flatMap(s => s.exercises).filter(e => e.exId && LIB.BY_ID[e.exId] ? (LIB.BY_ID[e.exId].tags || []).includes('barre') : (/\bbarre\b|barbell|olympique/i.test(e.name + ' ' + e.machine) && !/traction|pull|dip/i.test(e.name))).map(e => e.name); if (bad.length) errors.push('Refus de la barre non respecté : ' + [...new Set(bad)].slice(0, 5).join(', ') + '.'); }
  const c = String(p.constraints || '');
  if (c && !(sp.zones || []).length) CONSTRAINT_MAP.forEach(([cre, ere, label]) => { if (cre.test(c)) { const hit = prog.sessions.flatMap(s => s.exercises).filter(e => ere.test(e.name)).map(e => e.name); if (hit.length) warnings.push(`Contrainte « ${label} » : vérifier ${[...new Set(hit)].slice(0, 4).join(', ')}.`); } });
  if (p.minutes) prog.sessions.forEach(s => { const sets = s.exercises.reduce((a, e) => a + e.sets, 0); const est = Math.round(sets * ((s.exercises.reduce((a, e) => a + e.restSec, 0) / Math.max(1, s.exercises.length)) + 45) / 60) + 8; if (est > Number(p.minutes) * 1.35) warnings.push(`${s.name} : ≈${est} min estimées pour ${p.minutes} prévues.`); });
  const sig = prog.sessions.map(s => s.exercises.map(e => e.name.toLowerCase().replace(/[^a-zà-ÿ]/g, '')).join('|')).join('||');
  return { errors, warnings, signature: sig };
}
// Génération pure : profil → programme vérifié. Une seule reprise si le contrôle bloque, avec les défauts renvoyés au coach.

/* ---------- Moteur de structure (règles déterministes) ----------
   À partir de la fiche, décide ce qui ne doit pas dépendre d'un modèle de langage : nombre et jours des séances, répartition,
   schémas de mouvement par séance, séries, répétitions, RIR par semaine, repos, exclusions par zone à ménager, filtre matériel.
   Le coach choisit ensuite l'exercice exact pour chaque emplacement et rédige les textes. */
const PATTERNS = {
  squat: { label: 'squat (flexion de genou, charge sur les deux jambes)', muscle: 'quadriceps', gym: 'squat barre, hack squat, pendulum, presse, goblet', home: 'goblet squat, squat haltères, squat sauté léger', body: 'squat au poids du corps, pistol assisté', knee: true, hip: true },
  hinge: { label: 'charnière de hanche (soulevé de terre, roumain, good morning, hip thrust)', muscle: 'ischio-jambiers et fessiers', gym: 'soulevé de terre, roumain, trap bar, hip thrust machine', home: 'roumain haltères, hip thrust au sol, swing', body: 'pont fessier, good morning poids du corps', back: true },
  lunge: { label: 'unilatéral jambes (fente, step-up, split squat)', muscle: 'quadriceps et fessiers', gym: 'fente machine, split squat bulgare, step-up', home: 'fentes haltères, split squat', body: 'fentes, step-up', knee: true, hip: true, ankle: true },
  kneeflex: { label: 'flexion de genou isolée (leg curl)', muscle: 'ischio-jambiers', gym: 'leg curl assis ou couché', home: 'leg curl élastique, nordic assisté', body: 'nordic assisté, pont une jambe' },
  kneeext: { label: 'extension de genou isolée', muscle: 'quadriceps', gym: 'leg extension', home: 'sissy squat assisté, wall sit', body: 'wall sit, sissy squat', knee: true },
  calf: { label: 'mollets', muscle: 'mollets', gym: 'mollets debout ou assis machine', home: 'mollets sur marche avec haltère', body: 'mollets sur marche', ankle: true },
  hpush: { label: 'poussée horizontale (développé couché, incliné, pompes, presse pecs)', muscle: 'pectoraux et triceps', gym: 'développé couché ou incliné, presse convergente, dips pecs', home: 'développé haltères au sol ou banc, pompes', body: 'pompes, pompes déclinées, dips entre chaises', shoulder: false, wrist: true },
  vpush: { label: 'poussée verticale (développé épaules)', muscle: 'deltoïdes et triceps', gym: 'développé épaules machine ou haltères', home: 'développé haltères assis, pike push-up', body: 'pike push-up, handstand assisté', shoulder: true },
  hpull: { label: 'tirage horizontal (rowing)', muscle: 'dos (milieu) et biceps', gym: 'rowing machine, rowing poulie basse, rowing haltère', home: 'rowing haltère, rowing élastique', body: 'rowing inversé sous table', back: false },
  vpull: { label: 'tirage vertical (tractions, tirage poulie)', muscle: 'grand dorsal et biceps', gym: 'tractions, tirage vertical, tractions assistées', home: 'tractions, tirage élastique', body: 'tractions, tractions négatives', shoulder: true },
  latdelt: { label: 'élévations latérales', muscle: 'deltoïde moyen', gym: 'élévations latérales haltères, poulie ou machine', home: 'élévations latérales haltères ou élastique', body: 'élévations latérales bouteilles ou élastique', shoulder: true },
  reardelt: { label: 'arrière d\'épaule et coiffe (face pull, oiseau, rotation externe)', muscle: 'deltoïde postérieur et coiffe', gym: 'face pull, reverse fly machine, rotation externe poulie', home: 'oiseau haltères, face pull élastique', body: 'oiseau élastique, Y-T-W au sol' },
  biceps: { label: 'curl biceps', muscle: 'biceps', gym: 'curl machine, pupitre, incliné haltères, poulie', home: 'curl haltères, curl élastique', body: 'curl serviette, tractions supination', elbow: true },
  triceps: { label: 'extension triceps', muscle: 'triceps', gym: 'pushdown corde, extension overhead, dip machine', home: 'extension haltère nuque, kickback', body: 'pompes serrées, dips banc', elbow: true },
  core: { label: 'gainage et abdominaux', muscle: 'sangle abdominale', gym: 'crunch poulie, relevés de jambes suspendu, planche', home: 'planche, relevés de jambes, dead bug', body: 'planche, hollow hold, relevés de jambes' },
  carry: { label: 'port de charge (farmer walk)', muscle: 'corps entier, grip', gym: 'farmer walk haltères ou poignées', home: 'farmer walk haltères, kettlebells', body: 'marche avec sac lesté' },
  cond: { label: 'finisher métabolique court (5 à 8 minutes)', muscle: 'condition physique', gym: 'rameur, vélo, kettlebell swing, circuit', home: 'swing kettlebell, circuit haltères, corde', body: 'circuit poids du corps, montées de genoux' },
  // schémas complémentaires : jamais placés par défaut, utilisés quand l'athlète les demande (exercices voulus) ou pour des variantes
  olympic: { label: 'haltérophilie (clean, snatch, jerk, push press)', muscle: 'corps entier, puissance', gym: 'hang clean, push press, power snatch', home: 'clean haltères, push press haltères', body: 'burpee sauté' },
  plyo: { label: 'pliométrie (sauts, bonds)', muscle: 'puissance des jambes', gym: 'box jump, saut en longueur', home: 'squat sauté, fentes sautées', body: 'squat sauté, bonds' },
  mobility: { label: 'mobilité et étirement', muscle: 'amplitude articulaire', gym: 'étirements ciblés', home: 'étirements ciblés', body: 'étirements ciblés' },
  neck: { label: 'cou', muscle: 'fléchisseurs et extenseurs du cou', gym: 'machine à cou, harnais', home: 'isométrie contre la main', body: 'isométrie contre la main' },
  // disciplines (objectif secondaire) : équilibre, force au poids du corps, souplesse. Placées frais (équilibre, figures) ou en fin de séance (souplesse).
  balance: { label: 'équilibre et poirier (handstand)', muscle: 'épaules, gainage, proprioception', gym: 'poirier au mur, montées, corbeau', home: 'poirier au mur, corbeau', body: 'poirier au mur, corbeau, unipodal' },
  skill: { label: 'figure de force au poids du corps (levers, L-sit, muscle-up, pistol)', muscle: 'force relative, gainage', gym: 'front lever, L-sit, archer, muscle-up négatif', home: 'hollow, L-sit, tuck planche', body: 'hollow, L-sit, pistol' },
  flex: { label: 'souplesse et étirements (postures tenues)', muscle: 'amplitude articulaire', gym: 'pancake, écarts, pont, squat profond', home: 'pancake, écarts, pont', body: 'pancake, écarts, pont, pigeon' }
};
// Exclusions par zone à ménager : opéré ou douloureux → le schéma est retiré et remplacé ; fragile → charge et amplitude réduites (consigne).
const ZONE_RULES = { genou: ['squat', 'lunge', 'kneeext', 'plyo'], epaule: ['vpush', 'vpull', 'latdelt', 'olympic'], dos: ['hinge', 'olympic'], coude: ['biceps', 'triceps'], poignet: ['hpush', 'olympic'], hanche: ['lunge'], cheville: ['calf', 'lunge', 'plyo'], cou: ['vpush', 'neck'] };
const ZONE_SUBS = { balance: 'core', skill: 'core', flex: 'mobility', squat: 'hinge', lunge: 'kneeflex', kneeext: 'kneeflex', vpush: 'hpush', vpull: 'hpull', latdelt: 'reardelt', hinge: 'squat', biceps: 'hpull', triceps: 'hpush', hpush: 'hpull', calf: 'core', olympic: 'hinge', plyo: 'squat', neck: 'core', mobility: 'core' };
// Modèles de séance par nombre de jours : liste de schémas, le premier est l'exercice principal (★).
const SPLITS = {
  2: [['Corps entier A', ['squat', 'hpush', 'hpull', 'hinge', 'core']], ['Corps entier B', ['hinge', 'vpull', 'vpush', 'lunge', 'core']]],
  3: [['Corps entier A', ['squat', 'hpush', 'hpull', 'biceps', 'core']], ['Corps entier B', ['hinge', 'vpush', 'vpull', 'triceps', 'calf']], ['Corps entier C', ['lunge', 'hpush', 'hpull', 'latdelt', 'core']]],
  4: [['Bas du corps A', ['squat', 'hinge', 'kneeflex', 'calf', 'core']], ['Haut du corps A', ['hpush', 'vpull', 'vpush', 'hpull', 'biceps', 'triceps']], ['Bas du corps B', ['hinge', 'lunge', 'kneeext', 'calf', 'core']], ['Haut du corps B', ['vpull', 'hpush', 'hpull', 'latdelt', 'reardelt', 'triceps', 'biceps']]],
  5: [['Jambes', ['squat', 'hinge', 'kneeflex', 'kneeext', 'calf']], ['Poussée', ['hpush', 'vpush', 'hpush', 'latdelt', 'triceps']], ['Tirage', ['vpull', 'hpull', 'hpull', 'reardelt', 'biceps']], ['Jambes B', ['hinge', 'lunge', 'squat', 'calf', 'core']], ['Haut du corps', ['hpush', 'vpull', 'latdelt', 'biceps', 'triceps', 'core']]],
  6: [['Poussée A', ['hpush', 'vpush', 'hpush', 'latdelt', 'triceps']], ['Tirage A', ['vpull', 'hpull', 'hpull', 'reardelt', 'biceps']], ['Jambes A', ['squat', 'hinge', 'kneeflex', 'calf', 'core']], ['Poussée B', ['vpush', 'hpush', 'hpush', 'latdelt', 'triceps']], ['Tirage B', ['hpull', 'vpull', 'hpull', 'reardelt', 'biceps']], ['Jambes B', ['hinge', 'lunge', 'kneeext', 'calf', 'core']]]
};
// Séries × répétitions, RIR par semaine et repos selon objectif et rôle de l'emplacement.
function dose(goal, role, level) {
  const beginner = level === 'debutant';
  const T = {
    force: { main: [5, '3-5', 180, '3-1-X-0'], second: [4, '5-8', 150, '2-1-X-0'], acc: [3, '8-12', 90, '2-0-1-0'] },
    masse: { main: [4, '6-8', 150, '3-1-X-0'], second: [4, '8-12', 120, '3-0-1-0'], acc: [3, '10-15', 75, '2-0-1-1'] },
    perte: { main: [4, '6-10', 120, '2-1-X-0'], second: [3, '10-12', 90, '2-0-1-0'], acc: [3, '12-15', 60, '2-0-1-0'] },
    sante: { main: [3, '8-10', 120, '3-1-1-0'], second: [3, '10-12', 90, '3-0-2-0'], acc: [2, '12-15', 60, '2-0-2-0'] },
    perf: { main: [5, '3-5', 180, '2-0-X-0'], second: [4, '6-8', 120, '2-0-X-0'], acc: [3, '8-12', 75, '2-0-1-0'] },
    corps: { main: [5, '4-8', 150, '2-1-X-0'], second: [4, '6-10', 120, '2-0-1-0'], acc: [3, '10-15', 75, '2-0-1-0'] }
  }[goal] || null;
  const d = (T || { main: [4, '6-8', 150, '3-1-X-0'], second: [3, '8-12', 120, '2-0-1-0'], acc: [3, '10-15', 75, '2-0-1-0'] })[role];
  let [sets, reps, rest, tempo] = d;
  if (beginner) { sets = Math.max(2, sets - 1); if (role === 'main') reps = goal === 'force' ? '5-8' : '8-12'; }
  const rir = beginner ? [3, 3, 2, 4] : role === 'acc' ? [3, 2, 1, 4] : [3, 2, 1, 4];
  return { sets, reps, restSec: rest, tempo, rir, rule: role === 'main' ? 'Exercice principal : charge qui monte quand le haut de fourchette est atteint sur toutes les séries au RIR prévu.' : role === 'second' ? 'Second mouvement : volume, +1 rep avant +2,5 %.' : 'Isolation : on cherche la fatigue locale, RIR plus bas en fin de cycle.' };
}
function planStructure(profile, adjust) {
  const adj = adjust || {}; const p = profile || {}; const s = p.spec || {}; const gear = p.gear || []; const gym = gear.includes('salle'); const bodyOnly = !gym && (gear.length === 0 || gear.every(g => g === 'corps' || g === 'cardio'));
  const goal = s.goalMain || ({ force: 'force', masse: 'masse', perte: 'perte', seche: 'perte', sante: 'sante', perf: 'perf', tractions: 'corps', puissance: 'perf', endurance: 'perf', cardio: 'perte', fessiers: 'masse', silhouette: 'masse', bras: 'masse', jambes: 'force' }[(p.goals || [])[0]] || 'masse');
  let days = (Array.isArray(s.daysList) && s.daysList.length) ? s.daysList.slice().sort((a, b) => a - b) : [[0, 2], [0, 2, 4], [0, 2, 4, 5], [0, 1, 3, 4, 5], [0, 1, 2, 3, 4, 5]][Math.max(2, Math.min(6, Number(p.days) || 3)) - 2];
  if (adj.days && adj.days >= 2 && adj.days < days.length) { const drop = adj.dropDays || []; days = days.filter(d => !drop.includes(d)); while (days.length > adj.days) days.pop(); } // assiduité insuffisante : un jour de moins, en retirant d'abord le jour le plus manqué
  const n = days.length; const minutes = Number(p.minutes) || 60; const level = adj.level || p.level || 'intermediaire';
  const caps = LEVEL_CAPS[level] || LEVEL_CAPS.intermediaire;
  const banned = new Set(); const soft = new Set();
  (s.zones || []).concat(adj.zones || []).forEach(z => (ZONE_RULES[z.zone] || []).forEach(pt => {
    if (z.sev === 'opere') banned.add(pt);
    else if (z.sev === 'douleur') { const rehab = (LIB.REHAB[z.zone] || []).some(id => LIB.BY_ID[id] && LIB.BY_ID[id].pattern === pt); if (rehab) soft.add(pt); else banned.add(pt); } // douleur : le schéma reste si une fiche compatible existe (isométrie, excentrique, charge modérée)
    else soft.add(pt); }));
  if (bodyOnly) ['kneeext', 'carry'].forEach(x => banned.add(x));
  const refuse = s.refuse || []; const likes = s.likes || []; const second = s.goalSecond || (p.goals || [])[1] || null;
  const sports = (s.sports || []).map(x => String(x).toLowerCase()); const age = Number(p.age || s.age) || 0; const skills = s.skills || [];
  const pullMax = Math.max(Number(adj.pullMax) || 0, Number((s.perf || {}).pullups) || 0);
  const maxEx = Math.max(4, Math.min(caps.exPerSession, Math.round(minutes / 10)));
  // Objectif secondaire : un schéma supplémentaire ou prioritaire là où il ne gêne pas le principal.
  const SECOND = { tractions: { add: 'vpull', where: /Tirage|Haut|Corps/ }, jambes: { add: 'lunge', where: /Jambes|Bas|Corps/ }, bras: { add: 'biceps', add2: 'triceps', where: /Poussée|Tirage|Haut|Corps/ }, fessiers: { add: 'hinge', where: /Jambes|Bas|Corps/ }, seche: { add: 'cond', where: /./ }, cardio: { add: 'cond', where: /./ }, endurance: { add: 'cond', where: /./ }, puissance: { add: 'carry', where: /Jambes|Bas|Corps/ }, silhouette: { add: 'latdelt', where: /Poussée|Haut|Corps/ },
    equilibre: { add: 'balance', where: /./, first: true }, calisthenie: { add: 'skill', where: /Tirage|Haut|Corps|Poussée/, add2: 'vpull' }, souplesse: { add: 'flex', where: /./, last: true } }[second] || null;
  const DISC = new Set(['balance', 'skill', 'flex']);
  // Autres pratiques : on protège ce que le sport fatigue déjà.
  const operational = /pompier|sapeur|militaire|gendarme|police|secours|garde|infirmi|urgenc|ambulanc/i.test(String(s.sportsNote || '') + ' ' + String(s.jobNote || '') + ' ' + String(p.sports || '') + ' ' + String(p.constraints || '') + ' ' + sports.join(' '));
  const physicalJob = s.activity === 'physique';
  const runner = sports.some(x => /course|trail|running|marathon/.test(x)); const climber = sports.some(x => /escalade|climb/.test(x)); const swimmer = sports.some(x => /natation|swim/.test(x)); const contact = sports.some(x => /rugby|sport co|football|arts martiaux|mma|judo/.test(x)); const cyclist = sports.some(x => /vélo|velo|cyclisme/.test(x));
  if (climber) soft.add('vpull'); // les avant-bras et les coudes sont déjà chargés par la grimpe
  if (swimmer) soft.add('vpush'); // épaules très sollicitées en natation
  // Répartition demandée par l'athlète (bas / haut du corps) : elle remplace le modèle standard.
  const LOWER_SETS = [['Bas du corps A', ['squat', 'hinge', 'kneeflex', 'calf', 'core']], ['Bas du corps B', ['hinge', 'lunge', 'kneeext', 'calf', 'core']], ['Bas du corps C', ['squat', 'lunge', 'kneeflex', 'hinge', 'core']]];
  const UPPER_SETS = [['Haut du corps A', ['hpush', 'vpull', 'vpush', 'hpull', 'biceps', 'triceps']], ['Haut du corps B', ['vpull', 'hpush', 'hpull', 'latdelt', 'reardelt', 'triceps', 'biceps']], ['Haut du corps C', ['hpush', 'hpull', 'vpush', 'vpull', 'reardelt', 'biceps']]];
  let template = SPLITS[Math.max(2, Math.min(6, n))];
  if (s.split && Number.isInteger(s.split.lower) && Number.isInteger(s.split.upper) && s.split.lower + s.split.upper === n && n >= 2) {
    const L = [], U = []; for (let k = 0; k < s.split.lower; k++) L.push(LOWER_SETS[k % 3].slice()); for (let k = 0; k < s.split.upper; k++) U.push(UPPER_SETS[k % 3].slice());
    template = []; let li = 0, ui = 0; for (let k = 0; k < n; k++) { const pickLower = (li < L.length) && (ui >= U.length || li * U.length <= ui * L.length); template.push(pickLower ? L[li++] : U[ui++]); }
    const cnt = {}; template = template.map(([nm, pats]) => { const base = nm.replace(/ [ABC]$/, ''); cnt[base] = (cnt[base] || 0) + 1; const tot = base.startsWith('Bas') ? s.split.lower : s.split.upper; return [tot > 1 ? base + ' ' + 'ABCDEF'[cnt[base] - 1] : base, pats]; });
  }
  const wantIds = (s.wantEx || []).filter(id => LIB.BY_ID[id]); const wantPats = wantIds.map(id => LIB.BY_ID[id].pattern);
  const LOWER_PAT = new Set(['squat', 'hinge', 'lunge', 'kneeflex', 'kneeext', 'calf', 'plyo']);
  const UPPER_PAT = new Set(['hpush', 'vpush', 'hpull', 'vpull', 'biceps', 'triceps', 'latdelt', 'reardelt']);
  let upperCount = 0;
  const sessions = template.map(([name, pats], i) => {
    let list = pats.map(pt => banned.has(pt) ? (ZONE_SUBS[pt] && !banned.has(ZONE_SUBS[pt]) ? ZONE_SUBS[pt] : null) : pt).filter(Boolean);
    { const subbed = pats.map(pt => banned.has(pt)); const kept = list.filter((pt, k) => !subbed[k]); const moved = list.filter((pt, k) => subbed[k]); list = kept.concat(moved); } // un schéma de remplacement ne devient pas l'exercice principal
    list = list.filter((pt, k) => list.indexOf(pt) === k || pt === 'hpush' || pt === 'hpull');
    if (goal === 'perte' && !refuse.includes('cardio') && !list.includes('cond')) list.push('cond');
    if (likes.includes('circuits') && !list.includes('cond')) list.push('cond');
    if (likes.includes('tractions') && (name.includes('Tirage') || name.includes('Haut') || name.includes('Corps')) && !list.includes('vpull')) list.splice(1, 0, 'vpull');
    const goalPull = goal === 'corps' || second === 'tractions' || likes.includes('tractions');
    const lowerOnly = pats.some(x => LOWER_PAT.has(x)) && !pats.some(x => UPPER_PAT.has(x));
    if (goalPull && !lowerOnly && !list.includes('vpull')) list.splice(name.includes('Poussée') ? 1 : 0, 0, 'vpull'); // objectif tractions : tirage vertical à chaque séance du haut, en tête des séances de tirage
    if (SECOND && SECOND.where.test(name)) {
      if (SECOND.add === 'cond') { if (!refuse.includes('cardio') && !list.includes('cond')) list.push('cond'); }
      else if (DISC.has(SECOND.add)) { if (!list.includes(SECOND.add)) { if (SECOND.first) list.unshift(SECOND.add); else list.push(SECOND.add); } } // équilibre et figures : frais, en ouverture ; souplesse : en clôture
      else if (!banned.has(SECOND.add)) { if (list.includes(SECOND.add)) { const k = list.indexOf(SECOND.add); if (k > 1) { list.splice(k, 1); list.splice(1, 0, SECOND.add); } } else list.splice(Math.min(2, list.length), 0, SECOND.add); }
      if (SECOND.add2 && !banned.has(SECOND.add2) && !list.includes(SECOND.add2)) list.push(SECOND.add2);
    }
    if (operational && !bodyOnly) { // métier opérationnel : port de charge (carry) dans une séance bas du corps, condition physique (cond) dans une séance du haut, chaque semaine
      const lowerS = pats.some(x => LOWER_PAT.has(x)); if (lowerS && i === template.findIndex(([, pp]) => pp.some(x => LOWER_PAT.has(x))) && !list.includes('carry') && !banned.has('carry')) list.push('carry');
      if (!lowerS && i === template.findIndex(([, pp]) => !pp.some(x => LOWER_PAT.has(x))) && !list.includes('cond') && !refuse.includes('cardio')) list.push('cond'); }
    if ((runner || cyclist) && goal !== 'force' && goal !== 'masse') { const k = list.indexOf('lunge'); if (k > 0 && list.length > 4) list.splice(k, 1); } // jambes déjà très sollicitées : on retire l'unilatéral de volume
    // exercices voulus : leur schéma doit exister dans une séance de la bonne moitié du corps
    wantPats.forEach((pt, wi) => { if (banned.has(pt) || list.includes(pt)) return; const isLower = LOWER_PAT.has(pt); const sessLower = pats.some(x => LOWER_PAT.has(x)); const sessUpper = pats.some(x => !LOWER_PAT.has(x) && x !== 'core' && x !== 'cond' && x !== 'carry' && !DISC.has(x)); if ((isLower && sessLower) || (!isLower && sessUpper) || (!sessLower && !sessUpper)) { if ((wi + i) % 2 === 0 || n === 1) list.splice(Math.min(2, list.length), 0, pt); } });
    if (s.coreEnd) { const k = list.indexOf('core'); if (k >= 0) list.splice(k, 1); list.push('core'); }
    if (list.length > maxEx) { const keepCond = list.includes('cond'), keepCore = s.coreEnd && list.includes('core'); const disc = list.filter(x => DISC.has(x)); list = list.filter(x => x !== 'cond' && !DISC.has(x) && !(keepCore && x === 'core')).slice(0, maxEx - (keepCond ? 1 : 0) - (keepCore ? 1 : 0) - disc.length); disc.forEach(x => { if (x === 'flex') list.push(x); else list.unshift(x); }); if (keepCore) list.push('core'); if (keepCond) list.push('cond'); } // la discipline demandée n'est jamais sacrifiée au nombre d'exercices
    // jamais moins de 4 emplacements : on complète avec des schémas sûrs non exclus
    for (const extra of ['core', 'kneeflex', 'hinge', 'hpull', 'calf', 'carry', 'reardelt']) { if (list.length >= 4) break; if (!list.includes(extra) && !banned.has(extra)) list.push(extra); }
    // séance remplie au niveau de l'athlète et à son temps : un confirmé à 75 min ne fait pas 5 exercices
    { const target = Math.min(maxEx, ({ debutant: 5, intermediaire: 6, confirme: 7, avance: 8 })[level] || 6);
      const upperOnly = pats.some(x => UPPER_PAT.has(x)) && !pats.some(x => LOWER_PAT.has(x));
      const fill = lowerOnly ? ['lunge', 'kneeext', 'kneeflex', 'calf', 'hinge', 'carry', 'core'] : upperOnly ? (goalPull ? ['vpull', 'hpull', 'latdelt', 'biceps', 'triceps', 'reardelt', 'core'] : ['hpull', 'latdelt', 'biceps', 'triceps', 'reardelt', 'vpull', 'core']) : ['vpull', 'lunge', 'latdelt', 'biceps', 'triceps', 'core', 'carry'];
      fill.push('mobility', 'core'); // en dernier recours (zones à ménager, poids du corps) : mobilité et un second gainage
      const dup = new Set(['vpull', 'hpull', 'hpush', 'lunge', 'core']); // un second emplacement du même schéma est permis (variante différente)
      for (const extra of fill) { if (list.length >= target) break; if (banned.has(extra)) continue; const c = list.filter(x => x === extra).length; if (c === 0 || (c === 1 && dup.has(extra) && (extra !== 'vpull' || goalPull))) { const k = list.indexOf('core'); if (s.coreEnd && k >= 0 && extra !== 'core') list.splice(k, 0, extra); else if (extra === 'cond') list.push(extra); else { const kc = list.indexOf('cond'); list.splice(kc >= 0 ? kc : list.length, 0, extra); } } }
    }
    let upperIdx = -1; if (goalPull && !lowerOnly) { upperIdx = upperCount++; }
    const slots = list.map((pt, k) => { const kk = list.slice(0, k).filter(x => !DISC.has(x)).length; const role = DISC.has(pt) ? 'acc' : kk === 0 ? 'main' : kk === 1 ? 'second' : 'acc'; const d = dose(goal, role, level);
      if (DISC.has(pt)) { const D = { balance: [4, '6-10', 90, 'frais, en ouverture : l\'équilibre s\'apprend sans fatigue, par tentatives courtes et nombreuses'], skill: [4, '3-6', 120, 'figure : tenues ou répétitions courtes, loin de l\'échec, la qualité de position avant la durée'], flex: [2, '6-8', 30, 'souplesse : tenue longue, respiration lente, intensité 6/10, on gagne par le relâchement'] }[pt]; d.sets = D[0]; d.reps = D[1]; d.restSec = D[2]; d.tempo = ''; d.rir = pt === 'flex' ? [3, 3, 3, 4] : [2, 2, 2, 3]; d.rule = D[3]; }
      let pullMode = null; if (goalPull && pt === 'vpull' && upperIdx >= 0) { const firstPull = list.indexOf('vpull') === k; pullMode = firstPull ? (upperIdx % 2 === 0 ? 'heavy' : 'volume') : (upperIdx % 2 === 0 ? 'volume' : 'heavy'); if (pullMode === 'heavy') { d.sets = Math.max(d.sets, 5); d.reps = '3-5'; d.restSec = Math.max(d.restSec, 150); } else { d.sets = Math.max(3, Math.min(d.sets, 4)); d.reps = level === 'debutant' ? '5-8' : '8-15'; d.rir = d.rir.map(r => Math.max(r, 2)); d.restSec = Math.min(d.restSec, 90);
          // volume réglé sur le maximum mesuré (test ou entretien) : séries à 40-60 % du max, jamais une fourchette en dessous du niveau réel
          if (pullMax >= 8) { d.reps = `${Math.max(5, Math.round(pullMax * 0.4))}-${Math.max(8, Math.round(pullMax * 0.6))}`; d.sets = pullMax >= 20 ? 4 : d.sets; } } }
      if (age >= 50) { d.rir = d.rir.map(r => Math.max(r, 2)); d.restSec = Math.round(d.restSec * 1.15); } if (second === 'endurance' && role !== 'main') { d.reps = role === 'second' ? '12-15' : '15-20'; d.restSec = Math.min(d.restSec, 60); } if (adj.volume && adj.volume !== 1) d.sets = Math.max(2, Math.round(d.sets * adj.volume)); if (adj.rir) d.rir = d.rir.map((r, i) => i === d.rir.length - 1 ? r : Math.min(4, Math.max(0, r + adj.rir))); return Object.assign({ pattern: pt, role, star: kk < 2 && !DISC.has(pt), soft: soft.has(pt), pullMode }, d); });
    // borne de volume par niveau
    let total = slots.reduce((a, x) => a + x.sets, 0); while (total > caps.setsPerSession) { const big = slots.reduce((m, x) => x.sets > m.sets ? x : m, slots[0]); if (big.sets <= 2) break; big.sets--; total--; }
    const dayIdx = days[i]; return { id: 's' + (i + 1), day: (dayIdx + 1) % 7, dayName: DAY_FR[dayIdx], name: goal === 'perte' ? name.replace('force', 'densité') : name, slots };
  });
  return { goal, second, level, days, minutes, gym, bodyOnly, banned: [...banned], soft: [...soft], sessions, caps, age, skills, sports, pullMax, flags: { runner, climber, swimmer, contact, cyclist, operational, physicalJob, sedentary: s.activity === 'sedentaire' }, favor: (adj.favor || []).concat(wantIds), avoid: adj.avoid || [], want: wantIds, adjust: adj, goalPull: goal === 'corps' || second === 'tractions' || likes.includes('tractions') };
}
// Rendu du programme déjà construit pour le coach : il rédige, il ne choisit pas. Les exercices viennent de la bibliothèque.
function skeletonText(plan, profile) {
  const pr = profile || {};
  return `PROGRAMME DÉJÀ CONSTRUIT (structure et exercices fixés par les règles et la bibliothèque, à partir de la fiche ; tu ne les changes pas) :\n` + plan.sessions.map(se => `${se.id} · ${se.dayName} · « ${se.name} » :\n` + se.slots.map((sl, k) => `  ${se.id}-${k + 1}. ${sl.ex.name}${sl.ex.machine ? ' (' + sl.ex.machine + ')' : ''} — ${sl.ex.target || PATTERNS[sl.usedPattern || sl.pattern].muscle} — ${sl.sets} × ${sl.reps}, RIR ${sl.rir.join('/')}, repos ${sl.restSec} s, tempo ${sl.tempo}${sl.star ? ', prioritaire' : ''}${sl.soft ? ', zone fragile : charge modérée' : ''}`).join('\n')).join('\n') +
    `\n\nTon travail : écrire pour ${pr.name || 'cet athlète'} le "rationale" (commence par « Pour ${pr.name || 'toi'} », explique les arbitrages faits pour cette personne et la progression semaine par semaine), la "nutrition" (cibles chiffrées pour son gabarit et son objectif), l'échauffement "warmup", et pour chaque exercice une "note" personnelle d'une phrase (pourquoi lui pour cette personne, ou un point d'attention lié à sa fiche) dans "notes" : {"<id exercice>": "..."}. Pas d'autre champ.${plan.banned.length ? ` Schémas exclus par les zones à ménager : ${plan.banned.map(b => PATTERNS[b] ? PATTERNS[b].label : b).join(' ; ')}.` : ''}`;
}
// Programme complet depuis le plan et la bibliothèque : structure, exercices, textes de coach de la fiche, illustration exacte.
function programFromPlan(plan, profile, startISO, weeksN) {
  const prog = normalizeProgram({ cycleName: 'Mésocycle 1 · ' + ({ force: 'Force', masse: 'Masse', perte: 'Densité', sante: 'Santé et mobilité', perf: 'Performance', corps: 'Poids du corps' }[plan.goal] || 'Base') + ' · ' + new Date(startISO + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), durationWeeks: weeksN || (plan.level === 'debutant' ? 3 : 4) }, startISO);
  const demos = {};
  prog.sessions = plan.sessions.map(se => {
    const exercises = se.slots.map((sl, k) => {
      const e = sl.ex; const id = se.id + '-' + (k + 1); if (e.illus && ILLUS_IDS.includes(e.illus)) demos[id] = e.illus;
      // exercices chronométrés (gainage, port de charge, finisher) : la consigne remplace la fourchette de répétitions
      const isCond = e.pattern === 'cond'; const sets = isCond ? 1 : sl.sets; const reps = e.timed ? e.timed : sl.reps; const restSec = isCond ? 60 : sl.restSec;
      return { id, n: k + 1, exId: e.id, name: e.name, machine: e.machine || '', alt: sl.alt ? sl.alt.name : '', altId: sl.alt ? sl.alt.id : '', star: sl.star && !e.timed, sets, reps, timed: !!e.timed, per: e.uni && !/par côté/.test(e.timed || '') ? 'par côté' : '', rir: sl.rir.slice(), tempo: e.timed ? '' : sl.tempo, restSec, restText: restSec >= 60 ? Math.round(restSec / 60 * 10) / 10 + ' min' : restSec + ' s', mode: 'normal', setsText: isCond ? reps : `${sets} × ${reps}`, chargeNote: e.timed ? 'Tenue ou cadence, pas de charge maximale' : `RIR ${sl.rir[0]} → ${sl.rir[1]} → ${sl.rir[2]}`, pattern: sl.usedPattern || sl.pattern, role: sl.role, rule: sl.rule, reco: e.reco || '', why: e.why || '', target: e.target || '', exec: e.exec || '', seek: e.seek || '', note: '', url: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(e.machine || e.name) };
    });
    return { id: se.id, day: se.day, dayName: se.dayName, name: se.name, sub: exercises.slice(0, 2).map(x => x.target.split(',')[0]).join(', '), duration: plan.minutes + ' min', place: '', gtg: false, note: '', exercises };
  });
  prog.demos = demos; prog.demosAt = Date.now();
  prog.promise = buildPromise(plan, profile); prog.recovery = buildRecovery(plan, profile); prog.nutritionBase = buildNutrition(plan, profile);
  // Enseigne connue : chaque exercice reçoit le modèle exact du parc (marque + référence) et ses équivalents, devant la description visuelle.
  { const brand = String(((profile || {}).spec || {}).brand || '').trim(); const parc = PARCS[brand]; if (parc && plan.gym) { prog.sessions.forEach(se => se.exercises.forEach(e => { const m = parc[e.exId]; if (!m || !m.length) return; e.machineModel = m[0]; e.machineAlts = m.slice(1); e.machine = m[0] + (e.machine ? ' · ' + e.machine : ''); if (m[1] && !e.alt) e.alt = m[1]; e.url = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(m[0]); })); prog.parc = brand; } }
  prog.engine = { v: 2, goal: plan.goal, banned: plan.banned, soft: plan.soft, notes: plan.selectionNotes || [], gear: plan.gearList || [] };
  if (plan.adjust && plan.adjust.days && plan.adjust.days === plan.sessions.length) prog.engine.daysAdjusted = plan.sessions.length; // un jour retiré par le bilan (assiduité)
  prog.rationale = `Pour ${(profile || {}).name || 'toi'} : ${plan.days.length} séances de ${plan.minutes} minutes, objectif ${({ force: 'force', masse: 'prise de muscle', perte: 'perte de gras en gardant le muscle', sante: 'santé et mobilité', perf: 'performance', corps: 'poids du corps' }[plan.goal] || plan.goal)}, niveau ${plan.level}. La structure, les séries, les répétitions, le RIR et les repos sont réglés par les règles à partir de ta fiche ; chaque exercice est choisi dans la bibliothèque pour ton matériel et tes zones à ménager.`;
  prog.nutrition = prog.nutritionBase.text; prog.warmup = null;
  return applyGuardrails(prog, profile);
}
/* Promesse : l'objectif devient une mesure, une cible et une échéance (3 cycles, 12 semaines), avec des jalons par cycle.
   La valeur de départ est mesurée dans l'app (tests, charges, poids) : le programme dit quoi mesurer et quand. */
function buildPromise(plan, profile) {
  const p = profile || {}; const sp = p.spec || {}; const g = plan.goal; const second = plan.second;
  const P = {
    force: { metric: 'e1rm', label: 'Charges sur tes exercices principaux', target: '+10 %', unit: '%', steps: [3, 6, 10], measure: 'les charges notées sur les exercices prioritaires (estimation de ton maximum)', promise: 'Dans 12 semaines tu soulèves 10 % de plus sur tes mouvements principaux, à technique propre.' },
    masse: { metric: 'bw', label: 'Poids de corps et charges', target: '+2 kg', unit: 'kg', steps: [0.7, 1.4, 2], measure: 'ton poids chaque semaine à jeun, et les charges sur les exercices prioritaires', promise: 'Dans 12 semaines, +2 kg sur la balance avec des charges en hausse sur tous les mouvements prioritaires : du muscle, pas du gras.' },
    perte: { metric: 'bw', label: 'Poids de corps, force conservée', target: '−4 %', unit: '%', steps: [-1.5, -3, -4], measure: 'ton poids chaque semaine à jeun ; les charges ne doivent pas baisser', promise: 'Dans 12 semaines, −4 % sur la balance sans perdre un kilo sur la barre.' },
    sante: { metric: 'adherence', label: 'Séances faites sans douleur', target: '90 %', unit: '%', steps: [80, 85, 90], measure: 'les séances terminées et tes notes de douleur après chaque séance', promise: 'Dans 12 semaines, tu t\'entraînes sans douleur, avec plus d\'amplitude et plus de charge qu\'aujourd\'hui.' },
    perf: { metric: 'e1rm', label: 'Force et puissance', target: '+10 %', unit: '%', steps: [3, 6, 10], measure: 'les charges sur les prioritaires et ton test de tractions', promise: 'Dans 12 semaines, +10 % de charge sur les prioritaires et plus de répétitions au test.' },
    corps: { metric: 'pull', label: 'Tractions strictes d\'affilée', target: '+30 %', unit: '%', steps: [10, 20, 30], measure: 'ton test de tractions maximum, une fois par cycle, reposé', promise: 'Dans 12 semaines, 30 % de tractions en plus d\'affilée, strictes.' }
  }[g] || null;
  if (!P) return null;
  const out = Object.assign({ goal: g, weeks: 12, cycles: 3, checkpoints: ['fin de cycle 1', 'fin de cycle 2', 'fin de cycle 3'] }, P);
  if (second === 'tractions' && g !== 'corps') out.secondary = { metric: 'pull', label: 'Tractions d\'affilée', target: '+25 %', measure: 'test de tractions à chaque fin de cycle' };
  if (second === 'jambes') out.secondary = { metric: 'e1rm_legs', label: 'Charges jambes', target: '+12 %', measure: 'charges sur le squat, la presse ou le soulevé de terre' };
  if (second === 'bras') out.secondary = { metric: 'arm', label: 'Bras', target: '+1 cm de tour de bras', measure: 'tour de bras contracté, même endroit, chaque fin de cycle' };
  if (second === 'seche') out.secondary = { metric: 'bw', label: 'Sécher', target: '−2 %', measure: 'poids hebdomadaire à jeun' };
  if (second === 'equilibre') out.secondary = { metric: 'hold', label: 'Poirier', target: 'tenue au mur ×2, premières secondes en libre', measure: 'la meilleure tenue notée à chaque séance (secondes)' };
  if (second === 'calisthenie') out.secondary = { metric: 'hold', label: 'Figures au poids du corps', target: 'un palier de plus par figure', measure: 'les tenues et répétitions notées sur les figures' };
  if (second === 'souplesse') out.secondary = { metric: 'rom', label: 'Souplesse', target: 'postures tenues plus bas, sans douleur', measure: 'une photo ou une mesure (distance au sol) à chaque fin de cycle' };
  if (second === 'endurance' || second === 'cardio') out.secondary = { metric: 'cond', label: 'Souffle', target: 'finisher complété à chaque séance', measure: 'temps ou tours du finisher noté dans la séance' };
  out.baselineRule = 'Semaine 1 = calibrage : tout noter, ce sont tes valeurs de départ. Le coach compare à chaque fin de cycle et ajuste le cycle suivant.';
  return out;
}
/* Récupération : chaque jour sans séance reçoit un protocole selon ce qui a été entraîné la veille et ce qui vient. */
function buildRecovery(plan, profile) {
  const p = profile || {}; const age = plan.age || 0; const sleep = age >= 45 ? '7 h 30 à 8 h 30' : '7 h 30 à 9 h';
  const byDay = {}; plan.sessions.forEach(se => { byDay[se.day] = se; });
  const muscles = se => { const pats = se.slots.map(sl => sl.usedPattern || sl.pattern); const legs = pats.some(x => ['squat', 'hinge', 'lunge', 'kneeflex', 'kneeext', 'calf'].includes(x)); const upper = pats.some(x => ['hpush', 'vpush', 'hpull', 'vpull', 'latdelt', 'reardelt', 'biceps', 'triceps'].includes(x)); return legs && upper ? 'corps entier' : legs ? 'jambes' : 'haut du corps'; };
  const days = [];
  for (let d = 0; d < 7; d++) {
    if (byDay[d]) continue;
    const prev = byDay[(d + 6) % 7] || byDay[(d + 5) % 7] || null; const next = byDay[(d + 1) % 7] || null;
    const pm = prev ? muscles(prev) : null; const nm = next ? muscles(next) : null;
    const items = [];
    if (pm === 'jambes' || pm === 'corps entier') items.push('20 à 30 min de marche rapide ou de vélo très facile : tu dois pouvoir parler sans effort. Ça draine les jambes sans les fatiguer.', 'Rouleau de massage 8 min : quadriceps, fessiers, mollets, 60 s par zone, lentement.', 'Mobilité hanches 5 min : fente basse tenue 45 s par côté, 90/90 au sol.');
    else if (pm === 'haut du corps') items.push('15 à 20 min de cardio très facile au choix, ou une marche.', 'Rouleau ou balle 6 min : grand dorsal, pectoraux, haut du dos.', 'Mobilité épaules 5 min : passages de bâton, rotations externes à vide, suspension passive 2 × 30 s si tu as une barre.');
    else items.push('Jour libre : une marche de 30 min et 10 min de mobilité globale suffisent.');
    if (nm === 'jambes' || nm === 'corps entier') items.push('Demain c\'est jambes : repas du soir riche en glucides lents, coucher tôt.');
    if (nm === 'haut du corps') items.push('Demain haut du corps : rien de spécial, garde les épaules au chaud.');
    items.push(`Sommeil : ${sleep}, heure de coucher stable. C\'est là que le muscle se construit.`);
    days.push({ day: d, dayName: DAY_FR[(d + 6) % 7], after: pm, before: nm, items });
  }
  const jobRules = (plan.flags && plan.flags.physicalJob && !(plan.flags && plan.flags.operational)) ? ['Journée physique au travail : la séance du soir compte comme une deuxième charge ; si les jambes ou le dos sont déjà entamés, « Fatigué » dans la séance (une série de moins partout) plutôt que de sauter.'] : (plan.flags && plan.flags.sedentary) ? ['Journées assises : 10 minutes de marche après chaque repas et deux pauses debout par heure font plus pour la récupération que n\'importe quel complément.'] : [];
  const opRules = jobRules.concat((plan.flags && plan.flags.operational) ? ['Après une garde ou une nuit d\'intervention : pas de séance lourde le jour même ; marche 30 min, mobilité, et la séance prévue est décalée d\'un jour ou allégée (« Fatigué » dans la séance).', 'Deux gardes dans la semaine : la semaine passe en version allégée depuis le point du lundi, sans culpabilité, le cycle est construit pour ça.'] : []);
  return { sleep, rules: opRules.concat(['Deux séances sans sommeil correct : on réduit la séance suivante de 20 % (le coach le fait avec toi).', 'Douleur articulaire qui dure plus de 48 h : tu le dis dans la séance, l\'exercice est remplacé.', 'Massage ou sauna : après les grosses séances, jamais juste avant.']), days };
}
/* Nutrition déterministe (Mifflin-St Jeor × activité, ajustée à l\'objectif) : toujours présente, le coach la personnalise par-dessus. */
function buildNutrition(plan, profile) {
  const p = profile || {}; const sp = p.spec || {}; const w = Number(p.weight || sp.weight) || 0, h = Number(p.height || sp.height) || 0, a = Number(p.age || sp.age) || 35; const f = (p.sex || sp.sex) === 'f';
  if (!w || !h) return { text: 'Renseigne ton poids et ta taille dans ton profil pour obtenir tes cibles.', kcal: null };
  const bmr = 10 * w + 6.25 * h - 5 * a + (f ? -161 : 5); const act = ({ sedentaire: 1.25, modere: 1.35, physique: 1.5 })[sp.activity] + 0.05 * plan.days.length || 1.35 + 0.05 * plan.days.length; let kcal = Math.round(bmr * act / 10) * 10;
  const g = plan.goal; const adj = { masse: 250, force: 150, perte: -400, sante: 0, perf: 100, corps: 0 }[g] || 0; if (plan.second === 'seche') kcal -= 200;
  kcal += adj; const prot = Math.round(w * (g === 'perte' ? 2.2 : 1.9)); const fat = Math.round(w * 0.9); const carb = Math.max(100, Math.round((kcal - prot * 4 - fat * 9) / 4));
  // Deux phases sur 12 semaines : construction (cycles 1 et 2) puis révélation (cycle 3). Pour « perte », l'ordre est inversé : déficit d'abord, maintien ensuite pour fixer.
  const macros = k => { const c = Math.max(100, Math.round((k - prot * 4 - fat * 9) / 4)); return { kcal: k, prot, fat, carb: c }; };
  let phases;
  if (g === 'perte') phases = [{ name: 'Révélation', cycles: 'cycles 1 et 2', why: 'déficit modéré, protéines hautes pour garder le muscle', ...macros(kcal) }, { name: 'Stabilisation', cycles: 'cycle 3', why: 'retour au maintien pour fixer le poids et remonter les charges', ...macros(kcal + 400) }];
  else phases = [{ name: 'Construction', cycles: 'cycles 1 et 2', why: adj > 0 ? 'léger surplus pour soutenir le volume et la force' : 'maintien, le volume d\'entraînement fait le travail', ...macros(kcal) }, { name: 'Révélation', cycles: 'cycle 3', why: 'déficit léger, protéines hautes : le muscle construit apparaît, les charges se maintiennent', ...macros(kcal - 300) }];
  const text = `Phase ${phases[0].name.toLowerCase()} (${phases[0].cycles}) : ${phases[0].kcal} kcal par jour, ${phases[0].prot} g de protéines (environ ${Math.round(prot / 4)} g par repas sur 4 repas), ${phases[0].carb} g de glucides placés autour des séances, ${phases[0].fat} g de lipides. Phase ${phases[1].name.toLowerCase()} (${phases[1].cycles}) : ${phases[1].kcal} kcal, ${phases[1].carb} g de glucides, protéines et lipides inchangés. Pèse-toi une fois par semaine à jeun : si le poids ne bouge pas dans le sens voulu sur deux semaines, ajuste de 150 kcal.`;
  return { text, kcal, prot, carb, fat, phases };
}
// Fusion des textes du coach (rationale, nutrition, warmup, notes par exercice) dans le programme construit. Rien d'autre ne bouge.
function mergeCoachTexts(prog, parsed) {
  const out = prog; const pd = parsed || {};
  if (typeof pd.rationale === 'string' && pd.rationale.trim().length > 80) out.rationale = pd.rationale.trim();
  if (typeof pd.nutrition === 'string' && pd.nutrition.trim()) out.nutrition = pd.nutrition.trim();
  if (pd.warmup && typeof pd.warmup === 'object') out.warmup = pd.warmup;
  if (typeof pd.cycleName === 'string' && pd.cycleName.trim()) out.cycleName = pd.cycleName.trim().slice(0, 80);
  const notes = pd.notes && typeof pd.notes === 'object' ? pd.notes : {};
  out.sessions.forEach(se => se.exercises.forEach(e => { if (typeof notes[e.id] === 'string' && notes[e.id].trim()) e.note = notes[e.id].trim().slice(0, 300); }));
  return out;
}
const COACH_TEXT_SCHEMA = `Réponds UNIQUEMENT avec un objet JSON valide (pas de texte autour) : {"cycleName":"Mésocycle 1 · <thème> · <mois année>","rationale":"markdown léger, 150 à 250 mots","nutrition":"60 à 120 mots, cibles chiffrées","warmup":{"common":"...","ramp":"..."},"notes":{"s1-1":"une phrase","s1-2":"..."}}`;

/* Bilan de fin de cycle, déterministe : on observe l'état réel (assiduité, charges, forme hebdomadaire, douleurs)
   et on en déduit les réglages du cycle suivant. Le programme suivant part de ce qui s'est passé, pas de la fiche seule. */
// Schémas qui portent l'objectif : ils ne sont jamais retirés du programme, quel que soit le bilan.
function goalPatterns(profile) {
  const p = profile || {}; const s = p.spec || {}; const g = s.goalMain || (p.goals || [])[0] || ''; const g2 = s.goalSecond || (p.goals || [])[1] || ''; const likes = s.likes || [];
  const out = new Set();
  [g, g2].forEach(x => { if (x === 'corps' || x === 'tractions') out.add('vpull'); if (x === 'jambes') { out.add('squat'); out.add('hinge'); } if (x === 'bras') { out.add('biceps'); out.add('triceps'); } if (x === 'fessiers') out.add('hinge'); if (x === 'equilibre') out.add('balance'); if (x === 'calisthenie') out.add('skill'); if (x === 'souplesse') out.add('flex'); });
  if (likes.includes('tractions')) out.add('vpull');
  return [...out];
}
function reviewCycle(prev, logs, checkins, profile, extra) {
  if (!prev || !prev.generatedAt || !Array.isArray(prev.sessions) || !prev.sessions.length) return null;
  const weeks = prev.weeks || []; const genDay = new Date(prev.generatedAt - 86400000).toISOString().slice(0, 10); const from = weeks[0] && weeks[0].from < genDay ? weeks[0].from : genDay; const to = null; // tout ce qui a été fait depuis la génération précédente compte
  const L = (logs || []).filter(l => l && l.date && l.date >= from);
  const planned = weeks.length * prev.sessions.length; const done = L.filter(l => l.done || Object.values(l.sets || {}).flat().some(x => x && x.done)).length;
  const adherence = planned ? Math.round(100 * done / planned) : 0;
  const e1 = (w, r) => (!w || !r) ? 0 : (r === 1 ? w : w * (1 + r / 30));
  const endW1 = from ? new Date(new Date(from + 'T12:00:00').getTime() + 6 * 86400000).toISOString().slice(0, 10) : null;
  const stars = {}; prev.sessions.forEach(se => se.exercises.forEach(e => { if (e.star) stars[e.id] = e; }));
  const first = {}, best = {}, prById = {};
  L.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(l => Object.entries(l.sets || {}).forEach(([id, arr]) => { (arr || []).forEach(st => { if (!st || !st.done || !st.r) return; const v = st.w ? e1(st.w, st.r) : Number(st.r); /* sans charge (tractions, dips, pompes) : la mesure est la meilleure série en répétitions */ if (endW1 && l.date <= endW1 && (!first[id] || v > first[id])) first[id] = v; if (!best[id] || v > best[id]) { if (best[id]) prById[id] = (prById[id] || 0) + 1; best[id] = v; } }); }));
  const measured = Object.keys(first).filter(id => stars[id]); const progress = measured.length ? Math.round(10 * measured.reduce((t, id) => t + 100 * ((best[id] || first[id]) - first[id]) / first[id], 0) / measured.length) / 10 : null;
  const C = Object.values(checkins || {}).filter(c => c && (!from || c.weekKey >= from) && (!to || c.weekKey <= to)); const readiness = C.length ? Math.round(10 * C.reduce((t, c) => t + (c.readiness || 3), 0) / C.length) / 10 : null;
  const pain = {}; L.forEach(l => { const z = l.day && l.day.pain; if (z) pain[z] = (pain[z] || 0) + 1; });
  // Ressenti : RIR notés sur les séries (0 = à l'échec), exercices sautés, séances allégées pour fatigue ou temps.
  const rirs = []; const skipped = {}; let eased = 0;
  L.forEach(l => { if (l.day && (l.day.fatigue || l.day.minutes)) eased++; Object.entries(l.sets || {}).forEach(([id, arr]) => (arr || []).forEach(st => { if (st && st.done && st.rir != null && st.rir !== '') rirs.push(Number(st.rir)); })); Object.entries(l.flags || {}).forEach(([id, f]) => { if (f && f.skip) { const ex = prev.sessions.flatMap(se => se.exercises).find(e => e.id === id); if (ex && ex.exId) skipped[ex.exId] = (skipped[ex.exId] || 0) + 1; } }); });
  const rirAvg = rirs.length ? Math.round(10 * rirs.reduce((a, b) => a + b, 0) / rirs.length) / 10 : null; const failShare = rirs.length ? Math.round(100 * rirs.filter(r => r <= 0).length / rirs.length) : null;
  const X = extra || {}; const T = (X.tests || []).filter(t => t && t.date && t.date >= from).sort((a, b) => a.date < b.date ? -1 : 1); const tests = T.length >= 2 ? { start: T[0].reps, end: T[T.length - 1].reps } : (T.length === 1 ? { start: T[0].reps, end: null } : null);
  const B = (X.bw || []).filter(b => b && b.date && b.date >= from && b.kg).sort((a, b) => a.date < b.date ? -1 : 1); const weight = B.length >= 2 ? { start: B[0].kg, end: B[B.length - 1].kg, delta: Math.round(10 * (B[B.length - 1].kg - B[0].kg)) / 10 } : null;
  const zoneKey = z => Object.keys(ZONE_FR).find(k => (ZONE_FR[k] || '').toLowerCase().startsWith(String(z).toLowerCase().slice(0, 4))) || null;
  const adjust = { volume: 1, rir: 0, favor: [], avoid: [], zones: [], level: null, reasons: [] };
  if (!done) return { adherence, done, planned, progress, readiness, pain, adjust, summary: 'Aucune séance enregistrée sur le cycle précédent : on repart de la fiche, en calibrage.' };
  if (adherence < 60) { const n = prev.sessions.length; if (n > 2) { const missed = {}; prev.sessions.forEach(se => { const did = L.filter(l => l.session === se.id && (l.done || Object.values(l.sets || {}).flat().some(x => x && x.done))).length; missed[se.id] = weeks.length - did; }); const worst = Object.entries(missed).sort((a, b) => b[1] - a[1])[0]; const se = prev.sessions.find(x => x.id === (worst || [])[0]); adjust.days = n - 1; adjust.dropDays = se ? [(se.day + 6) % 7] : []; adjust.reasons.push(`assiduité ${adherence} % : ${n - 1} séances par semaine au lieu de ${n}${se ? ' (le ' + se.dayName.toLowerCase() + ' saute le plus souvent)' : ''}, des séances pleines que tu feras vraiment`); } else { adjust.volume = 0.85; adjust.reasons.push(`assiduité ${adherence} % : volume −15 %, des séances plus courtes que tu feras vraiment`); } }
  if (readiness != null && readiness < 2.8) { adjust.volume = Math.min(adjust.volume, 0.85); adjust.rir = 1; adjust.reasons.push(`forme moyenne ${readiness}/5 aux points du lundi : volume −15 %, RIR +1`); }
  if (adherence >= 85 && progress != null && progress >= 5 && (readiness == null || readiness >= 3.5)) { adjust.volume = 1.1; adjust.reasons.push(`assiduité ${adherence} %, +${progress} % sur les prioritaires : volume +10 %`); if ((profile || {}).level === 'debutant') { adjust.level = 'intermediaire'; adjust.reasons.push('tu passes au niveau intermédiaire'); } }
  const goalPats = goalPatterns(profile);
  if (adherence >= 85 && progress != null && progress < 2) { Object.keys(stars).forEach(id => { const ex = stars[id]; const lib = ex.exId && LIB.BY_ID[ex.exId]; if (!lib || !first[id] || prById[id] > 0) return; if (goalPats.includes(lib.pattern)) return; /* jamais écarter le geste de l'objectif : on le garde et on change la méthode */ if (!adjust.avoid.includes(ex.exId)) adjust.avoid.push(ex.exId); }); adjust.volume = Math.max(adjust.volume, 1.05); adjust.reasons.push(`assidu mais stagnation (+${progress} %) : on change les exercices principaux qui n'ont pas bougé`); }
  Object.keys(prById).forEach(id => { const ex = prev.sessions.flatMap(se => se.exercises).find(e => e.id === id); if (ex && ex.exId && prById[id] >= 2 && !adjust.avoid.includes(ex.exId)) adjust.favor.push(ex.exId); });
  // Ressenti : trop souvent à l'échec → on redonne une répétition de réserve ; beaucoup de réserve alors que ça stagne → on serre.
  if (failShare != null && failShare >= 40 && rirs.length >= 20) { adjust.rir = Math.max(adjust.rir, 1); adjust.reasons.push(`${failShare} % des séries notées à l'échec : RIR +1, l'échec systématique freine la progression`); }
  else if (rirAvg != null && rirAvg >= 3 && rirs.length >= 20 && progress != null && progress < 2) { adjust.rir = Math.min(adjust.rir, -1); adjust.reasons.push(`RIR moyen ${rirAvg} avec charges stables : tu gardes trop de réserve, RIR −1`); }
  // Exercices sautés trois fois ou plus : la personne ne les fait pas, on les remplace (sauf le geste de l'objectif).
  Object.entries(skipped).forEach(([exId, n]) => { if (n >= 3 && !adjust.avoid.includes(exId) && !goalPats.includes((LIB.BY_ID[exId] || {}).pattern)) { adjust.avoid.push(exId); adjust.reasons.push(`${(LIB.BY_ID[exId] || {}).name || exId} sauté ${n} fois : remplacé`); } });
  if (eased >= Math.max(3, Math.round(done * 0.3))) { adjust.volume = Math.min(adjust.volume, 0.9); adjust.reasons.push(`${eased} séances allégées (fatigue ou temps) : volume −10 %, des séances qui tiennent dans ta vraie semaine`); }
  // Sans charge : quand les répétitions hautes sont atteintes sur un exercice au poids du corps, on monte d'une variante.
  const HARDER = { pushup: 'decline_pushup', decline_pushup: 'weighted_pushup', bw_squat: 'bss', glute_bridge: 'sl_bridge', inverted_row: 'pullup', band_pullup: 'pullup', negative_pullup: 'pullup', plank: 'weighted_plank', pike_pushup: 'hspu', bw_calf: 'db_calf', wall_sit: 'spanish_squat', step_up: 'bss' };
  Object.keys(best).forEach(id => { const ex = prev.sessions.flatMap(se => se.exercises).find(e => e.id === id); if (!ex || !ex.exId || !HARDER[ex.exId]) return; const lib = LIB.BY_ID[ex.exId]; const hard = LIB.BY_ID[HARDER[ex.exId]]; if (!lib || !hard) return; const bw = !(logs || []).some(l => (l.sets || {})[id] && (l.sets[id] || []).some(st => st && st.done && st.w)); const top = parseInt(String(ex.reps || '').split('-').pop()) || 12; if (bw && best[id] >= Math.max(top, 12) && LIB.allowed(hard, profile, (profile || {}).level, LIB.availableGear(profile)) && !adjust.avoid.includes(ex.exId) && !goalPats.includes(lib.pattern)) { adjust.avoid.push(ex.exId); adjust.favor.push(hard.id); adjust.reasons.push(`${lib.name} : ${best[id]} répétitions atteintes, on passe à ${hard.name.toLowerCase()}`); } });
  if (tests && tests.end != null && tests.start) { const d = Math.round(100 * (tests.end - tests.start) / tests.start); if (d >= 5) adjust.reasons.push(`test : ${tests.start} → ${tests.end} répétitions (+${d} %)`); else if (d <= 0) adjust.reasons.push(`test : ${tests.start} → ${tests.end} répétitions, pas de progression sur l'objectif`); }
  Object.entries(pain).forEach(([z, n]) => { const k = zoneKey(z); if (!k) return; const sev = n >= 4 ? 'douleur' : 'fragile'; adjust.zones.push({ zone: k, sev }); adjust.reasons.push(`${z} signalé ${n} fois : zone ${sev === 'douleur' ? 'douloureuse, exercices à risque retirés' : 'fragile, charges modérées'}`); });
  const summary = `Cycle précédent : ${done}/${planned} séances (${adherence} %)${progress != null ? `, ${progress >= 0 ? '+' : ''}${progress} % sur les prioritaires` : ', charges non mesurées'}${readiness != null ? `, forme moyenne ${readiness}/5` : ''}${Object.keys(pain).length ? `, douleurs : ${Object.entries(pain).map(([z, n]) => z + ' ×' + n).join(', ')}` : ''}. ` + (adjust.reasons.length ? 'Réglages : ' + adjust.reasons.join(' ; ') + '.' : 'Réglages : plan reconduit avec progression normale.');
  return { adherence, done, planned, progress, readiness, pain, prs: Object.values(prById).reduce((a, b) => a + b, 0), rirAvg, failShare, setsRated: rirs.length, skipped, eased, tests, weight, adjust, summary };
}
/* Références de départ du cycle suivant : pour chaque fiche (exId) déjà travaillée, la meilleure série récente hors semaine de décharge.
   C'est ce qui fait qu'un nouveau cycle repart de ce qui a été fait, et non de zéro. Charge : meilleure estimation du maximum (e1RM) ; sans charge : meilleure série en répétitions. */
function buildRefs(prev, logs, historyCycles) {
  const idTo = {}; const deloadWeeks = {};
  const add = (cyc, from, to, weeks) => { Object.entries(cyc || {}).forEach(([id, m]) => { if (m && m.exId) idTo[id] = (idTo[id] || []).concat([{ exId: m.exId, from, to }]); }); if (from && weeks) deloadWeeks[from] = { from, to, weeks }; };
  (historyCycles || []).forEach(c => add(c.exMap, c.from, c.to, c.weeks));
  if (prev) { const m = {}; (prev.sessions || []).forEach(se => (se.exercises || []).forEach(e => { m[e.id] = { exId: e.exId }; })); add(m, prev.weeks && prev.weeks[0] ? prev.weeks[0].from : null, prev.weeks && prev.weeks.length ? prev.weeks[prev.weeks.length - 1].to : null, (prev.weeks || []).length); }
  const e1 = (w, r) => r === 1 ? w : w * (1 + r / 30);
  const refs = {};
  const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  (logs || []).forEach(l => {
    if (!l || !l.date || l.date < cutoff) return;
    // décharge : dernière semaine d'un cycle, on ne repart pas de ces charges réduites
    const cyc = Object.values(deloadWeeks).find(c => c.from && c.to && l.date >= c.from && l.date <= c.to); const isDeload = cyc && Number(l.week) === cyc.weeks;
    Object.entries(l.sets || {}).forEach(([id, arr]) => {
      const exId = (l.exIds && l.exIds[id]) || ((idTo[id] || []).find(x => (!x.from || l.date >= x.from) && (!x.to || l.date <= x.to)) || {}).exId; if (!exId) return;
      (arr || []).forEach(st => { if (!st || !st.done || !st.r) return; const w = Number(st.w) || 0; const v = w ? e1(w, Number(st.r)) : Number(st.r);
        const cur = refs[exId]; const cand = { w, r: Number(st.r), e1: w ? Math.round(v * 10) / 10 : null, reps: w ? null : Number(st.r), date: l.date, deload: !!isDeload };
        // la référence = la dernière séance faite hors décharge, meilleure série de cette séance
        if (!cur || (cur.deload && !isDeload) || (cur.deload === !!isDeload && (l.date > cur.date || (l.date === cur.date && v > cur.v)))) refs[exId] = Object.assign(cand, { v }); });
    });
  });
  Object.values(refs).forEach(r => { delete r.v; });
  return refs;
}
// Conception du cycle : durée (3 à 6 semaines) et orientation (accumulation, intensification, réalisation), décidées par le profil et par ce qui vient d'être vécu, avec les raisons écrites.
function cycleDesign(profile, review, cycleN) {
  const p = profile || {}; const s = p.spec || {}; const goal = s.goalMain || (p.goals || [])[0] || 'masse'; const level = p.level || 'intermediaire'; const age = Number(p.age || s.age) || 0; const rv = review || null; const n = Math.max(1, Number(cycleN) || 1);
  const reasons = [];
  let weeks = ({ debutant: 3, intermediaire: 4, confirme: 4, avance: 4 })[level] || 4;
  if (level === 'debutant') reasons.push('3 semaines : un débutant progresse vite et doit être recalibré souvent');
  else if (goal === 'masse' && level !== 'intermediaire') { weeks = 5; reasons.push('5 semaines : la masse se construit sur une accumulation de volume plus longue, avec la décharge à la fin'); }
  else if (goal === 'corps') { weeks = 5; reasons.push('5 semaines : l\'endurance de traction demande une accumulation longue avant de tester'); }
  else if (goal === 'force') reasons.push('4 semaines : en force, l\'intensité monte vite, la décharge doit revenir tôt pour protéger les articulations');
  else if (goal === 'sante') { weeks = 5; reasons.push('5 semaines : progression lente et régulière, sans précipiter la montée en charge'); }
  else reasons.push('4 semaines : calibrage, montée, intensification, décharge');
  // Orientation : rotation par blocs, décalée par le vécu.
  const FOCUS = ['accumulation', 'intensification', 'realisation'];
  let focus = level === 'debutant' ? 'accumulation' : FOCUS[(n - 1) % 3];
  if (rv && rv.done) {
    if (rv.readiness != null && rv.readiness < 2.8) { weeks = Math.max(3, weeks - 1); focus = 'accumulation'; reasons.push(`forme basse aux points du lundi (${rv.readiness}/5) : cycle raccourci à ${weeks} semaines et volume modéré avant de réintensifier`); }
    if (rv.adherence < 60) { weeks = 3; focus = 'accumulation'; reasons.push(`assiduité ${rv.adherence} % : cycle court de 3 semaines pour reprendre le rythme`); }
    if (rv.adherence >= 85 && rv.progress != null && rv.progress >= 5 && (rv.readiness == null || rv.readiness >= 3.5) && level !== 'debutant' && weeks < 6) { weeks += 1; reasons.push(`assidu et en progression (+${rv.progress} %) : une semaine de plus pour capitaliser avant la décharge`); }
    if (rv.failShare != null && rv.failShare >= 40) { focus = 'accumulation'; reasons.push('trop de séries à l\'échec : bloc de volume à RIR plus haut avant de reforcer'); }
    if (rv.adherence >= 85 && rv.progress != null && rv.progress < 2 && focus === 'accumulation' && n > 1) { focus = 'intensification'; reasons.push('charges stables malgré l\'assiduité : on passe en intensification, moins de séries, plus lourd'); }
    if (Object.keys(rv.pain || {}).length) { focus = focus === 'realisation' ? 'intensification' : focus; reasons.push('douleurs signalées : pas de bloc de réalisation tant que la zone n\'est pas calme'); }
  }
  if (age >= 50 && weeks > 5) { weeks = 5; reasons.push('après 50 ans, la récupération impose une décharge au plus tard en semaine 5'); }
  if (s.activity === 'physique' && weeks > 5) { weeks = 5; reasons.push('journées physiques ou horaires décalés : la récupération est déjà entamée par le travail, décharge au plus tard en semaine 5'); }
  if (/garde|astreinte|24 ?h|nuit/i.test(String(s.sportsNote || '') + ' ' + String(s.jobNote || '') + ' ' + String(p.sports || p.constraints || '')) && weeks > 4) { weeks = 4; reasons.push('gardes et nuits : cycle de 4 semaines, la fatigue de service s\'ajoute à celle de l\'entraînement'); }
  const FOCUS_FR = { accumulation: 'Accumulation', intensification: 'Intensification', realisation: 'Réalisation' };
  const focusWhy = { accumulation: 'volume en hausse, répétitions moyennes, deux répétitions en réserve : on construit la capacité', intensification: 'moins de séries, plus lourd, une répétition en réserve : on transforme le volume en force', realisation: 'volume réduit, charges maximales propres, test en fin de cycle : on mesure ce que les deux blocs ont construit' }[focus];
  reasons.push(`bloc ${FOCUS_FR[focus].toLowerCase()} (${n > 1 ? 'cycle ' + n : 'premier cycle'}) : ${focusWhy}`);
  const adjust = { accumulation: { volume: 1.1, rir: 1 }, intensification: { volume: 0.9, rir: -1 }, realisation: { volume: 0.8, rir: -1, test: true } }[focus];
  return { weeks, focus, focusLabel: FOCUS_FR[focus], reasons, adjust };
}
// Réparation déterministe (filet) : un exercice qui viole une règle bloquante est remplacé par une fiche sûre du même schéma.
function exViolations(e, profile) {
  const p = profile || {}; const gear = p.gear || []; const sp = p.spec || {}; const out = [];
  if (gear.length && !gear.includes('salle') && isMachineEx(e)) out.push('machine sans salle');
  if ((sp.refuse || []).includes('nomachine') && isMachineEx(e)) out.push('refus machines');
  if ((sp.refuse || []).includes('nobar') && /\bbarre\b|barbell|olympique/i.test((e.name || '') + ' ' + (e.machine || '')) && !/traction|pull|dip/i.test(e.name || '')) out.push('refus barre');
  (sp.zones || []).forEach(z => { if (z.sev !== 'opere' && z.sev !== 'douleur') return; const lib = e.exId && LIB.BY_ID[e.exId]; if (lib) { if ((lib.zones || []).includes(z.zone) && !LIB.rehabOk(lib, sp.zones)) out.push('zone ' + (ZONE_FR[z.zone] || z.zone)); return; } const m = CONSTRAINT_MAP.find(([cre]) => cre.test(ZONE_FR[z.zone] || z.zone)); if (m && m[1].test(e.name || '')) out.push('zone ' + (ZONE_FR[z.zone] || z.zone)); });
  return out;
}
function repairProgram(prog, profile, plan) {
  const notes = []; const gear = LIB.availableGear(profile);
  prog.sessions.forEach(se => se.exercises.forEach(e => {
    const v = exViolations(e, profile); if (!v.length) return;
    const used = new Set(se.exercises.map(x => x.exId));
    const ok = x => !used.has(x.id) && LIB.allowed(x, profile, (profile || {}).level, gear) && !exViolations({ exId: x.id, name: x.name, machine: x.machine }, profile).length;
    const cands = LIB.EXERCISES.filter(x => x.pattern === e.pattern && ok(x)).concat(LIB.EXERCISES.filter(x => x.pattern === 'core' && ok(x)));
    const pick = cands[0]; if (!pick) return;
    notes.push(`${se.name} : « ${e.name} » remplacé par « ${pick.name} » (${v.join(', ')})`);
    Object.assign(e, { exId: pick.id, name: pick.name, machine: pick.machine || '', alt: '', altId: '', reco: pick.reco || '', why: pick.why || '', target: pick.target || '', exec: pick.exec || '', seek: pick.seek || '', pattern: pick.pattern, url: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(pick.machine || pick.name) });
    if (prog.demos) { if (pick.illus && ILLUS_IDS.includes(pick.illus)) prog.demos[e.id] = pick.illus; else delete prog.demos[e.id]; }
  }));
  if (notes.length) { prog.engine = prog.engine || {}; prog.engine.repairs = notes; }
  return prog;
}
/* Continuité entre cycles : chaque exercice déjà travaillé reçoit sa référence de départ (dernière séance hors décharge) ;
   sans charge, la fourchette de répétitions repart de ce qui a été atteint ; la semaine 1 devient une reprise, pas un recalibrage. */
function applyRefs(prog, refs, cycleN) {
  const R = refs || {}; let carried = 0;
  prog.sessions.forEach(se => se.exercises.forEach(e => {
    const r = e.exId && R[e.exId]; if (!r || e.timed || e.pattern === 'cond') return;
    e.ref = { w: r.w || 0, r: r.r, e1: r.e1 || null, reps: r.reps || null, date: r.date };
    const d = r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
    if (r.w) e.startNote = `Repart de ${r.w} kg × ${r.r}${d ? ' (' + d + ')' : ''} : même charge en semaine 1, puis progression.`;
    else if (r.reps && /^\d+-\d+$/.test(String(e.reps))) {
      const [lo, hi] = String(e.reps).split('-').map(Number);
      if (r.reps >= hi && hi >= 8 && !/lest/i.test(e.name)) { const nlo = Math.max(lo, r.reps - 4), nhi = r.reps + 2; e.reps = `${nlo}-${nhi}`; e.setsText = `${e.sets} × ${e.reps}`; }
      e.startNote = `Dernière fois : ${r.reps} répétitions${d ? ' (' + d + ')' : ''}. La fourchette repart de là.`;
    }
    carried++;
  }));
  prog.refsCarried = carried;
  if (cycleN > 1 && prog.weeks && prog.weeks[0]) {
    prog.weeks[0].label = 'S1 reprise'; prog.weeks[0].rirNote = 'RIR 2 · tu repars de tes dernières références, pas de recalibrage' + (carried ? ` (${carried} exercices repris avec leur charge)` : '');
    if (prog.promise) prog.promise.baselineRule = 'Semaine 1 = reprise : tu repars des charges et répétitions du cycle précédent, la progression continue sans recalibrage.';
  }
  return prog;
}
async function buildProgram(profile, apiKey, model, seed, review) {
  // 1. Le moteur construit le programme complet, instantanément, sans dépendance : structure, exercices de la bibliothèque, textes de fiche, illustrations.
  const cycleN = review && review.done ? ((profile || {}).cycleCount || 2) : 1;
  const design = cycleDesign(profile, review, cycleN);
  const adj = Object.assign({ volume: 1, rir: 0, favor: [], avoid: [], zones: [], level: null, reasons: [] }, review && review.adjust ? review.adjust : {});
  adj.volume = Math.round(100 * (adj.volume || 1) * design.adjust.volume) / 100; adj.rir = (adj.rir || 0) + design.adjust.rir;
  if (review && review.pullMax) adj.pullMax = review.pullMax;
  const plan = LIB.selectExercises(planStructure(profile, adj), profile, seed);
  const start = nextMonday();
  let prog = programFromPlan(plan, profile, start, design.weeks);
  applyRefs(prog, review && review.refs, cycleN);
  prog.cycleDesign = { weeks: design.weeks, focus: design.focus, focusLabel: design.focusLabel, reasons: design.reasons, testAtEnd: !!design.adjust.test };
  prog.cycleName = String(prog.cycleName || 'Mésocycle').replace(/ · ([^·]+) · /, ' · $1 · ' + design.focusLabel + ' · ');
  prog.cycleReason = (review && review.done ? review.summary + ' ' : '') + 'Ce cycle : ' + design.reasons.join(' ; ') + '.';
  if (prog.refsCarried) prog.cycleReason += ` Continuité : ${prog.refsCarried} exercices repartent de ta dernière séance (charges et répétitions), la semaine 1 est une reprise, pas un recalibrage.`;
  if (review) prog.cycleReview = review;
  const numberCycle = pg => { if (cycleN > 1) pg.cycleName = String(pg.cycleName || 'Mésocycle').replace(/^Mésocycle[^·]*/, 'Mésocycle ' + cycleN + ' ').replace(/\s+·/, ' ·').trim(); return pg; };
  numberCycle(prog);
  let check = checkProgram(prog, profile);
  if (check.errors.length) { repairProgram(prog, profile, plan); check = checkProgram(prog, profile); }
  prog.checks = { errors: check.errors, warnings: check.warnings, attempts: 0, at: Date.now(), repaired: !!(prog.engine && prog.engine.repairs && prog.engine.repairs.length) };
  if (check.errors.length) prog.engine.unresolved = check.errors;
  // 2. Le coach rédige (rationale, nutrition, échauffement, notes). Borné dans le temps ; s'il échoue, le programme est livré sans ses textes et complété plus tard.
  const sys = systemFor(profile, null);
  const pr = profile || {};
  const user = `Construis les textes du mésocycle de cet athlète (départ le ${start}). Sois concret et exigeant au niveau déclaré. Le programme doit être visiblement écrit pour ${pr.name || 'cette personne'} : relie chaque choix à ses objectifs (${(pr.goals || []).join(', ') || 'non précisés'}), son niveau (${pr.level || '?'}), son matériel, ses contraintes et ses autres pratiques.${(pr.spec && pr.spec.wishes) ? '\n\nDemande explicite de l\'athlète (à prendre en compte dans le rationale et les notes) : « ' + String(pr.spec.wishes).slice(0, 500) + ' »' : ''}${review && review.done ? '\n\nBilan mesuré du cycle précédent (à commenter dans le rationale, chiffres à reprendre tels quels) : ' + review.summary : ''}\n\n${skeletonText(plan, profile)}\n\n${COACH_TEXT_SCHEMA}`;
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await claude(apiKey, model, sys, [{ role: 'user', content: user }], 3500, attempt === 1 ? 120000 : 90000);
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      mergeCoachTexts(prog, parsed); numberCycle(prog); prog.degraded = null; prog.checks.attempts = attempt; return prog;
    } catch (e) { lastErr = String(e && e.message || e); if (/401|refusée/.test(lastErr)) throw e; }
  }
  prog.degraded = 'coach'; prog.engine.notes.push('textes du coach indisponibles : ' + lastErr.slice(0, 160)); prog.checks.attempts = 2;
  return prog;
}
// Complément différé : un programme livré sans les textes du coach les reçoit dès qu'il répond (appel suivant ou tâche planifiée).
async function completeCoachTexts(uid, prog, profile, apiKey, model) {
  const plan = LIB.selectExercises(planStructure(profile), profile, uid);
  const sys = systemFor(profile, null); const pr = profile || {};
  const user = `Rédige les textes du programme de cet athlète. ${skeletonText(plan, profile)}\n\n${COACH_TEXT_SCHEMA}`;
  const text = await claude(apiKey, model, sys, [{ role: 'user', content: user }], 3500, 120000);
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  mergeCoachTexts(prog, parsed); prog.degraded = null; prog.engine = prog.engine || {}; prog.engine.completedAt = Date.now();
  await db.collection('users').doc(uid).collection('meta').doc('program').set({ rationale: prog.rationale, nutrition: prog.nutrition, warmup: prog.warmup, cycleName: prog.cycleName, sessions: prog.sessions, degraded: null, engine: prog.engine }, { merge: true });
  await recordUsage(uid, 'program', model);
  return prog;
}
async function generateProgramFor(uid, meta, apiKey, model) {
  const genRef = db.collection('users').doc(uid).collection('meta').doc('genstate');
    let prog;
    let review = null;
    try {
      const prev = meta.program && meta.program.generatedAt ? meta.program : null;
      if (prev) { const from = '2000-01-01'; const ls = await db.collection('users').doc(uid).collection('logs').where('date', '>=', from).get(); const cs = await db.collection('users').doc(uid).collection('checkins').get().catch(() => ({ docs: [] })); const ts = await db.collection('users').doc(uid).collection('tests').get().catch(() => ({ docs: [] })); const bs = await db.collection('users').doc(uid).collection('bw').get().catch(() => ({ docs: [] })); const tests = ts.docs.map(d => d.data()); review = reviewCycle(prev, ls.docs.map(d => d.data()), cs.docs.map(d => d.data()), meta.profile, { tests, bw: bs.docs.map(d => d.data()) }); if (review && review.done) meta.profile.cycleCount = (prev.cycleCount || 1) + 1;
        // continuité : références par fiche (dernière séance hors décharge) et meilleur test de tractions, transmis au cycle suivant
        const hist = (await db.collection('users').doc(uid).collection('meta').doc('history').get().catch(() => null)); const hc = hist && hist.exists ? (hist.data().cycles || []) : [];
        if (review) { review.refs = buildRefs(prev, ls.docs.map(d => d.data()), hc); const tm = tests.filter(t => t && t.reps).sort((a, b) => a.date < b.date ? 1 : -1); if (tm.length) review.pullMax = Math.max(Number(tm[0].reps) || 0, tm.length > 1 ? Number(tm[1].reps) || 0 : 0); } }
    } catch (e) { review = null; if (process.env.RITUEL_TEST === '1') console.error('review error', e); }
    try { prog = await buildProgram(meta.profile, apiKey, model, uid, review); if (meta.profile.cycleCount) prog.cycleCount = meta.profile.cycleCount; }
    catch (e) { await refundQuota(uid, 'program'); throw e; } // un échec ne consomme pas une génération
    // Historique des cycles : le programme remplacé est archivé (dates, exercices par identifiant, bilan) pour que la progression reste lisible d'un cycle à l'autre.
    try { const prev = meta.program && meta.program.generatedAt ? meta.program : null; if (prev) { const hRef = db.collection('users').doc(uid).collection('meta').doc('history'); const h = (await hRef.get()).data() || { cycles: [] }; const exMap = {}; (prev.sessions || []).forEach(se => (se.exercises || []).forEach(e => { exMap[e.id] = { exId: e.exId || null, name: e.name, star: !!e.star }; })); const entry = { cycleName: prev.cycleName || '', generatedAt: prev.generatedAt, from: prev.weeks && prev.weeks[0] ? prev.weeks[0].from : null, to: prev.weeks && prev.weeks.length ? prev.weeks[prev.weeks.length - 1].to : null, weeks: (prev.weeks || []).length, sessions: (prev.sessions || []).map(se => ({ id: se.id, name: se.name, day: se.day })), exMap, review: review ? { adherence: review.adherence, done: review.done, planned: review.planned, progress: review.progress, readiness: review.readiness, prs: review.prs || 0, tests: review.tests || null, weight: review.weight || null, summary: review.summary } : null, design: prev.cycleDesign || null, promise: prev.promise ? { label: prev.promise.label, target: prev.promise.target, metric: prev.promise.metric } : null }; const cycles = (h.cycles || []).filter(c => c.generatedAt !== prev.generatedAt).concat([entry]).slice(-24); await hRef.set({ cycles, updatedAt: Date.now() }); } } catch (e) { console.error('history', e && e.message || e); }
    prog.generatedAt = Date.now(); prog.model = model; prog.profileSnapshot = meta.profile;
    await touchActive(uid, { hasProgram: true, pending: prog.degraded === 'coach', generatedAt: prog.generatedAt });
    await recordUsage(uid, 'program', model);
    // Le programme est livré d'abord ; les visuels sont associés ensuite et ne peuvent pas bloquer la livraison.
    await db.collection('users').doc(uid).collection('meta').doc('program').set(prog);
    await genRef.set({ status: 'done', at: Date.now() });
    // Les illustrations viennent de la bibliothèque (exactes par construction) ; un exercice sans fiche illustrée garde le repli « geste proche » côté client.
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
  const meta = await loadMeta(uid);
  if (!meta.profile) throw new HttpsError('failed-precondition', 'Profil manquant.');
  // Le premier programme d'un compte, ou le remplacement d'un programme « moteur seul », ne compte jamais dans le quota :
  // personne ne doit rester sans programme. L'association des visuels ne consomme rien non plus.
  const firstProgram = mode === 'program' && !(meta.program && meta.program.generatedAt && !meta.program.degraded);
  if (mode !== 'demo') await checkQuota(uid, mode, plan, firstProgram);
  // Nettoyage : un secret collé depuis Windows peut contenir BOM, octets nuls, retours à la ligne ou guillemets.
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
  if (!/^sk-ant-/.test(apiKey)) throw new HttpsError('failed-precondition', 'Clé API Anthropic absente ou mal formée côté serveur (doit commencer par sk-ant-).');
  const model = await resolveModel(apiKey, MODEL.value());

  if (mode === 'program') {
    await genRef.set({ status: 'running', startedAt: Date.now() });
    try { return await generateProgramFor(uid, meta, apiKey, model); }
    catch (e) { await genRef.set({ status: 'error', message: String(e && e.message || e).slice(0, 300), at: Date.now() }); throw e; }
  }

  const prog = meta.program || { cycleName: '', weeks: [], sessions: [] }; // sans programme généré : contexte vide, jamais le programme embarqué d'un autre profil
  const context = await loadContext(uid, prog);
  const idx = exerciseIndex(prog);
  // Repères temporels explicites : date du jour (Paris), séances faites sur 7 jours, semaine effective du cycle.
  const today = parisISO(); const dayName = new Date().toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  const weekLogs = await db.collection('users').doc(uid).collection('logs').where('date', '>=', isoDaysAgo(7)).get();
  const doneWeek = weekLogs.docs.map(d => d.data()).filter(l => isDone(l, today));
  const weeksDone = await weekIndexDone(uid, prog);
  const SYSTEM = systemFor(meta.profile, prog) + `\n\nRepères : aujourd'hui ${dayName} ${today}. Séances validées sur les 7 derniers jours : ${doneWeek.length} (${doneWeek.map(l => l.date + ' ' + ((prog.sessions.find(s => s.id === l.session) || {}).name || l.session)).join(', ') || 'aucune'}). Semaine du cycle en cours : S${Math.max(1, parseInt((typeof req !== 'undefined' && req && req.data ? req.data.week : 0)) || weeksDone || 1)} sur ${(prog.weeks || []).length || 4} (référence pour l'intention RIR, ne la recalcule pas). Une séance d'un jour passé avec des séries enregistrées compte comme faite même si elle n'a pas été « terminée » dans l'app.`;
  const programSummary = prog.sessions.map(s => `${s.name} (${s.id}) : ` + s.exercises.map(e => `${e.id} ${e.name} ${e.setsText || ''}`).join(' ; ')).join('\n');

  if (mode === 'analyse') {
    const logKey = String(req.data.logKey || '');
    const snap = await db.collection('users').doc(uid).collection('logs').doc(logKey).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Séance introuvable.');
    const log = snap.data();
    const sessionName = (prog.sessions.find(s => s.id === log.session) || {}).name || log.session;
    const doneSets = Object.values(log.sets || {}).flat().filter(s => s && s.done).length;
    if (!doneSets) throw new HttpsError('failed-precondition', 'Aucune série enregistrée pour cette séance : rien à analyser.');
    const guide = `Consignes d'analyse. Tu es le coach de cet athlète, pas un rapport automatique : tu lis la séance comme un préparateur physique qui connaît son histoire. Exercice sauté : il l'a décidé, tu ne le comptes pas comme un manque de données, tu demandes seulement pourquoi si ça se répète. Charge aberrante d'une séance à l'autre (écart > 30 % sur le même exercice) : tu ne la juges pas, tu la fais confirmer dans « questions » (unité, machine différente, erreur de saisie) et tu neutralises cet exercice dans tes décisions. Compare chaque exercice à sa prescription et à la dernière référence (charge, reps, RIR). Si l'athlète écrit que c'était facile, ou si les reps dépassent le haut de fourchette au RIR prescrit, tu augmentes la charge (règle : +2,5 % quand le haut de fourchette est atteint partout, +5 % si la note dit "facile" et que les RIR déclarés sont ≥ 3) et tu le dis exercice par exercice. Si une charge manque, tu le signales et tu demandes de la noter. Tu ne fais pas de généralités : chaque phrase s'appuie sur une donnée de la séance ou de l'historique. Tu livres des conclusions, pas ton raisonnement : pas de « attention », « en fait », « donc » en cascade, pas d'auto-correction. Attention aux fourchettes : 12 reps sur 12-15 est le bas de la fourchette. Propose un ajustement pour chaque exercice où les données le justifient. Style : phrases de 15 mots maximum, une idée par phrase, chiffres précis, aucun jargon sans le chiffre qui va avec ; l'athlète doit comprendre chaque phrase en une lecture, sur un téléphone, entre deux séries.`;
    const prevSnap = await db.collection('users').doc(uid).collection('logs').orderBy('date', 'desc').limit(40).get().catch(() => ({ docs: [] }));
    const prevLogs = prevSnap.docs.map(d => d.data()).filter(l => l.session === log.session && l.date < log.date).slice(0, 4);
    const week = Math.max(1, parseInt(req.data.week) || log.week || 1); log.week = week;
    const facts = computeFacts(log, prevLogs, idx, week);
    const user = `Programme :\n${programSummary}\n\n${context}\n\n## Séance à analyser\n${log.date} · ${sessionName} · S${log.week}${log.done ? '' : ' (non terminée)'}\n${fmtLog(log, idx)}${log.notes ? '\nNote de l\'athlète : ' + log.notes : ''}\n\n## Faits calculés (fiables, à utiliser tels quels, ne recalcule pas)\n${facts || '(aucun)'}\n\n${guide}`;
    const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], ANALYSIS_SCHEMA, 3500);
    parsed.exercises = (parsed.exercises || []).filter(e => e && idx[e.exId]).map(e => ({ exId: e.exId, name: idx[e.exId].name, done: String(e.done || ''), read: String(e.read || ''), status: ['ok', 'up', 'hold', 'warn'].includes(e.status) ? e.status : 'ok' }));
    parsed.analysis = String(parsed.verdict || ''); parsed.headline = String(parsed.headline || '').slice(0, 80); parsed.tone = ['good', 'ok', 'warn'].includes(parsed.tone) ? parsed.tone : 'ok'; parsed.takeaways = (Array.isArray(parsed.takeaways) ? parsed.takeaways : []).map(String).filter(Boolean).slice(0, 3); parsed.lesson = String(parsed.lesson || '').slice(0, 300);
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
    const sys = `${SYSTEM}\n\nProgramme :\n${programSummary}\n\n${context}\n\nSemaine en cours : S${req.data.week || '?'}. Réponds en moins de 200 mots sauf si la question demande un plan détaillé, et termine toujours ta réponse : jamais de phrase coupée. Important : tu ne peux pas modifier le programme depuis cette conversation. Si l'athlète veut changer la répartition des séances, ajouter ou retirer des exercices, ou refaire le cycle, dis-le clairement et renvoie-le vers l'onglet Programme, bouton « Ajuster mon programme » (répartition bas/haut, exercices voulus ou à éviter, abdos en fin de séance, message au coach) ; le nouveau programme se construit immédiatement. Pour noter une charge de départ : fiche de l'exercice, champ « Ma charge habituelle ».`;
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
function isDone(l, today) { if (!l) return false; const hasSet = Object.values(l.sets || {}).some(arr => (arr || []).some(x => x && x.done)); return !!((l.done && hasSet) || (hasSet && l.date < (today || parisISO()))); }
// Index des comptes actifs : un document par utilisateur, écrit par le serveur seul (génération, appels au coach, séances enregistrées).
// Les tâches planifiées lisent cet index au lieu de parcourir tous les comptes : coût et durée proportionnels aux actifs, pas aux inscrits.
async function touchActive(uid, patch) { try { await db.collection('active').doc(uid).set(Object.assign({ uid, lastActiveAt: Date.now() }, patch || {}), { merge: true }); } catch (e) {} }
exports.onLogWritten = onDocumentWritten({ document: 'users/{uid}/logs/{logId}', region: 'europe-west1' }, async (event) => { const uid = event.params.uid; await touchActive(uid, { lastActiveAt: Date.now() }); });
async function activeUsersIndexed(days) {
  const since = Date.now() - (days || 45) * 86400000;
  const snap = await db.collection('active').where('hasProgram', '==', true).where('lastActiveAt', '>=', since).get();
  return snap.docs.map(d => d.id);
}
async function activeUsers() {
  // Index présent : on l'utilise. Index vide (déploiement récent, avant réindexation) : parcours complet, comme avant.
  const probe = await db.collection('active').limit(1).get();
  if (!probe.empty) return activeUsersIndexed(45);
  return activeUsersFull();
}
async function activeUsersFull() {
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
  // Alerte plantages : plus de 20 erreurs ou plus de 5 comptes touchés dans l'heure → notification à l'administrateur (une fois par 6 h).
  try { const errs = await db.collection('errors').where('t', '>=', Date.now() - 3600000).limit(500).get(); const users = new Set(errs.docs.map(d => d.data().uid)); if ((errs.size > 20 || users.size > 5) && Date.now() - (prev.errNotifiedAt || 0) > 6 * 3600000) { for (const email of ADMIN_EMAILS) { try { const u = await admin.auth().getUserByEmail(email); await sendPush(u.uid, 'Pic d\'erreurs dans l\'app', `${errs.size} erreurs chez ${users.size} compte(s) sur la dernière heure. Voir Administration.`, { tab: 'reglages' }); } catch (e) {} } await ref.set({ errNotifiedAt: Date.now() }, { merge: true }); } } catch (e) {}
  if (ok !== !!prev.ok || (!ok && Date.now() - (prev.notifiedAt || 0) > 6 * 3600000)) {
    for (const email of ADMIN_EMAILS) { try { const u = await admin.auth().getUserByEmail(email); await sendPush(u.uid, ok ? 'Kai est de retour' : 'Kai est hors service', ok ? 'La clé API répond à nouveau.' : 'Clé API : ' + msg + '. Régénère-la et enregistre-la (functions:secrets:set).', { tab: 'reglages' }); } catch (e) {} }
    await ref.set({ notifiedAt: Date.now() }, { merge: true });
  }
  console.log(`[health] ${ok ? 'ok' : 'KO'} ${status} ${msg}`);
});

exports.weeklyReview = onSchedule({ schedule: '0,30 19-22 * * 0', timeZone: 'Europe/Paris', region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '1GiB' }, async () => {
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '');
  const model = await resolveModel(apiKey, MODEL.value());
  const since = isoDaysAgo(7); const weekId = 'week-' + parisISO();
  // Plusieurs passages le dimanche soir : chaque passage reprend là où le précédent s'est arrêté (curseur), s'arrête avant le délai, et ne traite jamais deux fois le même compte dans la semaine.
  const stRef = db.collection('system').doc('weeklyReview'); const st = (await stRef.get()).data() || {};
  const all = (await activeUsers()).sort(); const start = st.weekId === weekId && st.cursor ? all.indexOf(st.cursor) + 1 : 0;
  if (st.weekId === weekId && st.done) return;
  const t0 = Date.now(); let last = st.weekId === weekId ? st.cursor : null; let n = 0;
  for (const uid of all.slice(start)) {
    if (Date.now() - t0 > 420000) break;
    last = uid; n++;
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
      const user = `Programme :\n${programSummary}\n\n${context}\n\n## Bilan de la semaine écoulée (${since} → aujourd'hui)\nSéances validées cette semaine : ${done.length} sur ${prog.sessions.length} prévues. Semaine du cycle en cours : S${Math.max(1, parseInt((typeof req !== 'undefined' && req && req.data ? req.data.week : 0)) || weeksDone || 1)} sur ${(prog.weeks || []).length || 4} (référence pour l'intention RIR, ne la recalcule pas).\nRédige le bilan hebdomadaire : conclusions seulement, chiffres à l'appui, pas de généralités. ${weeksDone >= ((prog.weeks || []).length || 4) ? 'Le mésocycle est terminé : dis-le clairement et annonce que le cycle suivant peut être généré.' : ''}`;
      const parsed = await claudeJSON(apiKey, model, SYSTEM, [{ role: 'user', content: user }], WEEK_SCHEMA, 1800);
      const cost = await recordUsage(uid, 'analyse', model);
      const cycleEnd = weeksDone >= ((prog.weeks || []).length || 4);
      await coachRef.doc(weekId).set({ type: cycleEnd ? 'cycleEnd' : 'bilan', title: parsed.title, analysis: parsed.verdict, highlights: parsed.highlights || [], nextWeek: parsed.nextWeek || '', alerts: parsed.alerts || [], createdAt: Date.now(), applied: true, model, costUsd: cost });
      await sendPush(uid, cycleEnd ? 'Cycle terminé' : (parsed.title || 'Bilan de la semaine'), String(parsed.verdict || '').slice(0, 140), { tab: 'coach' });
    } catch (e) { console.error('weeklyReview', uid, e.message || e); }
  }
  const finished = start + n >= all.length;
  await stRef.set({ weekId, cursor: last || null, done: finished, processed: (st.weekId === weekId ? (st.processed || 0) : 0) + n, total: all.length, at: Date.now() }, { merge: true });
});
// File de rattrapage : toutes les 20 minutes, les programmes livrés sans les textes du coach sont complétés. Reprise automatique, bornée.
exports.coachBacklog = onSchedule({ schedule: '*/20 * * * *', timeZone: 'Europe/Paris', region: 'europe-west1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').replace(/[^\x21-\x7E]/g, '').replace(/^["']+|["']+$/g, '');
  if (!/^sk-ant-/.test(apiKey)) return;
  const model = await resolveModel(apiKey, MODEL.value()); const t0 = Date.now(); let done = 0, failed = 0;
  const pend = await db.collection('active').where('pending', '==', true).limit(200).get();
  const refs = pend.empty ? await db.collection('users').listDocuments() : pend.docs.map(d => db.collection('users').doc(d.id)); // sans index : parcours complet comme avant
  for (const u of refs) {
    if (Date.now() - t0 > 420000) break;
    const pg = await u.collection('meta').doc('program').get(); if (!pg.exists) { await touchActive(u.id, { pending: false }); continue; }
    const prog = pg.data(); if (prog.degraded !== 'coach' || !prog.generatedAt) { await touchActive(u.id, { pending: false }); continue; }
    const attempts = (prog.engine && prog.engine.backlogAttempts) || 0; if (attempts >= 6) { await touchActive(u.id, { pending: false }); continue; }
    const pf = await u.collection('meta').doc('profile').get(); if (!pf.exists) continue;
    try { await completeCoachTexts(u.id, prog, pf.data(), apiKey, model); done++; await touchActive(u.id, { pending: false }); }
    catch (e) { failed++; await u.collection('meta').doc('program').set({ engine: Object.assign({}, prog.engine || {}, { backlogAttempts: attempts + 1, backlogError: String(e && e.message || e).slice(0, 160) }) }, { merge: true }); }
  }
  if (done || failed) await db.collection('system').doc('backlog').set({ at: Date.now(), done, failed }, { merge: true });
});
exports.dailyNudge = onSchedule({ schedule: '0 18 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
  const cutoff = isoDaysAgo(3);
  for (const uid of await activeUsers()) {
    try {
      const base = db.collection('users').doc(uid);
      const last = await base.collection('logs').where('date', '>=', cutoff).get();
      // Transparence : rappel trois jours avant un renouvellement d'abonnement (une fois par échéance).
      try { const bd = (await base.collection('meta').doc('billing').get()).data() || {}; if (bd.plan === 'premium' && bd.store && bd.expiresAt && !bd.cancelledAt && bd.expiresAt - Date.now() < 3 * 86400000 && bd.expiresAt > Date.now() && bd.remindedFor !== bd.expiresAt) { await sendPush(uid, 'Rituel Premium', `Ton abonnement se renouvelle le ${new Date(bd.expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}. Tu peux le gérer ou le résilier depuis Profil → Forfait.`); await base.collection('meta').doc('billing').set({ remindedFor: bd.expiresAt }, { merge: true }); } } catch (e) {}
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

// Banc d'essai local uniquement (jamais exposé en production) : accès au moteur pur pour tester des milliers de profils sans appel réseau.
if (process.env.RITUEL_TEST === '1') exports._engine = { planStructure, programFromPlan, checkProgram, repairProgram, reviewCycle, goalPatterns, cycleDesign, buildRefs, applyRefs, LIB, LEVEL_CAPS };
