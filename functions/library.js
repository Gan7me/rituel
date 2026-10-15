/* Bibliothèque d'exercices structurée et sélection déterministe.
   Chaque exercice est une fiche : schéma de mouvement, muscles, matériel requis, zones sollicitées, niveau minimum, tier,
   illustration, textes de coach. Le moteur choisit ici les exercices de chaque emplacement du squelette sans dépendre d'un
   modèle de langage : même fiche, même matériel → même programme, en quelques millisecondes, pour n'importe quel profil. */
'use strict';
const EXERCISES = require('./exercises.json');
const BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));
const LEVEL_RANK = { debutant: 0, intermediaire: 1, confirme: 2, avance: 3 };
const GYM_ALL = ['salle', 'machines', 'poulies', 'barres', 'halteres', 'traction', 'rack', 'presse', 'hack', 'cardio', 'banc'];

// Matériel disponible, normalisé, à partir de la fiche d'entretien (spec) ou du profil simple (gear).
function availableGear(profile) {
  const p = profile || {}; const s = p.spec || {}; const out = new Set(['corps']);
  const norm = t => ({ barre: 'barres', elastique: 'elastiques', kettlebells: 'kettlebell', haltere: 'halteres' }[t] || t);
  if (s.place) {
    if (s.place === 'salle' || s.place === 'deux') { out.add('salle'); out.add('banc'); (s.gymGear || []).forEach(g => out.add(norm(g))); if (out.has('barres')) out.add('rack'); }
    if (s.place === 'maison' || s.place === 'deux') (s.homeGear || []).forEach(g => out.add(norm(g)));
  } else {
    (p.gear || []).forEach(g => { if (g === 'salle') GYM_ALL.forEach(x => out.add(x)); else out.add(norm(g)); });
  }
  if (out.has('corps') && out.size === 1 && !(p.gear || []).length && !s.place) GYM_ALL.forEach(x => out.add(x)); // profil vide : on suppose une salle
  return out;
}
function hasReq(req, gear) { return (req || []).some(alt => alt.split('+').every(t => gear.has(t))); }

// Hachage stable pour varier les choix d'un athlète à l'autre sans aléatoire : même fiche → même programme.
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

