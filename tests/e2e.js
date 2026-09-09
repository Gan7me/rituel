/* Tests de bout en bout — Rituel.
   Lance l'app dans Chromium sans tête avec un Firebase simulé (aucun réseau, aucun coût),
   parcourt les écrans critiques et échoue à la première erreur JS ou à la première assertion fausse.
   Usage : node tests/e2e.js  (nécessite puppeteer-core et un Chromium ; voir README). */
const path = require('path');
const http = require('http');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..', 'public');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 8791;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
    });
    srv.listen(PORT, () => res(srv));
  });
}

// Firebase simulé : auth, Firestore (meta, coach, logs…), fonctions.
function stub() {
  let metaCb = null, coachCb = null;
  window.__setMeta = (docs) => metaCb && metaCb({ docs: docs.map(d => ({ id: d.id, data: () => d.data })), metadata: { fromCache: false } });
  window.__setCoach = (docs) => coachCb && coachCb({ docs: docs.map(d => ({ id: d.id, data: () => d.data })) });
  window.__writes = [];
  const docObj = (name, id) => ({ get: async () => ({ exists: false }), set: async (d) => { window.__writes.push({ name, id, d }); }, collection: (n) => colObj(n) });
  const colObj = (n) => ({ onSnapshot: (cb) => { if (n === 'coach') coachCb = cb; if (n === 'meta') { metaCb = cb; cb({ docs: [], metadata: { fromCache: false } }); return () => {}; } cb({ docChanges: () => [], docs: [], metadata: {} }); return () => {}; }, orderBy() { return this; }, limit() { return this; }, where() { return this; }, doc: (id) => docObj(n, id) });
  window.firebase = {
    initializeApp: () => ({}),
    auth: Object.assign(() => ({ useDeviceLanguage() {}, getRedirectResult: () => Promise.resolve(), onAuthStateChanged: (cb) => { window.__auth = cb; setTimeout(() => cb(location.search.includes('noauth') ? null : { uid: 'u1', displayName: 'Test', email: 'test@nexisafe.com', emailVerified: true, providerData: [{ providerId: 'password' }] }), 30); }, signOut: async () => {}, signInWithEmailAndPassword: async () => { throw { code: 'auth/invalid-credential' }; }, createUserWithEmailAndPassword: async () => ({ user: { updateProfile: async () => {}, sendEmailVerification: async () => {} } }), sendPasswordResetEmail: async () => {} }), {}),
    firestore: () => ({ settings() {}, enablePersistence: () => Promise.resolve(), collection: () => ({ doc: () => ({ collection: (n) => colObj(n) }) }) }),
    app: () => ({ functions: () => ({ httpsCallable: (name) => async (p) => { window.__calls = (window.__calls || []).concat([{ name, p }]); return { data: { text: 'Réponse du coach.' } }; } }) })
  };
}

