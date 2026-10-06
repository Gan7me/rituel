/* Banc de test « vrai parcours » : la vraie app, les vrais services Firebase (émulateurs Auth, Firestore, Functions, Hosting),
   le vrai code des fonctions, un modèle simulé. Deux nouveaux comptes enchaînent inscription → onboarding → programme →
   séance → analyse → chat. Lancé par tests/staging.sh (qui démarre le modèle simulé et les émulateurs). */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:5000/index.html?emu=1';
let failures = 0; const errors = [];
const assert = (c, m) => { if (!c) { failures++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(p, fn, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await p.evaluate(fn)) return true; } catch (e) {} await sleep(250); } console.log('  … délai dépassé : ' + label); return false; }

async function newUser(b, tag) {
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  p.on('pageerror', e => { errors.push(e.message); console.log('  ! erreur JS : ' + e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR|WebSocket|emulator/i.test(m.text())) console.log('  ~ console : ' + m.text().slice(0, 160)); });
  await p.evaluateOnNewDocument(() => { try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => new Promise(() => {}), getRegistration: async () => null, addEventListener() {}, controller: null }, configurable: true }); } catch (e) {} window.__DEMO_BASE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==#'; });
  await p.goto(BASE, { waitUntil: 'networkidle2' }); await sleep(600);

  console.log(`\n[${tag}] Inscription`);
  await waitFor(p, () => !!document.querySelector('[data-mode=signup]'), 8000, 'écran de connexion');
  await p.click('[data-mode=signup]'); await sleep(200);
  const email = `${tag}-${Date.now()}@test.local`;
  await p.type('input[name=name]', tag); await p.type('input[name=email]', email); await p.type('input[name=password]', 'motdepasse1');
  await p.click('#authForm button[type=submit]');
  assert(await waitFor(p, () => !!document.querySelector('#onbForm'), 15000, 'onboarding après inscription'), 'compte créé, onboarding affiché');

  console.log(`[${tag}] Onboarding`);
  await p.click('input[name=name]', { clickCount: 3 }); await p.type('input[name=name]', tag); await p.type('input[name=age]', '34'); await p.type('input[name=height]', '176'); await p.type('input[name=weight]', '74');
  await p.click('#onbForm button[type=submit]'); await sleep(200);
  await p.evaluate(() => document.querySelector('.chk input[value=masse]').click()); await p.click('#onbForm button[type=submit]'); await sleep(200);
  await p.evaluate(() => document.querySelector('.chk input[value=salle]').click()); await p.type('textarea[name=equipment]', 'Salle complète'); await p.click('#onbForm button[type=submit]'); await sleep(200);
  await p.click('#onbForm button[type=submit]');
  assert(await waitFor(p, () => !!document.querySelector('#genBtn'), 15000, 'écran de génération'), 'profil enregistré dans Firestore, écran de génération');

  console.log(`[${tag}] Programme`);
  await p.click('#genBtn'); await sleep(800);
  assert(await p.evaluate(() => !document.querySelector('#genWait').hidden), 'attente visible pendant la génération');
  assert(await waitFor(p, () => !!document.querySelector('.today .t-name'), 60000, 'programme reçu'), 'programme généré, enregistré et affiché (accueil)');
  assert(await p.evaluate(() => document.querySelectorAll('.tabs button').length === 5 && !document.querySelector('.tabs').hidden), 'barre d\'onglets affichée');

  console.log(`[${tag}] Séance`);
  await p.click('.tabs button[data-tab="seance"]'); await sleep(400);
  await p.evaluate(() => { const b = document.querySelector('.days button[data-s]'); if (b) b.click(); }); await sleep(400);
  assert(await p.$('.ex.cur'), 'séance affichée avec un exercice courant');
  await p.evaluate(() => document.querySelector('.ex.cur input[data-f="w"][data-i="0"]').scrollIntoView({ block: 'center' }));
  await p.type('.ex.cur input[data-f="w"][data-i="0"]', '60'); await p.type('.ex.cur input[data-f="r"][data-i="0"]', '8');
  await p.evaluate(() => document.querySelector('.ex.cur .go[data-i="0"]').click()); await sleep(600);
  assert(await p.$('.ex.cur .go[data-i="0"].done'), 'série validée');
  await p.evaluate(() => document.querySelector('#endBtn').click());
  assert(await waitFor(p, () => !!document.querySelector('.ana .exc, .ana .anab'), 60000, 'analyse'), 'séance terminée → analyse de Kai reçue et affichée');

  console.log(`[${tag}] Chat`);
  await p.evaluate(() => showTab('coach')); await sleep(300);
  await p.click('#chatBtn'); await sleep(400);
  assert(await p.$('#askInput'), 'zone de saisie présente');
  await p.type('#askInput', 'Je fais quoi ce soir ?'); await p.click('#askForm button[type=submit]');
  assert(await waitFor(p, () => document.querySelectorAll('#sheet .msg.assistant:not(.typing)').length >= 1, 30000, 'réponse chat'), 'réponse de Kai affichée dans le fil');
  await p.type('#askInput', 'Et demain ?'); await p.click('#askForm button[type=submit]');
  assert(await waitFor(p, () => document.querySelectorAll('#sheet .msg.assistant:not(.typing)').length >= 2, 30000, 'deuxième réponse'), 'deuxième échange conservé');
  await p.evaluate(() => hideSheet());

  console.log(`[${tag}] Rechargement`);
  await p.reload({ waitUntil: 'networkidle2' }); await sleep(800);
  assert(await waitFor(p, () => !!document.querySelector('.today .t-name'), 15000, 'programme après rechargement'), 'session conservée, programme rechargé depuis le cloud');
  assert(await p.evaluate(() => Object.values(S.logs).length >= 1 && Object.values(S.chats).some(t => t.messages.length >= 4)), 'journal et conversation rechargés');
  const diag = await p.evaluate(() => ERRLOG.slice(0, 5).map(e => e.src + ' · ' + e.msg));
  if (diag.length) console.log('  diagnostic app : ' + JSON.stringify(diag));
  await p.evaluate(() => signOut()); await sleep(500);
  await p.close();
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  try { await newUser(b, 'testeur1'); await newUser(b, 'testeur2'); }
  catch (e) { console.log('  ! exception : ' + e.message); failures++; }
  await b.close();
  console.log(`\n${failures} échec(s), ${errors.length} erreur(s) JS`);
  process.exit(failures || errors.length ? 1 : 0);
})();