// Score d'un exercice pour un emplacement donné.
function score(e, ctx) {
  const { role, goal, level, likes, soft, usedWeek, usedSession, seed, gym, second, skills, age, flags } = ctx;
  let s = 0;
  // Acquis déclarés : sans « 10 tractions », les tractions strictes ne sont pas un principal ; sans squat barre ou soulevé de terre propre, pas de barre lourde en principal.
  if (!skills.includes('pull10') && ['pullup', 'chinup', 'weighted_pullup'].includes(e.id)) s -= role === 'main' ? 40 : 12;
  if (skills.includes('pull10') && ['band_pullup', 'assisted_pullup_m', 'negative_pullup'].includes(e.id)) s -= 25;
  if (!skills.includes('squat') && ['back_squat', 'front_squat'].includes(e.id)) s -= role === 'main' ? 30 : 10;
  if (!skills.includes('dl') && ['deadlift', 'rdl', 'good_morning'].includes(e.id)) s -= role === 'main' ? 30 : 10;
  if (skills.includes('squat') && e.id === 'back_squat' && goal === 'force') s += 6;
  if (skills.includes('dl') && (e.id === 'deadlift' || e.id === 'trap_bar_dl') && goal === 'force') s += 6;
  // Objectif secondaire
  if (second === 'tractions' && (e.tags || []).includes('tractions')) s += 10;
  if (second === 'bras' && (e.pattern === 'biceps' || e.pattern === 'triceps') && e.tier === 3 && !(e.tags || []).includes('leger')) s += 6;
  if (second === 'fessiers' && (e.p || []).some(m => /fessier/.test(m))) s += 8;
  if (second === 'jambes' && (e.pattern === 'squat' || e.pattern === 'lunge') && e.tier <= 2) s += 6;
  if (second === 'puissance' && (e.tags || []).includes('explosif')) s += 8;
  if ((second === 'seche' || second === 'cardio') && e.pattern === 'cond' && (e.req || []).includes('cardio')) s += 4;
  // Âge et autres pratiques
  if (age >= 50 && ((e.tags || []).includes('explosif') || /saut|jump|sauté/i.test(e.name))) s -= 15;
  if (age >= 50 && (e.tags || []).includes('machine') && role !== 'main') s += 3;
  if (flags.runner && e.pattern === 'calf') s -= 8; // mollets déjà chargés par la course
  if (flags.climber && (e.pattern === 'biceps' || /avant-bras|grip/.test((e.p || []).join(' ')))) s -= 10;
  if (flags.contact && (e.pattern === 'reardelt' || e.pattern === 'carry')) s += 4; // cou, coiffe et grip protègent au contact
  const tierFit = role === 'main' ? { 1: 30, 2: 12, 3: 0 } : role === 'second' ? { 1: 18, 2: 24, 3: 6 } : { 1: 2, 2: 14, 3: 24 };
  s += tierFit[e.tier] || 0;
  const tags = e.tags || [];
  if (goal === 'force' && tags.includes('lourd')) s += 10;
  if (goal === 'force' && tags.includes('barre')) s += 6;
  if (goal === 'masse' && tags.includes('machine') && role !== 'main') s += 6;
  if (goal === 'masse' && e.uni && role === 'acc') s += 2;
  if (goal === 'corps' && tags.includes('corps')) s += 14;
  if (goal === 'sante' && (tags.includes('machine') || e.tier === 3)) s += 6;
  if (goal === 'sante' && tags.includes('lourd')) s -= 8;
  if (goal === 'perf' && (tags.includes('explosif') || tags.includes('lourd'))) s += 6;
  if (goal === 'perte' && role === 'acc' && (e.uni || tags.includes('corps'))) s += 3;
  if (likes.includes('lourd') && tags.includes('lourd')) s += 6;
  if (likes.includes('tractions') && tags.includes('tractions')) s += 8;
  if (likes.includes('explosif') && tags.includes('explosif')) s += 6;
  if (likes.includes('bras') && (e.pattern === 'biceps' || e.pattern === 'triceps') && e.tier === 3) s += 2;
  if (gym && tags.includes('leger') && goal !== 'corps') s -= role === 'acc' ? 14 : 22; // en salle, un exercice sans matériel n'exploite pas le parc
  if (tags.includes('niche')) s -= 10; // utile en complément, jamais par défaut
  if (e.src === 'photo') s -= 6; // fiche issue de la base étendue : les fiches éditoriales restent prioritaires à qualité égale
  if (!gym && goal !== 'corps' && tags.includes('leger') && role !== 'acc') s -= 4;
  if (level === 'debutant' && tags.includes('machine')) s += 8;
  if (level === 'debutant' && tags.includes('barre')) s -= 6;
  if ((level === 'confirme' || level === 'avance') && e.tier === 1 && role === 'main') s += 4;
  if (soft.some(z => (e.zones || []).includes(z))) s -= 12; // zone fragile : on préfère un exercice qui ne la charge pas
  if (usedWeek.has(e.id)) s -= role === 'main' ? 6 : 9; // variété dans la semaine, un principal peut revenir
  if (usedSession.has(e.id)) s -= 100; // jamais deux fois dans la même séance
  if ((ctx.want || []).includes(e.id)) s += 60; // demandé explicitement par l'athlète
  if ((ctx.favor || []).includes(e.id)) s += 12; // a progressé au cycle précédent : on garde
  if ((ctx.avoid || []).includes(e.id)) s -= 30; // a stagné en principal : nouveau stimulus
  s += hash(seed + e.id) * 5; // départage stable
  return s;
}

