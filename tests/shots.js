/* Captures d'écran de l'app avec des données de démonstration (même simulation Firebase que e2e.js).
   Usage : node tests/shots.js [dossier de sortie]   →  home, seance, coach, chat, programme, progres, reglages, profil (clair + sombre pour home). */
const puppeteer = require('puppeteer-core');
const fs = require('fs'); const path = require('path'); const http = require('http');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.join(__dirname, '..', 'public'); const OUT = process.argv[2] || path.join(__dirname, '..', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const e2e = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8');
const stubSrc = e2e.slice(e2e.indexOf('function stub() {'), e2e.indexOf('let failures = 0;'));
const stub = new Function('return ' + stubSrc)();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html'); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
  await new Promise(r => srv.listen(0, r)); const base = `http://localhost:${srv.address().port}/index.html`;
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.evaluateOnNewDocument(stub);
  await p.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => new Promise(() => {}), getRegistration: async () => null, addEventListener() {}, controller: null }, configurable: true }); } catch (e) {} });
  const prog = JSON.parse(fs.readFileSync(path.join(ROOT, 'program.json'), 'utf8'));
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.evaluate((pg) => window.__setMeta([{ id: 'profile', data: { name: 'Ganème', age: 43, height: 178, weight: 69, level: 'confirme', goals: ['force', 'tractions', 'jambes'], days: 6, minutes: 75, gear: ['salle'], equipment: 'ON AIR Lyon', pullGoal: 70 } }, { id: 'program', data: pg }, { id: 'usage', data: { month: new Date().toISOString().slice(0, 7), analyse: 7, chat: 12, program: 1, costUsd: 0.41, plan: 'premium', limits: { program: 6, analyse: 60, chat: 300, substitute: 12, demo: 10 } } }]), prog);
  await sleep(300);
  // journal de démonstration
  await p.evaluate(() => { const d = new Date(); const iso = x => x.toISOString().slice(0, 10);
    const mk = (off, ses, sets) => { const dd = new Date(d); dd.setDate(d.getDate() - off); const date = iso(dd); S.logs[date + '_' + ses] = { date, session: ses, week: 1, done: true, sets, gtg: [], notes: '', updatedAt: Date.now() }; };
    mk(1, 'jambesA', { 'jambesA-1': [{ w: 120, r: 8, rir: 2, done: true, t: Date.now() - 90e6 }, { w: 120, r: 8, rir: 1, done: true, t: Date.now() - 89e6 }, { w: 120, r: 7, rir: 1, done: true, t: Date.now() - 88e6 }], 'jambesA-2': [{ w: 80, r: 10, rir: 2, done: true }, { w: 80, r: 10, rir: 2, done: true }], 'jambesA-4': [{ w: 45, r: 10, rir: 1, done: true }, { w: 45, r: 9, rir: 0, done: true }] });
    mk(3, 'pushA', { 'pushA-1': [{ w: 80, r: 5, rir: 2, done: true }, { w: 80, r: 5, rir: 2, done: true }, { w: 82.5, r: 5, rir: 1, done: true }], 'pushA-4': [{ w: 55, r: 12, rir: 1, done: true }] });
    mk(8, 'jambesA', { 'jambesA-1': [{ w: 115, r: 8, rir: 3, done: true }, { w: 115, r: 8, rir: 3, done: true }] });
    mk(10, 'pushA', { 'pushA-1': [{ w: 77.5, r: 5, rir: 3, done: true }] });
    for (let i = 0; i < 12; i++) { const dd = new Date(d); dd.setDate(d.getDate() - i * 3); S.bw[iso(dd)] = { date: iso(dd), kg: Math.round((69.8 - i * 0.08 + ((i % 3) - 1) * 0.15) * 10) / 10, updatedAt: 1 }; }
    [[28, 35], [7, 38], [0, 41]].forEach(([o, r]) => { const dd = new Date(d); dd.setDate(d.getDate() - o); S.tests[iso(dd)] = { date: iso(dd), reps: r, updatedAt: 1 }; });
    S.chats = { c1: { id: 'c1', createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000, title: 'Je suis fatigué après ma garde, je fais quoi ce soir ?', messages: [{ role: 'user', content: 'Je suis fatigué après ma garde, je fais quoi ce soir ?', t: 1 }, { role: 'assistant', content: 'Après une garde de 24 h, tu ne fais pas la séance Pull B telle quelle. Version allégée : mêmes exercices, deux séries de moins sur les tractions et le tirage, charges de la dernière fois moins 10 %, et tu t\'arrêtes à RIR 3, c\'est-à-dire avec trois reps en réserve.\n\nL\'objectif ce soir, c\'est de bouger et de garder le rythme, pas de progresser.', t: 2 }] }, c2: { id: 'c2', createdAt: Date.now() - 3 * 86400000, updatedAt: Date.now() - 3 * 86400000, title: 'Mon épaule tire sur le développé', messages: [{ role: 'user', content: 'Mon épaule tire sur le développé', t: 1 }, { role: 'assistant', content: 'On ne force pas dessus. Cette semaine, remplace le développé incliné barre par la presse convergente, amplitude réduite, et tu me dis après la séance.', t: 2 }] } };
    save(); render(); });
  await p.evaluate(() => window.__setCoach([
    { id: 'a1', data: { title: 'Jambes A · S2', logKey: Object.keys(S.logs)[0], createdAt: Date.now() - 3600e3, analysis: 'Séance propre sur les compounds : le pendulum tient 3 × 8 à 120 kg avec un RIR qui descend de 2 à 1, exactement l\'intention de S2, et tu finis au bas de la fourchette partout. Le belt squat reste sous le haut de fourchette à 80 kg, on n\'y touche pas. Le point qui m\'arrête : 45 kg au leg curl avec RIR 0 dès la deuxième série, c\'est trop tôt dans le cycle pour aller à l\'échec sur une isolation. Je redescends à 40 kg et je garde la marge.', cue: 'Sur le pendulum, marque la seconde d\'arrêt en bas avant de pousser : c\'est elle qui garantit l\'amplitude et protège les genoux quand la charge monte.', questions: ['Le leg curl à 45 kg, c\'est sur la même machine que la semaine dernière ?'], exercises: [{ exId: 'jambesA-1', name: 'Pendulum squat', done: '3×8 à 120 kg · RIR 2/1/1', read: 'Bas de fourchette atteint partout, marge réelle : prêt pour +2,5 %.', status: 'up' }, { exId: 'jambesA-2', name: 'Belt squat', done: '2×10 à 80 kg · RIR 2', read: 'Haut de fourchette non atteint.', status: 'hold' }, { exId: 'jambesA-4', name: 'Leg curl assis', done: '2×10 à 45 kg · RIR 1/0', read: 'Échec dès la 2e série en S2 : charge trop haute pour l\'intention de la semaine.', status: 'warn' }], adjustments: [{ exId: 'jambesA-1', name: 'Pendulum squat', change: '4 × 6-8 à 125 kg (RIR 2)', reason: 'Bas de fourchette atteint partout.', load: 125 }, { exId: 'jambesA-4', name: 'Leg curl assis', change: '4 × 8-10 à 40 kg', reason: 'Stabiliser.' }], nextFocus: 'Viser le haut de fourchette sur les compounds avant toute hausse.' } },
    { id: 'week-1', data: { type: 'bilan', title: 'Bilan S1', createdAt: Date.now() - 2 * 86400000, analysis: 'Semaine complète, 4 séances sur 4. Les jambes montent vite : le pendulum passe de 115 à 120 kg sans perdre de reps. Le poids tient à 69,5 kg, la sèche se fait sans perte de force.', highlights: [{ label: 'Séances', value: '4/4', status: 'ok' }, { label: 'Pendulum', value: '+4 %', status: 'ok' }, { label: 'Poids', value: '69,5', status: 'ok' }], nextWeek: 'RIR 2 partout, +1 série sur les exercices prioritaires.', alerts: [] } }
  ])); await sleep(400);
  const shot = async (name, fn) => { if (fn) await fn(); await sleep(450); await p.evaluate(() => { const j = document.querySelector('#jobbar'); if (j) j.classList.remove('on'); document.body.classList.remove('hasjob'); }); await p.screenshot({ path: path.join(OUT, name + '.png') }); console.log('·', name); };
  await shot('home', () => p.evaluate(() => showTab('home')));
  await shot('home-bas', () => p.evaluate(() => window.scrollTo({ top: 99999 })));
  await shot('badges', () => p.evaluate(() => showBadges()));
  await p.evaluate(() => hideSheet());
  await shot('abonnement', () => p.evaluate(() => showPlan()));
  await p.evaluate(() => hideSheet());
  await shot('seance', () => p.evaluate(() => { showTab('seance'); document.querySelector('.days button[data-s="jambesA"]').click(); }));
  await shot('coach', () => p.evaluate(() => { COACH.view = 'home'; showTab('coach'); renderCoach(); }));
  await shot('chat', () => p.evaluate(() => coachOpenChat('c1')));
  await shot('chats', () => p.evaluate(() => { COACH.view = 'chats'; renderCoach(); }));
  await shot('programme', () => p.evaluate(() => { COACH.view = 'home'; showTab('programme'); }));
  await shot('progres', () => p.evaluate(() => { SUIVI_VIEW = 'forme'; showTab('suivi'); renderSuivi(); }));
  await shot('reglages', () => p.evaluate(() => showTab('reglages')));
  await shot('profil', () => p.evaluate(() => document.querySelector('#profBtn').click()));
  await p.evaluate(() => hideSheet());
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await shot('home-dark', () => p.evaluate(() => showTab('home')));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
