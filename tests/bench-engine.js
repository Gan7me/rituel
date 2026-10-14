/* Banc d'essai du moteur : des milliers de fiches synthétiques (objectifs × matériel × jours × durée × niveau × zones × refus)
   passent par planStructure → sélection bibliothèque → programme → contrôle de conformité, sans aucun appel réseau.
   Un seul profil non conforme fait échouer le banc. Usage : node tests/bench-engine.js */
const path = require('path'); const Module = require('module');
process.env.RITUEL_TEST = '1';
const fakeAdmin = { initializeApp() {}, firestore: Object.assign(() => ({}), { FieldValue: {} }), auth: () => ({}) };
const origLoad = Module._load;
Module._load = function (req) { if (req === 'firebase-admin') return fakeAdmin; if (req === 'firebase-functions/v2/https') return { HttpsError: class extends Error {}, onCall: (o, f) => f || o, onRequest: (o, f) => f }; if (req === 'firebase-functions/v2/scheduler') return { onSchedule: (o, f) => f }; if (req === 'firebase-functions/params') return { defineSecret: () => ({ value: () => '' }), defineString: () => ({ value: () => 'auto' }) }; return origLoad.apply(this, arguments); };
const { _engine: E } = require(path.join(__dirname, '..', 'functions', 'index.js'));
const { planStructure, programFromPlan, checkProgram, repairProgram, LIB, LEVEL_CAPS } = E;

const GOALS = ['force', 'masse', 'perte', 'sante', 'perf', 'corps'];
const GEARS = [
  { place: 'salle', gymGear: ['machines', 'poulies', 'barres', 'halteres', 'traction', 'rack', 'presse', 'hack', 'cardio'] },
  { place: 'salle', gymGear: ['machines', 'poulies', 'halteres'] },
  { place: 'salle', gymGear: ['barres', 'rack', 'halteres', 'traction'] },
  { place: 'maison', homeGear: ['halteres', 'banc'] },
  { place: 'maison', homeGear: ['elastiques'] },
  { place: 'maison', homeGear: ['corps'] },
  { place: 'maison', homeGear: ['kettlebell', 'traction'] },
  { place: 'deux', gymGear: ['machines', 'poulies'], homeGear: ['halteres', 'elastiques'] },
  { place: 'maison', homeGear: ['trx', 'barre'] }
];
const LEVELS = [['0', ['none']], ['1', ['none']], ['2', ['pull10', 'squat']], ['3', ['pull10', 'squat', 'dl']]];
const ZONES = ['epaule', 'coude', 'poignet', 'dos', 'hanche', 'genou', 'cheville', 'cou'];
const SEVS = ['fragile', 'douleur', 'opere'];
const REFUSES = [[], ['nobar'], ['nomachine'], ['cardio', 'burpees'], ['nobar', 'nomachine']];
const DAYS = [[0, 2], [0, 2, 4], [0, 1, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5]];
const MIN = [30, 45, 60, 90];
function ivLevel(y, sk) { const n = sk.filter(x => x !== 'none').length; if (y === '0' || (y === '1' && n === 0)) return 'debutant'; if (y === '3' && n === 3) return 'avance'; if ((y === '3' && n >= 1) || (y === '2' && n >= 2)) return 'confirme'; return 'intermediaire'; }
function ivGear(s) { const g = new Set(); if (s.place !== 'maison') { g.add('salle'); } if (s.place !== 'salle') (s.homeGear || []).forEach(h => { if (h !== 'banc') g.add(h); }); if (!g.size) g.add('corps'); return [...g]; }
const profiles = [];
let i = 0;
GOALS.forEach(goal => GEARS.forEach(gear => DAYS.forEach(days => {
  const zoneSets = [[]].concat(ZONES.map(z => [{ zone: z, sev: SEVS[i++ % 3] }]));
  zoneSets.forEach(zones => {
    const lv = LEVELS[i++ % LEVELS.length]; const refuse = REFUSES[i++ % REFUSES.length]; const minutes = MIN[i++ % MIN.length];
    const SECONDS = [null, 'tractions', 'jambes', 'bras', 'fessiers', 'seche', 'endurance', 'puissance', 'cardio', 'silhouette']; const SPORTS = [[], ['Course'], ['Escalade'], ['Natation'], ['Rugby'], ['Vélo']];
    const spec = Object.assign({ goalMain: goal, goalSecond: SECONDS[i % SECONDS.length], sports: SPORTS[i % SPORTS.length], age: 20 + (i % 5) * 10, years: lv[0], skills: lv[1], daysList: days, minutes, zones, refuse, likes: i % 5 === 0 ? ['tractions', 'lourd'] : [], place: gear.place, gymGear: gear.gymGear || [], homeGear: gear.homeGear || [] });
    profiles.push({ name: 'P' + profiles.length, age: spec.age, level: ivLevel(lv[0], lv[1]), goals: [goal], days: days.length, minutes, gear: ivGear(spec), spec });
  });
})));