// Règles d'admissibilité d'une fiche pour un profil : matériel, niveau, zones opérées ou douloureuses, refus déclarés.
function allowed(e, profile, level, gearSet) {
  const p = profile || {}; const sp = p.spec || {}; const gear = gearSet || availableGear(p);
  const lvl = LEVEL_RANK[level || p.level] ?? 1; const refuse = sp.refuse || [];
  const banned = new Set((sp.zones || []).filter(z => z.sev === 'opere' || z.sev === 'douleur').map(z => z.zone));
  if (!hasReq(e.req, gear)) return false;
  if ((LEVEL_RANK[e.level] ?? 0) > lvl) return false;
  if (e.maxLevel && lvl > (LEVEL_RANK[e.maxLevel] ?? 3) && !(sp.wantEx || []).includes(e.id)) return false; // variante d'apprentissage, pas pour un athlète confirmé (sauf demande explicite)
  if ((e.zones || []).some(z => banned.has(z))) return false;
  if ((sp.avoidEx || []).includes(e.id)) return false; // exercice refusé explicitement par l'athlète
  if (refuse.includes('nomachine') && (e.tags || []).includes('machine')) return false;
  if (refuse.includes('nobar') && (e.tags || []).includes('barre')) return false;
  if (refuse.includes('burpees') && /burpee/i.test(e.name)) return false;
  if (refuse.includes('cardio') && e.pattern === 'cond' && (e.req || []).includes('cardio')) return false;
  return true;
}
const ZONE_SUBS = { squat: 'hinge', lunge: 'kneeflex', kneeext: 'kneeflex', vpush: 'hpush', vpull: 'hpull', latdelt: 'reardelt', hinge: 'squat', biceps: 'hpull', triceps: 'hpush', hpush: 'hpull', calf: 'core', cond: 'core', carry: 'core', olympic: 'hinge', plyo: 'squat', neck: 'core', mobility: 'core' };

/* Sélection : plan = sortie de planStructure (sessions avec slots {pattern, role, soft}, banned, goal, level, gym),
   profile = fiche. Retourne le plan enrichi : chaque slot reçoit .ex (fiche d'exercice) et .alt (alternative). */
function selectExercises(plan, profile, seedStr) {
  const p = profile || {}; const sp = p.spec || {}; const gear = availableGear(p);
  const refuse = sp.refuse || []; const likes = sp.likes || [];
  const banned = new Set(); const soft = [];
  (sp.zones || []).forEach(z => { if (z.sev === 'opere' || z.sev === 'douleur') banned.add(z.zone); else soft.push(z.zone); });
  const seed = String(seedStr || p.name || '');
  const gym = gear.has('salle');
  const okFor = e => allowed(e, p, plan.level, gear);
  const usedWeek = new Set(); const notes = [];
  plan.sessions.forEach(se => {
    const usedSession = new Set();
    se.slots.forEach(sl => {
      const chain = [sl.pattern, ZONE_SUBS[sl.pattern], ZONE_SUBS[ZONE_SUBS[sl.pattern]], 'core'].filter((x, i, a) => x && a.indexOf(x) === i);
      let picked = null, alt = null, usedPattern = sl.pattern;
      for (const pat of chain) {
        // Les fiches éditoriales (195) ont la priorité ; la base étendue (issue des photos) ne sert que sur demande explicite ou quand rien d'autre n'est possible.
        const all = EXERCISES.filter(e => e.pattern === pat && okFor(e) && !usedSession.has(e.id));
        let cands = all.filter(e => e.src !== 'photo' || (plan.want || []).includes(e.id));
        if (!cands.length) cands = all;
        if (!cands.length) continue;
        const ctx = { role: sl.role, goal: plan.goal, level: plan.level, likes, soft, usedWeek, usedSession, seed, gym, second: plan.second || null, skills: plan.skills || sp.skills || [], age: plan.age || Number(p.age) || 0, flags: plan.flags || {}, favor: plan.favor || [], avoid: plan.avoid || [], want: plan.want || [] };
        cands.sort((a, b) => score(b, ctx) - score(a, ctx));
        picked = cands[0]; alt = cands.find(c => c.id !== picked.id && !usedSession.has(c.id)) || null; usedPattern = pat; break;
      }
      if (!picked) { const safe = ['plank', 'dead_bug', 'side_plank', 'ytw', 'glute_bridge', 'bw_calf', 'wall_sit', 'shadow_box'].map(id => BY_ID[id]).find(x => x && !usedSession.has(x.id) && hasReq(x.req, gear)); picked = safe || BY_ID.plank; usedPattern = picked.pattern; }
      if (usedPattern !== sl.pattern) notes.push(`${se.name} : « ${sl.pattern} » remplacé par « ${usedPattern} » (matériel ou zone à ménager)`);
      sl.ex = picked; sl.alt = alt; sl.usedPattern = usedPattern;
      usedSession.add(picked.id); usedWeek.add(picked.id);
    });
  });
  plan.selectionNotes = notes; plan.gearList = [...gear];
  return plan;
}

module.exports = { EXERCISES, BY_ID, availableGear, selectExercises, hasReq, allowed };
