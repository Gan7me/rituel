// Second cycle d'un athlète confirmé assidu dont les charges stagnent : l'objectif reste servi, la séance reste complète.
process.env.RITUEL_TEST = '1';
const path = require('path');
const E = require(path.join(__dirname, '..', 'functions', 'index.js'))._engine;
const LIB = require(path.join(__dirname, '..', 'functions', 'library.js'));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const profile = { name: 'G', age: 43, sex: 'h', height: 178, weight: 69, level: 'avance', goals: ['force', 'tractions'], days: 6, minutes: 75, gear: ['salle', 'halteres', 'barre', 'traction', 'cardio'],
  spec: { goalMain: 'force', goalSecond: 'tractions', years: '3', skills: ['pull10', 'squat', 'dl'], place: 'salle', gymGear: ['machines', 'poulies', 'barres', 'halteres', 'traction', 'rack', 'presse', 'hack', 'cardio'], daysList: [0, 1, 2, 3, 4, 5], minutes: 75, zones: [], sports: [], refuse: [], likes: ['tractions', 'lourd'], v: 1 } };
const isPull = e => /traction|pull-up|chin/i.test(e.name);
const plan1 = E.planStructure(profile, null); LIB.selectExercises(plan1, profile, 'c2-1');
const prog = E.programFromPlan(plan1, profile, '2026-09-14'); prog.generatedAt = Date.parse('2026-09-13T12:00:00Z');
console.log('Cycle 1');
ok(prog.sessions.every(se => se.exercises.length >= 7), 'avancé à 75 min : au moins 7 exercices par séance');
ok(prog.sessions.filter(se => /Poussée|Tirage/.test(se.name)).every(se => se.exercises.some(isPull)), 'objectif tractions : des tractions à chaque séance du haut');
const logs = []; prog.weeks.forEach(w => prog.sessions.forEach(se => { const date = new Date(Date.parse(w.from + 'T12:00:00') + ((se.day + 6) % 7) * 86400000).toISOString().slice(0, 10); const sets = {}; se.exercises.forEach(e => { const bw = isPull(e) || /dips|pompe/i.test(e.name); sets[e.id] = [1, 2, 3].map(() => ({ done: true, w: bw ? 0 : 60, r: bw ? 20 : 5 })); }); logs.push({ date, done: true, sets }); }));
const rv = E.reviewCycle(prog, logs, {}, profile);
console.log('Bilan');
ok(rv && rv.adherence === 100, 'assiduité mesurée 100 %');
ok(rv.adjust.avoid.length > 0, 'exercices principaux stagnants écartés : ' + rv.adjust.avoid.join(', '));
ok(!rv.adjust.avoid.some(id => LIB.BY_ID[id] && LIB.BY_ID[id].pattern === 'vpull'), 'le tirage vertical (objectif) n\'est jamais écarté');
const plan2 = E.planStructure(profile, rv.adjust); LIB.selectExercises(plan2, profile, 'c2-2');
const prog2 = E.programFromPlan(plan2, profile, '2026-10-12');
console.log('Cycle 2');
ok(prog2.sessions.every(se => se.exercises.length >= 7), 'toujours au moins 7 exercices par séance');
ok(prog2.sessions.filter(se => /Poussée|Tirage/.test(se.name)).every(se => se.exercises.some(isPull)), 'tractions conservées à chaque séance du haut');
ok(!prog2.sessions.flatMap(se => se.exercises).some(e => rv.adjust.avoid.includes(e.exId)), 'les principaux stagnants ne reviennent pas');
// Poids du corps mesuré en répétitions : 20 → 26 tractions = progression
const logs2 = logs.map(l => ({ ...l, sets: Object.fromEntries(Object.entries(l.sets).map(([id, arr]) => [id, arr.map(x => x.w ? x : { ...x, r: l.date >= '2026-10-01' ? 26 : 20 })])) }));
const rv2 = E.reviewCycle(prog, logs2, {}, profile);
ok(rv2.prs > 0, 'répétitions au poids du corps comptées comme progression (' + rv2.prs + ' records)');
console.log(`${fails} échec(s)`); process.exit(fails ? 1 : 0);