let failures = 0; const errors = [];
function assert(cond, msg) { if (!cond) { failures++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  p.on('pageerror', e => { errors.push(e.message); console.log('  ! erreur JS : ' + e.message); });
  await p.evaluateOnNewDocument(stub);
  const prog = JSON.parse(fs.readFileSync(path.join(ROOT, 'program.json'), 'utf8'));
  const base = `http://localhost:${PORT}/index.html`;

  console.log('Accueil');
  await p.goto(base + '?noauth=1', { waitUntil: 'networkidle0' });
  assert(await p.$('.gate .logo'), 'logo affiché');
  assert(await p.$('input[name=email]') && await p.$('input[name=password]'), 'formulaire de connexion');
  await p.type('input[name=email]', 'a@b.fr'); await p.type('input[name=password]', '12345678'); await p.click('#authForm button[type=submit]'); await sleep(200);
  assert((await p.$eval('#authMsg', e => e.textContent)).includes('incorrect'), 'erreur de connexion lisible');
  await p.click('[data-mode=signup]'); await sleep(100);
  assert(await p.$('input[name=name]'), 'écran de création de compte');

  console.log('Onboarding');
  await p.goto(base, { waitUntil: 'networkidle0' }); await sleep(200);
  assert(await p.$('#onbForm'), 'étape 1 affichée');
  await p.click('input[name=name]', { clickCount: 3 }); await p.type('input[name=name]', 'Léo'); await p.type('input[name=age]', '19'); await p.type('input[name=height]', '180'); await p.type('input[name=weight]', '72');
  await p.click('#onbForm button[type=submit]'); await sleep(150);
  await p.click('#onbForm button[type=submit]'); await sleep(150);
  assert(await p.$('.chk'), 'objectif obligatoire : reste à l\'étape 2');
  await p.evaluate(() => document.querySelector('.chk input[value=masse]').click());
  await p.click('#onbForm button[type=submit]'); await sleep(150);
  await p.type('textarea[name=equipment]', 'Salle'); await p.click('#onbForm button[type=submit]'); await sleep(150);
  await p.click('#onbForm button[type=submit]'); await sleep(300);
  const profWrite = await p.evaluate(() => window.__writes.find(w => w.name === 'meta' && w.id === 'profile'));
  if (!profWrite) console.log('   writes:', JSON.stringify(await p.evaluate(() => window.__writes)).slice(0, 300));
  assert(profWrite && profWrite.d.name === 'Léo' && profWrite.d.goals.includes('masse'), 'profil enregistré avec les 4 étapes');
  assert(await p.$('#genBtn'), 'écran de génération');
  await p.click('#genBtn'); await sleep(200);
  assert(await p.evaluate(() => (window.__calls || []).some(c => c.p && c.p.mode === 'program')), 'génération demandée au coach');

  console.log('Séance');
  await p.evaluate((pg) => window.__setMeta([{ id: 'profile', data: { name: 'Test', level: 'confirme', weight: 69 } }, { id: 'program', data: pg }]), prog);
  await sleep(300);
  assert(await p.$('.days'), 'sélecteur de jour');
  await p.click('.days button[data-s="jambesA"]'); await sleep(200);
  assert((await p.$$('.ex.cur')).length === 1, 'un seul exercice déplié');
  const rows = (await p.$$('.exrow')).length; assert(rows >= 4, 'autres exercices en lignes compactes (' + rows + ')');
  await p.evaluate(() => document.querySelector('.ex.cur input[data-f="w"][data-i="0"]').scrollIntoView({ block: 'center' }));
  await p.click('.ex.cur [data-step="2.5"][data-i="0"]'); await p.click('.ex.cur [data-step="2.5"][data-i="0"]');
  assert(await p.$eval('.ex.cur input[data-f="w"][data-i="0"]', e => e.value) === '5', 'bouton + ajoute 2,5 kg');
  await p.type('.ex.cur input[data-f="r"][data-i="0"]', '8');
  await p.click('.ex.cur [data-rir="1"][data-i="0"]');
  await p.click('.ex.cur .go[data-i="0"]'); await sleep(300);
  assert(await p.$('.timer.on'), 'chrono lancé');
  assert(await p.$('.ex.cur .go[data-i="0"].done'), 'série cochée');
  const set0 = await p.evaluate(() => { const l = Object.values(JSON.parse(localStorage.getItem('rituel.v1')).logs).find(x => x.session === 'jambesA'); return l && l.sets['jambesA-1'] && l.sets['jambesA-1'][0]; });
  assert(set0 && set0.w === 5 && set0.r === 8 && set0.rir === 1 && set0.done, 'série enregistrée (kg, reps, ressenti)');
  assert(await p.evaluate(() => window.__writes.some(w => w.name === 'logs')), 'séance envoyée au cloud');
  await p.click('.ex.cur [data-menu]'); await sleep(250);
  assert(await p.$('#sheet.on'), 'menu ⋯ ouvert');
  await p.click('#sheet [data-act="skip"]'); await sleep(250);
  assert(await p.evaluate(() => document.querySelector('.ex.cur').dataset.ex !== 'jambesA-1'), 'exercice sauté, le suivant devient courant');
  await p.click('.exrow[data-open="jambesA-1"]'); await sleep(200);
  assert(await p.evaluate(() => document.querySelector('.ex.cur').dataset.ex === 'jambesA-1'), 'réouverture d\'un exercice');
  await p.click('.ex.cur [data-lex="ressenti"]'); await sleep(200);
  assert((await p.$eval('#sheet .sheet-body', e => e.textContent)).includes('facile'), 'lexique du ressenti');
  await p.click('#sheet .sheet-bg'); await sleep(200);
  await p.evaluate(() => document.querySelector('#endBtn').click()); await sleep(300);
  assert(await p.evaluate(() => (window.__calls || []).some(c => c.p && c.p.mode === 'analyse')), 'analyse lancée à la fin de séance');
  assert(await p.evaluate(() => document.querySelector('.tabs button[data-tab="coach"]').getAttribute('aria-selected') === 'true'), 'bascule sur Coach');

  console.log('Coach');
  await p.evaluate(() => window.__setCoach([
    { id: 'a1', data: { title: 'Jambes A · S1', createdAt: Date.now(), analysis: 'Verdict court.', exercises: [{ exId: 'jambesA-1', name: 'Pendulum squat', done: '4×5 à 80 kg', read: 'ok', status: 'up' }], adjustments: [{ exId: 'jambesA-1', name: 'Pendulum squat', change: '4 × 6-8 à 82,5 kg', reason: 'x', load: 82.5 }], nextFocus: 'Pousser.' } },
    { id: 'week-1', data: { type: 'bilan', title: 'Bilan S1', createdAt: Date.now() - 1000, analysis: 'Semaine correcte.', highlights: [{ label: 'Séances', value: '3/4', status: 'ok' }], nextWeek: 'RIR 2.', alerts: [] } },
    { id: 'n1', data: { type: 'nudge', title: 'Trois jours sans séance', createdAt: Date.now() - 2000, analysis: 'Reprends.' } }
  ])); await sleep(200);
  assert((await p.$$('.exc')).length === 1, 'fiche exercice de l\'analyse');
  assert(await p.$('.ana.bilan .hl'), 'bilan hebdomadaire avec repères');
  assert(await p.$('.ana.nudge'), 'relance affichée');
  await p.evaluate(() => document.querySelector('[data-apply="a1"]').click()); await sleep(200);
  assert(await p.evaluate(() => window.__writes.some(w => w.name === 'overrides' && w.id === 'jambesA')), 'ajustements appliqués');
  await p.type('#askInput', 'Question ?'); await p.click('#askForm button[type=submit]'); await sleep(200);
  assert((await p.$$('.msg')).length >= 2, 'chat : question et réponse');

  console.log('Suivi, Programme, Réglages');
  await p.click('.tabs button[data-tab="suivi"]'); await sleep(200);
  assert((await p.$$('.kv > div')).length === 4, '4 indicateurs');
  await p.type('#bwKg', '69.5'); await p.click('#bwAdd'); await sleep(200);
  assert(await p.evaluate(() => window.__writes.some(w => w.name === 'bw')), 'pesée enregistrée');
  await p.click('.tabs button[data-tab="programme"]'); await sleep(200);
  assert((await p.$$('.pcard')).length >= 4, 'programme listé');
  await p.click('.tabs button[data-tab="reglages"]'); await sleep(200);
  assert((await p.$$('.grp')).length >= 4, 'réglages en groupes');
  await p.click('#profBtn'); await sleep(250);
  assert(await p.$('#sheet.on #profForm'), 'profil éditable en feuille');
  await p.click('#sheet .sheet-bg'); await sleep(150);

  console.log('Thème sombre');
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(150);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bg === 'rgb(11, 13, 16)', 'fond sombre appliqué (' + bg + ')');

  await b.close(); srv.close();
  console.log(`\n${failures} échec(s), ${errors.length} erreur(s) JS`);
  process.exit(failures || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
