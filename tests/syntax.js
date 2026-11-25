// Vérification de syntaxe du client sans exécution.
const fs = require('fs'); const path = require('path');
const f = path.join(__dirname, '..', 'public', 'app.js');
try { new Function(fs.readFileSync(f, 'utf8')); console.log('app.js : syntaxe OK'); } catch (e) { console.error('app.js : ' + e.message); process.exit(1); }
