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
  // Écho Firestore : chaque écriture dans une collection écoutée revient par le listener, comme en vrai (copie, pas la même référence).
  const listeners = {}; let echo = false; window.__echo = (on) => { echo = on; };
  window.__pushDoc = (name, id, data) => { const cb = listeners[name]; if (cb) cb({ docChanges: () => [{ type: 'modified', doc: { id, data: () => JSON.parse(JSON.stringify(data)) } }], docs: [], metadata: {} }); };
  const docObj = (name, id) => ({ get: async () => ({ exists: false }), set: async (d) => { window.__writes.push({ name, id, d }); if (echo) setTimeout(() => window.__pushDoc(name, id, d), 10); }, delete: async () => {}, collection: (n) => colObj(n) });
  const colObj = (n) => ({ onSnapshot: (cb) => { if (n === 'coach') coachCb = cb; if (n === 'meta') { metaCb = cb; cb({ docs: [], metadata: { fromCache: false } }); return () => {}; } listeners[n] = cb; cb({ docChanges: () => [], docs: [], metadata: {} }); return () => {}; }, orderBy() { return this; }, limit() { return this; }, where() { return this; }, doc: (id) => docObj(n, id) });
  window.firebase = {
    initializeApp: () => ({}),
    auth: Object.assign(() => ({ useDeviceLanguage() {}, getRedirectResult: () => Promise.resolve(), onAuthStateChanged: (cb) => { window.__auth = cb; setTimeout(() => cb(location.search.includes('noauth') ? null : { uid: 'u1', displayName: 'Test', email: 'test@nexisafe.com', emailVerified: true, providerData: [{ providerId: 'password' }] }), 30); }, signOut: async () => {}, signInWithEmailAndPassword: async () => { throw { code: 'auth/invalid-credential' }; }, createUserWithEmailAndPassword: async () => ({ user: { updateProfile: async () => {}, sendEmailVerification: async () => {} } }), sendPasswordResetEmail: async () => {} }), {}),
    firestore: () => ({ settings() {}, enablePersistence: () => Promise.resolve(), collection: () => ({ doc: () => ({ collection: (n) => colObj(n) }) }) }),
    app: () => ({ functions: () => ({ httpsCallable: (name) => async (p) => { window.__calls = (window.__calls || []).concat([{ name, p }]); await new Promise(r => setTimeout(r, 120)); return { data: { text: 'Réponse du coach.' } }; } }) })
  };
}

