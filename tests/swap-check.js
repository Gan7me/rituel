/* Vérification du remplacement d'exercice par l'athlète (menu ⋯ → Remplacer) : choix, portée « cycle », affichage, rétablissement. */
const path = require('path'); const http = require('http'); const fs = require('fs'); const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..', 'public'); const PORT = 8794; const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer((req, r) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const prog = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'program.json'), 'utf8')); prog.generatedAt = prog.generatedAt || Date.now();
  const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); const pg = await b.newPage(); await pg.setViewport({ width: 390, height: 844 });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.setRequestInterception(true); pg.on('request', r => { if (/gstatic|googleapis/.test(r.url())) r.abort(); else r.continue(); });
  await pg.evaluateOnNewDocument((prog) => { localStorage.setItem('rituel.hadUser', '1'); localStorage.setItem('rituel.meta', JSON.stringify({ profile: { name: 'Test' }, program: prog, history: null, at: Date.now() })); window.firebase = { initializeApp: () => ({}), auth: Object.assign(() => ({ useDeviceLanguage() {}, onAuthStateChanged() {} }), {}), firestore: () => ({ settings() {}, enablePersistence: () => Promise.resolve(), collection: () => ({ doc: () => ({ collection: () => ({ onSnapshot: () => () => {} }) }) }) }), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.reject(new Error('offline')) }) }) }; Object.defineProperty(navigator, 'onLine', { get: () => false }); }, prog);
  await pg.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' }); await sleep(1500);
  await pg.evaluate(() => document.querySelector('.tabs button[data-tab=seance]').click()); await sleep(400);
  const first = await pg.evaluate(() => { const c = document.querySelector('.ex.cur'); return c ? { id: c.dataset.ex, name: c.querySelector('.name').textContent } : null; });
  console.log('exercice courant :', first);
  await pg.evaluate(() => document.querySelector('.ex.cur [data-menu]').click()); await sleep(300);
  const hasSwap = await pg.evaluate(() => !!document.querySelector('#sheet.on [data-act=swap]')); console.log('menu « Remplacer » présent :', hasSwap);
  await pg.evaluate(() => document.querySelector('#sheet.on [data-act=swap]').click()); await sleep(600);
  const list = await pg.evaluate(() => Array.from(document.querySelectorAll('#sheet.on [data-pick]')).slice(0, 5).map(b => b.querySelector('.nm').textContent)); console.log('propositions même schéma :', list);
  await pg.evaluate(() => document.querySelector('#sheet.on [data-scope=cycle]').click()); await sleep(200);
  const pickName = await pg.evaluate(() => { const b = document.querySelector('#sheet.on [data-pick]'); const n = b.querySelector('.nm').textContent; b.click(); return n; }); await sleep(500);
  const after = await pg.evaluate(() => { const c = document.querySelector('.ex.cur'); return { name: c.querySelector('.name').textContent, tag: !!c.querySelector('.tag'), stored: JSON.stringify(JSON.parse(localStorage.getItem('rituel.state') || '{}').overrides || {}).slice(0, 160) }; });
  console.log('après remplacement :', pickName, '→', after);
  // rechargement : le remplacement persiste
  await pg.reload({ waitUntil: 'load' }); await sleep(1500); await pg.evaluate(() => document.querySelector('.tabs button[data-tab=seance]').click()); await sleep(400);
  const persisted = await pg.evaluate(() => document.querySelector('.ex.cur .name').textContent); console.log('après rechargement :', persisted);
  await pg.evaluate(() => document.querySelector('.ex.cur [data-menu]').click()); await sleep(300); await pg.evaluate(() => document.querySelector('#sheet.on [data-act=swap]').click()); await sleep(500);
  await pg.evaluate(() => document.querySelector('#swapUndo').click()); await sleep(400);
  const restored = await pg.evaluate(() => document.querySelector('.ex.cur .name').textContent); console.log('après rétablissement :', restored);
  console.log('erreurs JS :', errs);
  const ok = hasSwap && list.length > 0 && after.name.includes(pickName) && persisted.includes(pickName) && restored === first.name && !errs.length;
  console.log(ok ? 'OK' : 'ÉCHEC'); await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
