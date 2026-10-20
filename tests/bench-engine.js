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
let fail = 0, n = 0, repaired = 0, subs = 0, cycles = 0; const byPattern = {}; const exCount = {};
const t0 = Date.now();
for (const p of profiles) {
  n++;
  const plan = LIB.selectExercises(planStructure(p), p, 'seed' + n);
  const prog = programFromPlan(plan, p, '2026-10-19');
  let check = checkProgram(prog, p);
  if (check.errors.length) { repairProgram(prog, p, plan); check = checkProgram(prog, p); repaired++; }
  const problems = check.errors.slice();
  if (prog.sessions.length !== p.days) problems.push('séances ≠ jours');
  const gear = LIB.availableGear(p); const caps = LEVEL_CAPS[p.level]; const GOAL_PATS = E.goalPatterns ? E.goalPatterns(p) : [];
  const canPull = LIB.EXERCISES.some(x => x.pattern === 'vpull' && LIB.allowed(x, p, p.level, gear));
  const hard = new Set((p.spec.zones || []).filter(z => z.sev !== 'fragile').map(z => z.zone));
  prog.sessions.forEach(se => {
    const ids = se.exercises.map(e => e.exId); if (new Set(ids).size !== ids.length) problems.push(se.name + ' : exercice en double');
    if (se.exercises.length < 4) problems.push(se.name + ' : moins de 4 exercices');
    { const want = Math.min(Math.max(4, Math.min(caps.exPerSession, Math.round(p.minutes / 10))), ({ debutant: 5, intermediaire: 6, confirme: 7, avance: 8 })[p.level]); if (se.exercises.length < want) problems.push(`${se.name} : ${se.exercises.length} exercices pour un ${p.level} à ${p.minutes} min (attendu ≥ ${want})`); }
    if (GOAL_PATS.includes('vpull') && canPull && /Poussée|Tirage|Haut|Corps/.test(se.name) && !se.exercises.some(e => (LIB.BY_ID[e.exId] || {}).pattern === 'vpull')) problems.push(se.name + ' : objectif tractions sans tirage vertical');
    if (se.exercises.reduce((a, e) => a + e.sets, 0) > caps.setsPerSession) problems.push(se.name + ' : volume au-dessus du plafond');
    se.exercises.forEach(e => {
      const ex = LIB.BY_ID[e.exId]; if (!ex) { problems.push('exercice inconnu ' + e.exId); return; }
      exCount[ex.id] = (exCount[ex.id] || 0) + 1;
      if (!LIB.hasReq(ex.req, gear)) problems.push(`${ex.name} : matériel absent (${[...gear].join(',')})`);
      if ((ex.zones || []).some(z => hard.has(z)) && !LIB.rehabOk(ex, p.spec.zones)) problems.push(`${ex.name} : zone à ménager ${[...hard].join(',')}`);
      if ((ex.zones || []).some(z => hard.has(z)) && LIB.rehabOk(ex, p.spec.zones) && !(p.spec.zones || []).some(z => z.sev === 'douleur' && (ex.zones || []).includes(z.zone))) problems.push(`${ex.name} : fiche compatible douleur utilisée sur une zone opérée`);
      if (p.spec.refuse.includes('nomachine') && ex.tags.includes('machine')) problems.push(ex.name + ' : machine refusée');
      if (p.spec.refuse.includes('nobar') && ex.tags.includes('barre')) problems.push(ex.name + ' : barre refusée');
      if (!e.exec || !e.why || !e.target) problems.push(ex.name + ' : texte de fiche manquant');
      if (e.pattern !== ex.pattern) subs++;
    });
  });
  // Cycles suivants : la personne vit le cycle (assidue et progresse / assidue et stagne / absente), le bilan règle le suivant.
  if (!problems.length && E.reviewCycle && E.goalPatterns) {
    prog.generatedAt = Date.parse('2026-10-18T12:00:00Z');
    const isBw = e => /traction|pull-up|dips|pompe|gainage|planche|crunch|relev/i.test(e.name);
    const SCEN = { progresse: { skip: 0, w: (k) => 60 + 2.5 * k, r: 6 }, stagne: { skip: 0, w: () => 60, r: 6 }, absent: { skip: 1, w: () => 60, r: 6 } };
    Object.entries(SCEN).forEach(([sname, sc]) => {
      let prev = prog; let prevN = prog.sessions.map(se => se.exercises.length);
      for (let cyc = 2; cyc <= 3; cyc++) {
        const logs = []; prev.weeks.forEach((w, wi) => prev.sessions.forEach((se, si) => { if (sc.skip && (wi + si) % 2) return; const date = new Date(Date.parse(w.from + 'T12:00:00') + ((se.day + 6) % 7) * 86400000).toISOString().slice(0, 10); const sets = {}; se.exercises.forEach(e => { sets[e.id] = [1, 2, 3].map(() => ({ done: true, w: isBw(e) ? 0 : sc.w(wi), r: isBw(e) ? 10 + (sname === 'progresse' ? 2 * wi : 0) : sc.r })); }); logs.push({ date, done: true, sets }); }));
        const rv = E.reviewCycle(prev, logs, {}, p);
        if (!rv) { problems.push(`cycle ${cyc} (${sname}) : bilan absent`); break; }
        const design = E.cycleDesign(p, rv, cyc); const adj = Object.assign({}, rv.adjust); adj.volume = (adj.volume || 1) * design.adjust.volume; adj.rir = (adj.rir || 0) + design.adjust.rir;
        if (design.weeks < 3 || design.weeks > 6) problems.push(`cycle ${cyc} (${sname}) : durée ${design.weeks} semaines`);
        if (!design.reasons.length) problems.push(`cycle ${cyc} (${sname}) : conception sans justification`);
        if (sname === 'absent' && design.weeks !== 3) problems.push(`cycle ${cyc} (absent) : ${design.weeks} semaines au lieu d'un cycle court de reprise`);
        if (Object.keys(rv.pain || {}).length && design.focus === 'realisation') problems.push(`cycle ${cyc} (${sname}) : réalisation malgré douleurs`);
        const plan2 = LIB.selectExercises(planStructure(p, adj), p, 'seed' + n + sname + cyc);
        const next = programFromPlan(plan2, p, '2026-11-15', design.weeks); next.generatedAt = Date.parse('2026-11-14T12:00:00Z');
        if (next.weeks.length !== design.weeks) problems.push(`cycle ${cyc} (${sname}) : ${next.weeks.length} semaines construites pour ${design.weeks} décidées`);
        const chk = checkProgram(next, p); if (chk.errors.length) problems.push(`cycle ${cyc} (${sname}) : ${chk.errors[0]}`);
        if (sname === 'absent' && prev.sessions.length > 2 && next.sessions.length !== prev.sessions.length - 1) problems.push(`cycle ${cyc} (absent) : ${next.sessions.length} séances au lieu de ${prev.sessions.length - 1} (un jour de moins attendu)`);
        next.sessions.forEach((se, si) => {
          const prevSe = prev.sessions.find(x => x.name === se.name); const pn = prevSe ? prevSe.exercises.length : 0;
          if (next.sessions.length === prev.sessions.length && se.exercises.length < pn) problems.push(`cycle ${cyc} (${sname}) : ${se.name} passe de ${pn} à ${se.exercises.length} exercices`);
          if (GOAL_PATS.includes('vpull') && canPull && /Poussée|Tirage|Haut|Corps/.test(se.name) && !se.exercises.some(e => (LIB.BY_ID[e.exId] || {}).pattern === 'vpull')) problems.push(`cycle ${cyc} (${sname}) : ${se.name} a perdu les tractions`);
          se.exercises.forEach(e => { if (!rv.adjust.avoid.includes(e.exId)) return; const lib = LIB.BY_ID[e.exId]; const alts = LIB.EXERCISES.filter(x => x.pattern === lib.pattern && x.id !== lib.id && !rv.adjust.avoid.includes(x.id) && !se.exercises.some(y => y.exId === x.id) && LIB.allowed(x, p, p.level, gear)); if (alts.length) problems.push(`cycle ${cyc} (${sname}) : ${lib.name} écarté mais réutilisé (${alts.length} alternative(s))`); });
        });
        if (sname === 'absent' && rv.adjust.volume >= 1 && !rv.adjust.days) problems.push(`cycle ${cyc} (absent) : assiduité ${rv.adherence} % sans baisse de volume ni de jours`);
        if (sname === 'progresse' && rv.adjust.avoid.some(id => !rv.adjust.favor.some(f => LIB.BY_ID[f] && LIB.BY_ID[id] && LIB.BY_ID[f].pattern === LIB.BY_ID[id].pattern))) problems.push(`cycle ${cyc} (progresse) : exercices écartés alors que tout progresse`); // un passage à la variante plus dure (écarté + favorisé du même schéma) est une progression
        if (sname === 'stagne' && rv.adherence >= 85 && !rv.adjust.avoid.length && Object.keys(LEVEL_CAPS).length) { const stars = prev.sessions.flatMap(se => se.exercises.filter(e => e.star && !isBw(e) && !GOAL_PATS.includes((LIB.BY_ID[e.exId] || {}).pattern))); if (stars.length) problems.push(`cycle ${cyc} (stagne) : rien ne change malgré la stagnation`); }
        if (rv.adjust.avoid.some(id => GOAL_PATS.includes((LIB.BY_ID[id] || {}).pattern))) problems.push(`cycle ${cyc} (${sname}) : le geste de l'objectif a été écarté`);
        prev = next; prevN = next.sessions.map(se => se.exercises.length); cycles++;
      }
    });
  }
  if (problems.length) { fail++; if (fail <= 12) console.log('✗', p.name, JSON.stringify({ goal: p.goals[0], level: p.level, place: p.spec.place, gym: p.spec.gymGear, home: p.spec.homeGear, days: p.days, min: p.minutes, zones: p.spec.zones, refuse: p.spec.refuse }), '\n   ', problems.slice(0, 4).join(' | ')); }
}
const top = Object.entries(exCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' ');
console.log(`${n} profils · ${cycles} cycles suivants simulés en ${Date.now() - t0} ms · ${fail} non conforme(s) · ${repaired} réparé(s) · ${subs} emplacement(s) substitué(s) · exercices distincts utilisés : ${Object.keys(exCount).length}/${LIB.EXERCISES.length}\nles plus utilisés : ${top}`);
process.exit(fail ? 1 : 0);