const banned = z => ({ epaule: /d[ée]velopp[ée].*(militaire|[ée]paule|overhead)|shoulder press|[ée]l[ée]vation|dips?\b|traction|pull[- ]?up|arrach|snatch|upright/i, genou: /squat|fente|lunge|leg ?ext|presse|hack|pendulum|saut|jump|pistol/i })[z];
let fail = 0, n = 0, repaired = 0, subs = 0; const byPattern = {}; const exCount = {};
const t0 = Date.now();
for (const p of profiles) {
  n++;
  const plan = LIB.selectExercises(planStructure(p), p, 'seed' + n);
  const prog = programFromPlan(plan, p, '2026-10-19');
  let check = checkProgram(prog, p);
  if (check.errors.length) { repairProgram(prog, p, plan); check = checkProgram(prog, p); repaired++; }
  const problems = check.errors.slice();
  if (prog.sessions.length !== p.days) problems.push('séances ≠ jours');
  const gear = LIB.availableGear(p); const caps = LEVEL_CAPS[p.level];
  const hard = new Set((p.spec.zones || []).filter(z => z.sev !== 'fragile').map(z => z.zone));
  prog.sessions.forEach(se => {
    const ids = se.exercises.map(e => e.exId); if (new Set(ids).size !== ids.length) problems.push(se.name + ' : exercice en double');
    if (se.exercises.length < 4) problems.push(se.name + ' : moins de 4 exercices');
    if (se.exercises.reduce((a, e) => a + e.sets, 0) > caps.setsPerSession) problems.push(se.name + ' : volume au-dessus du plafond');
    se.exercises.forEach(e => {
      const ex = LIB.BY_ID[e.exId]; if (!ex) { problems.push('exercice inconnu ' + e.exId); return; }
      exCount[ex.id] = (exCount[ex.id] || 0) + 1;
      if (!LIB.hasReq(ex.req, gear)) problems.push(`${ex.name} : matériel absent (${[...gear].join(',')})`);
      if ((ex.zones || []).some(z => hard.has(z))) problems.push(`${ex.name} : zone à ménager ${[...hard].join(',')}`);
      if (p.spec.refuse.includes('nomachine') && ex.tags.includes('machine')) problems.push(ex.name + ' : machine refusée');
      if (p.spec.refuse.includes('nobar') && ex.tags.includes('barre')) problems.push(ex.name + ' : barre refusée');
      if (!e.exec || !e.why || !e.target) problems.push(ex.name + ' : texte de fiche manquant');
      if (e.pattern !== ex.pattern) subs++;
    });
  });
  if (problems.length) { fail++; if (fail <= 12) console.log('✗', p.name, JSON.stringify({ goal: p.goals[0], level: p.level, place: p.spec.place, gym: p.spec.gymGear, home: p.spec.homeGear, days: p.days, min: p.minutes, zones: p.spec.zones, refuse: p.spec.refuse }), '\n   ', problems.slice(0, 4).join(' | ')); }
}
const top = Object.entries(exCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' ');
console.log(`${n} profils en ${Date.now() - t0} ms · ${fail} non conforme(s) · ${repaired} réparé(s) · ${subs} emplacement(s) substitué(s) · exercices distincts utilisés : ${Object.keys(exCount).length}/${LIB.EXERCISES.length}\nles plus utilisés : ${top}`);
process.exit(fail ? 1 : 0);
