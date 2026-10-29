// Sensitivität: Wie verändert sich die Rangfolge der Strategien, wenn einzelne Parameter um ±20 % schwanken?
// Aufruf: node tools/sensitivity.mjs [seeds] [--json pfad]
import { writeFileSync } from 'node:fs';
import { loadConfig } from './load-config.mjs';
import { playSolo } from './simulate.mjs';
import { STRATEGIES } from './strategies.mjs';

const PARAMS = [
  ['elements.post.varCost', 'Post: Kosten pro Paket'],
  ['elements.box.leasing', 'Box: Miete pro Feld'],
  ['elements.hub.capacity', 'Hub: Kapazität'],
  ['elements.vanE.leasing', 'E-Van: Leasing'],
  ['elements.vanDiesel.driverCost', 'Fahrerlohn (alle Vans)'],
  ['elements.emergency.varCost', 'Notfall: Kosten pro Paket'],
  ['elements.crowd.varCost', 'Crowd: Kosten pro Paket'],
  ['zones.stadt.failRate', 'Fehlzustellung Stadt']
];
const KEYS = ['nichts', 'hubsGeschickt', 'boxenHubs', 'mixZonen', 'boxPost', 'stadtMax', 'zeitfenster'];

function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = val;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }

function evaluate(cfg, seeds) {
  const out = {};
  for (const k of KEYS) {
    let cost = 0, all = 0;
    for (let s = 1; s <= seeds; s++) {
      const { cum, standards } = playSolo(cfg, k, s);
      cost += cum.kpis.costPerParcel; all += standards.all ? 1 : 0;
    }
    out[k] = { cost: cost / seeds, all: all / seeds };
  }
  const ranking = [...KEYS].sort((a, b) => out[b].all - out[a].all || out[a].cost - out[b].cost);
  return { out, ranking };
}

export function runSensitivity(seeds = 30) {
  const base = loadConfig();
  const baseRes = evaluate(base, seeds);
  const rows = [];
  for (const [path, label] of PARAMS) {
    for (const f of [0.8, 1.2]) {
      const cfg = structuredClone(base);
      setPath(cfg, path, getPath(base, path) * f);
      if (path === 'elements.vanDiesel.driverCost') { cfg.elements.vanE.driverCost *= f; cfg.elements.hub.driverCost *= f; }
      const res = evaluate(cfg, seeds);
      rows.push({ path, label, factor: f, best: res.ranking[0], second: res.ranking[1], top2Same: res.ranking.slice(0, 2).sort().join() === baseRes.ranking.slice(0, 2).sort().join(), startFails: res.out.nichts.all === 0, results: res.out });
    }
  }
  return { seeds, base: baseRes, rows, labels: Object.fromEntries(KEYS.map((k) => [k, STRATEGIES[k].label])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runSensitivity(Number(process.argv[2] || 30));
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(res, null, 2));
  console.log('Basis:', res.base.ranking.slice(0, 3).join(' > '));
  for (const r of res.rows) console.log(r.label.padEnd(28), r.factor, r.best.padEnd(14), r.second.padEnd(14), r.top2Same ? 'stabil' : 'WECHSEL', r.startFails ? '' : 'START BESTEHT');
}
