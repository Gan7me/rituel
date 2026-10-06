/* Modèle simulé pour le banc de test local : répond comme l'API du coach (liste des modèles, messages),
   avec des réponses construites à partir du schéma demandé. Aucun appel réseau sortant.
   Variables : PORT (4010), MOCK_NO_FORCED_TOOL=1 pour imiter un modèle qui refuse tool_choice "tool". */
const http = require('http');
const PORT = Number(process.env.PORT || 4010);
const NO_FORCED = process.env.MOCK_NO_FORCED_TOOL === '1';
const CALLS = [];

function sample(schema, key) {
  if (!schema) return 'ok';
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': { const o = {}; Object.entries(schema.properties || {}).forEach(([k, v]) => { o[k] = sample(v, k); }); return o; }
    case 'array': { const n = Math.max(schema.minItems || 0, 2); return Array.from({ length: n }, (_, i) => sample(schema.items, key + i)); }
    case 'integer': return key === 'sets' ? 3 : key === 'restSec' ? 90 : key === 'rir' ? 2 : 3;
    case 'number': return key === 'load' ? 82.5 : 1;
    case 'boolean': return false;
    default: {
      if (key === 'exId') return 'EXID';
      if (key === 'demoId') return 'Pullups';
      if (key === 'status') return 'up';
      if (key === 'reps') return '8-10';
      if (key === 'tempo') return '2-0-1-0';
      if (key === 'name' || key === 'title') return 'Réponse simulée ' + (key || '');
      const max = schema.maxLength || 120; return ('Texte simulé pour ' + key + '. ').repeat(3).slice(0, Math.max(10, max - 1));
    }
  }
}
function fillIds(obj, ids) { // les schémas d'analyse attendent des identifiants d'exercice réels : on en met un par entrée
  const walk = (o, depth) => { if (Array.isArray(o)) o.forEach((x, i) => { if (x && typeof x === 'object' && 'exId' in x) x.exId = ids[i % ids.length] || ids[0]; walk(x, depth + 1); }); else if (o && typeof o === 'object') Object.values(o).forEach(v => walk(v, depth + 1)); };
  walk(obj, 0); return obj;
}
function programJSON() {
  const ex = (n, name, machine, target) => ({ n, name, machine, alt: 'Alternative ' + name, star: n === 1, sets: 4, reps: '6-8', per: '', rir: [3, 2, 1, 4], tempo: '3-1-X-0', restSec: 150, restText: '2 min 30', mode: 'normal', reco: 'Machine à charge guidée, siège incliné.', why: 'Base de force du programme.', target, exec: 'Dos plaqué, descente contrôlée, pousser sans verrouiller.', seek: 'Tension continue sur le muscle cible.', url: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(machine) });
  return {
    cycleName: 'Mésocycle test · Fondations · octobre 2026', rationale: '## Lecture\nProgramme simulé pour le banc de test.', nutrition: 'Cibles simulées : 2 600 kcal, 160 g de protéines.',
    warmup: { common: 'Vélo 5 min.', jambes: 'Squat au poids du corps 2 × 10.', push: 'Élévations légères.', ramp: 'Deux séries de montée en charge.' },
    durationWeeks: 4, cycleReason: 'Standard.',
    sessions: [
      { id: 's1', day: 1, dayName: 'Lundi', name: 'Jambes A', sub: 'quadriceps, force', duration: '60 min', place: '', gtg: false, note: '', exercises: [ex(1, 'Hack squat', 'Hack squat machine', 'quadriceps'), ex(2, 'Presse à cuisses', 'Leg press', 'quadriceps'), ex(3, 'Leg curl assis', 'Seated leg curl', 'ischio-jambiers'), ex(4, 'Leg extension', 'Leg extension', 'quadriceps'), ex(5, 'Mollets debout', 'Standing calf', 'mollets')] },
      { id: 's2', day: 3, dayName: 'Mercredi', name: 'Push A', sub: 'pectoraux, triceps', duration: '60 min', place: '', gtg: false, note: '', exercises: [ex(1, 'Développé couché', 'Barre', 'pectoraux'), ex(2, 'Développé incliné haltères', 'Haltères', 'pectoraux haut'), ex(3, 'Dips', 'Station dips', 'triceps'), ex(4, 'Élévations latérales', 'Haltères', 'deltoïdes'), ex(5, 'Extension triceps poulie', 'Poulie haute', 'triceps')] },
      { id: 's3', day: 5, dayName: 'Vendredi', name: 'Pull A', sub: 'dos, biceps', duration: '60 min', place: '', gtg: true, note: '', exercises: [ex(1, 'Tractions', 'Station de traction', 'dos'), ex(2, 'Rowing barre', 'Barre', 'dos'), ex(3, 'Tirage vertical', 'Lat pulldown', 'dos'), ex(4, 'Curl barre', 'Barre EZ', 'biceps'), ex(5, 'Face pull', 'Poulie', 'arrière d\'épaule')] }
    ]
  };
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/v1/models')) return json(200, { data: [{ id: 'claude-sonnet-simule' }, { id: 'claude-opus-simule' }] });
    if (req.url === '/v1/messages' && req.method === 'POST') {
      let b = {}; try { b = JSON.parse(body); } catch (e) {}
      CALLS.push({ t: Date.now(), tools: !!b.tools, tool_choice: b.tool_choice && b.tool_choice.type, max_tokens: b.max_tokens });
      const usage = { input_tokens: 1200, output_tokens: 400 };
      if (b.tools && b.tools.length) {
        if (NO_FORCED && b.tool_choice && (b.tool_choice.type === 'tool' || b.tool_choice.type === 'any')) return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported for this model.' } });
        const schema = b.tools[0].input_schema; const text = JSON.stringify(b.messages);
        const ids = Array.from(new Set((text.match(/\b[a-z0-9]+-\d+\b/g) || []).filter(x => /^s\d+-\d+$/.test(x) || /-\d+$/.test(x)))).slice(0, 8);
        const input = fillIds(sample(schema, ''), ids.length ? ids : ['s1-1']);
        return json(200, { id: 'msg_sim', type: 'message', role: 'assistant', model: b.model, stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'tu_1', name: b.tools[0].name, input }] });
      }
      const sys = String(b.system || ''); const last = (b.messages || []).slice(-1)[0]; const user = last && typeof last.content === 'string' ? last.content : '';
      if (/Construis le mésocycle|Réponds UNIQUEMENT avec un objet JSON/i.test(user)) return json(200, { id: 'msg_sim', type: 'message', role: 'assistant', model: b.model, stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 6000 }, content: [{ type: 'text', text: 'Voici le programme :\n```json\n' + JSON.stringify(programJSON()) + '\n```' }] });
      return json(200, { id: 'msg_sim', type: 'message', role: 'assistant', model: b.model, stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Réponse simulée du coach à : « ' + user.slice(0, 60) + ' ». Tu gardes la charge et tu vises le haut de la cible.' }] });
    }
    if (req.url === '/__calls') return json(200, CALLS);
    json(404, { error: 'not found' });
  });
});
server.listen(PORT, () => console.log('mock model on ' + PORT + (NO_FORCED ? ' (sans tool_choice forcé)' : '')));