let failures = 0; const errors = [];
function assert(cond, msg) { if (!cond) { failures++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await serve();
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  p.on('error', e => console.log('  ! page crash : ' + e.message));
  p.on('dialog', d => { console.log('  ! dialogue : ' + d.message()); d.accept(); });
  p.on('pageerror', e => { errors.push(e.message); console.log('  ! erreur JS : ' + e.message); });
  await p.evaluateOnNewDocument(stub);
  // Pas de service worker pendant le test : son activation recharge la page (controllerchange) et casse les handles Puppeteer.
  await p.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => new Promise(() => {}), getRegistration: async () => null, addEventListener() {}, controller: null }, configurable: true }); } catch (e) {} });
  // Photos de démonstration : image locale (data URL) pour ne pas dépendre du réseau.
  await p.evaluateOnNewDocument(() => { window.__DEMO_BASE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==#'; });
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
  await p.evaluate(() => document.querySelector('.chk input[value=salle]').click()); await p.type('textarea[name=equipment]', 'Salle'); await p.click('#onbForm button[type=submit]'); await sleep(150);
  await p.click('#onbForm button[type=submit]'); await sleep(300);
  const profWrite = await p.evaluate(() => window.__writes.find(w => w.name === 'meta' && w.id === 'profile'));
  if (!profWrite) console.log('   writes:', JSON.stringify(await p.evaluate(() => window.__writes)).slice(0, 300));
  assert(profWrite && profWrite.d.name === 'Léo' && profWrite.d.goals.includes('masse'), 'profil enregistré avec les 4 étapes');
  assert(await p.$('#genBtn'), 'écran de génération');
  await p.click('#genBtn'); await sleep(50);
  assert(await p.evaluate(() => (window.__calls || []).some(c => c.p && c.p.mode === 'program')), 'génération demandée au coach');
  await p.evaluate(() => window.__setMeta([{ id: 'profile', data: { name: 'Léo' } }, { id: 'usage', data: { program: 1 } }])); await sleep(100);
  assert(await p.evaluate(() => !document.querySelector('#genWait').hidden && document.querySelector('#genBtn').hidden), 'écran d\'attente conservé quand le compteur d\'usage s\'écrit');

  console.log('Séance');
  await p.evaluate((pg) => window.__setMeta([{ id: 'profile', data: { name: 'Test', level: 'confirme', weight: 69 } }, { id: 'program', data: pg }]), prog);
  await sleep(300);
  console.log('Aujourd\'hui');
  assert(await p.evaluate(() => !document.querySelector('#tab-home').hidden && document.querySelector('.today .t-name')), 'accueil : carte séance du jour');
  assert((await p.$$('.dots .dot')).length === 7, 'accueil : 7 pastilles de la semaine');
  assert(await p.$('.card .card-h'), 'accueil : carte coach');
  await p.evaluate(() => document.querySelector('#homeStart').click()); await sleep(250);
  assert(await p.evaluate(() => document.body.classList.contains('focus') && !document.querySelector('#tab-seance').hidden), 'Démarrer ouvre le mode séance plein écran');
  assert(await p.$('.fhead .fprog'), 'en-tête plein écran avec progression');
  assert(await p.evaluate(() => getComputedStyle(document.querySelector('.tabs')).display === 'none'), 'barre d\'onglets masquée en plein écran');
  await p.evaluate(() => document.querySelector('.fnav [data-open]').click()); await sleep(200);
  assert(await p.evaluate(() => document.querySelector('.ex.cur').dataset.ex !== document.querySelectorAll('.exrow')[0]?.dataset.open), 'navigation exercice suivant');
  await p.click('#fExit'); await sleep(200);
  assert(await p.evaluate(() => !document.body.classList.contains('focus')), 'sortie du mode plein écran');
  await p.evaluate(() => { S.openEx = null; });
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
  assert(await p.$('.cstat .cs-grid'), 'coach : carte d\'état');
  assert(await p.evaluate(() => document.querySelector('.chead h2').textContent === COACH_NAME && !!document.querySelector('.chead .cav')), 'coach : identité (nom + avatar)');
  await p.evaluate(() => startJob('test', ['a', 'b'], 2000)); await sleep(300);
  assert(await p.evaluate(() => document.querySelector('#jobbar.on .cav.busy') && document.querySelector('#jobFill').style.width !== ''), 'barre de travail visible avec progression');
  await p.evaluate(() => endJob(true, 'ok')); await sleep(100);
  assert(await p.evaluate(() => !!document.querySelector('#jobbar .cav.ok')), 'barre de travail : état terminé');
  assert((await p.$$('.exc.hasimg .dthumb img')).length >= 1, 'coach : photo du mouvement dans l\'analyse');
  await p.click('#chatBtn'); await sleep(250);
  assert(await p.$('#sheet.on .chatpane'), 'chat ouvert en feuille');
  await p.evaluate(() => document.querySelector('#chatNew') && document.querySelector('#chatNew').click()); await sleep(200);
  await p.evaluate(() => window.__echo(true));
  await p.type('#askInput', 'Question ?'); await p.click('#askForm button[type=submit]'); await sleep(400);
  assert((await p.$$('#sheet .msg')).length === 2, 'chat : question et réponse affichées malgré l\'écho Firestore');
  await p.type('#askInput', 'Deuxième ?'); await p.click('#askForm button[type=submit]'); await sleep(400);
  assert((await p.$$('#sheet .msg')).length === 4, 'chat : deuxième échange conservé (4 messages)');
  await p.evaluate(() => window.__echo(false));
  assert(await p.evaluate(() => Object.values(S.chats).filter(t => t.messages.length).length === 1 && window.__writes.some(w => w.name === 'chats')), 'conversation enregistrée et synchronisée');
  await p.click('#chatList'); await sleep(200);
  assert((await p.$$('.chat-list .crow')).length === 1, 'liste des conversations');
  await p.evaluate(() => { window.confirm = () => true; document.querySelector('[data-del-thread]').click(); }); await sleep(200);
  assert(await p.evaluate(() => Object.values(S.chats).filter(t => t.messages.length).length === 0), 'conversation supprimée');
  await p.evaluate(() => hideSheet()); await sleep(200);
  await p.click('.tabs button[data-tab="seance"]'); await sleep(200);
  assert(await p.$('.ex.cur .demo img'), 'séance : photos départ / arrivée du mouvement');
  await p.evaluate(() => document.querySelector('.ex.cur .demo').click()); await sleep(400);
  assert(await p.$('#sheet.on #dplay'), 'fiche mouvement ouverte');
  assert(await p.$('#sheet.on .mmap .m.p'), 'carte musculaire avec muscle cible');
  await p.evaluate(() => hideSheet()); await sleep(200);

  console.log('Suivi, Programme, Réglages');
  await p.click('.tabs button[data-tab="suivi"]'); await sleep(200);
  assert(await p.$('.hero .ring') && (await p.$$('.trends .tr')).length === 3, 'progrès : anneau de la semaine et 3 tendances');
  await p.click('.seg [data-view="force"]'); await sleep(200);
  assert((await p.$$('.chip2')).length >= 4 && await p.$('.spark2'), 'progrès : force par exercice avec courbe');
  await p.click('.seg [data-view="corps"]'); await sleep(200);
  await p.click('[data-bw="0.1"]'); await p.click('#bwAdd'); await sleep(200);
  assert(await p.evaluate(() => window.__writes.some(w => w.name === 'bw')), 'pesée enregistrée');
  await p.click('.seg [data-view="journal"]'); await sleep(200);
  assert((await p.$$('.jrow')).length >= 1, 'journal en cartes');
  await p.evaluate(() => document.querySelector('.jrow').click()); await sleep(250);
  assert(await p.$('#sheet.on .hl2'), 'détail de séance en feuille');
  await p.evaluate(() => hideSheet()); await sleep(150);
  await p.click('.tabs button[data-tab="programme"]'); await sleep(200);
  assert((await p.$$('.pcard')).length >= 4, 'programme listé');
  await p.click('#settingsBtn'); await sleep(200);
  assert(await p.evaluate(() => !document.querySelector('#tab-reglages').hidden), 'réglages via l\'avatar');
  console.log('Abonnement');
  await p.evaluate(() => document.querySelector('#planBtn').click()); await sleep(200);
  assert(await p.$('#sheet.on #pwNotify'), 'navigateur : écran de limite avec « me prévenir »');
  await p.evaluate(() => { NATIVE = true; BILLING.available = true; BILLING.packages = [{ id: '$rc_annual', type: 'ANNUAL', price: '59,99 €', period: 'P1Y' }, { id: '$rc_monthly', type: 'MONTHLY', price: '9,99 €', period: 'P1M' }]; renderOffers(); }); await sleep(150);
  assert((await p.$$('#sheet .offer')).length === 2 && await p.$('#sheet .offer.best'), 'app : deux offres avec prix, annuel mis en avant');
  await p.evaluate(() => { window.__native = []; window.ReactNativeWebView = { postMessage: (m) => window.__native.push(JSON.parse(m)) }; document.querySelector('#sheet .offer[data-pkg="$rc_monthly"]').click(); });
  assert(await p.evaluate(() => window.__native.some(m => m.type === 'purchase' && m.packageId === '$rc_monthly')), 'achat demandé à la coquille');
  await p.evaluate(() => onPurchaseResult({ ok: true, premium: true })); await sleep(200);
  assert(await p.evaluate(() => !document.querySelector('#sheet').classList.contains('on') && document.querySelector('#planBtn').textContent.includes('Premium')), 'achat confirmé : forfait Premium affiché');
  await p.evaluate(() => { NATIVE = false; BILLING.premium = false; });
  console.log('Apple Santé');
  await p.evaluate(() => { NATIVE = true; window.__native = []; window.ReactNativeWebView = { postMessage: (m) => window.__native.push(JSON.parse(m)) }; S.bw['2026-09-20'] = { date: '2026-09-20', kg: 70.2, updatedAt: 1 }; onHealthResult({ action: 'authorize', ok: true, available: true }); });
  assert(await p.evaluate(() => S.health === true && window.__native.some(m => m.type === 'health' && m.action === 'readWeight')), 'autorisation → lecture du poids demandée');
  await p.evaluate(() => onHealthResult({ action: 'readWeight', ok: true, available: true, samples: [{ date: '2026-09-21', kg: 69.4 }, { date: '2026-09-20', kg: 71 }] })); await sleep(100);
  assert(await p.evaluate(() => S.bw['2026-09-21'] && S.bw['2026-09-21'].source === 'health' && S.bw['2026-09-20'].kg === 70.2), 'pesées importées, la saisie manuelle garde la priorité');
  await p.evaluate(() => { const l = Object.values(S.logs).find(x => Object.values(x.sets || {}).flat().some(s => s && s.done && s.t)); healthExportSession(l); });
  assert(await p.evaluate(() => window.__native.some(m => m.type === 'health' && m.action === 'writeWorkout' && m.workout.title.startsWith('Rituel'))), 'séance exportée comme entraînement');
  await p.evaluate(() => { NATIVE = false; S.health = false; });
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
