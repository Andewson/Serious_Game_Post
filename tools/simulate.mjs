// Spielt alle Teststrategien über viele Zufallsstartwerte durch.
// Aufruf: node tools/simulate.mjs [anzahlSeeds] [--json pfad]
import { writeFileSync } from 'node:fs';
import { loadConfig } from './load-config.mjs';
import { createGame, resolveRound, scoreGame, cumulative, standardsOf } from '../js/engine.js';
import { STRATEGIES } from './strategies.mjs';

export function playSolo(cfg, strategyKey, seed) {
  let s = createGame({ config: cfg, seed, teamNames: [strategyKey] });
  while (!s.finished) s = resolveRound(s, [STRATEGIES[strategyKey].play(s, 0)]);
  const cum = cumulative(s.teams[0]);
  return { cum, standards: standardsOf(s, cum), state: s };
}

export function playMatch(cfg, keys, seed) {
  let s = createGame({ config: cfg, seed, teamNames: keys });
  while (!s.finished) s = resolveRound(s, keys.map((k, i) => STRATEGIES[k].play(s, i)));
  return { score: scoreGame(s), state: s };
}

export function runAll(cfg, nSeeds = 60) {
  const solo = {};
  for (const key of Object.keys(STRATEGIES)) {
    const agg = { cost: 0, onTime: 0, co2: 0, fail: 0, allStd: 0, stdNat: 0, stdCost: 0, stdZones: 0, stadt: 0, agglo: 0, land: 0, share: 0 };
    for (let seed = 1; seed <= nSeeds; seed++) {
      const { cum, standards } = playSolo(cfg, key, seed);
      agg.cost += cum.kpis.costPerParcel; agg.onTime += cum.kpis.onTime; agg.co2 += cum.kpis.co2PerParcel; agg.fail += cum.kpis.failRate;
      agg.allStd += standards.all ? 1 : 0; agg.stdNat += standards.onTimeNational ? 1 : 0; agg.stdCost += standards.cost ? 1 : 0;
      agg.stdZones += Object.values(standards.zones).every(Boolean) ? 1 : 0;
      for (const z of ['stadt', 'agglo', 'land']) agg[z] += cum.zoneKpis[z].onTime;
      agg.share += cum.kpis.costPerParcel / (cum.kpis.costPerParcel + cfg.upstreamCostPerParcel);
    }
    for (const k of Object.keys(agg)) agg[k] /= nSeeds;
    solo[key] = { label: STRATEGIES[key].label, ...agg };
  }
  // Viererpartien: alle Strategien gegeneinander in festen Gruppen
  const groups = [
    ['mixZonen', 'hubsStadt', 'boxPost', 'nichts'],
    ['mixZonen', 'zeitfenster', 'stadtMax', 'vieleVans'],
    ['hubsGeschickt', 'boxPost', 'mixZonen', 'boxenHubs']
  ];
  const matches = groups.map((keys) => {
    const wins = Object.fromEntries(keys.map((k) => [k, 0]));
    const points = Object.fromEntries(keys.map((k) => [k, 0]));
    let noWinner = 0;
    for (let seed = 1; seed <= nSeeds; seed++) {
      const { score } = playMatch(cfg, keys, seed);
      if (score.winner == null) noWinner++; else wins[keys[score.winner]]++;
      for (const t of score.teams) points[keys[t.idx]] += t.points / nSeeds;
    }
    return { keys, wins, points, noWinner };
  });
  // Arbeitsmarkt: Wirkung von «Viele Vans» auf andere Teams
  const labour = (() => {
    const base = playMatch(cfg, ['mixZonen', 'mixZonen', 'mixZonen', 'mixZonen'], 7).score.teams[0].cum.kpis.costPerParcel;
    const withHirer = playMatch(cfg, ['mixZonen', 'mixZonen', 'mixZonen', 'vieleVans'], 7).score.teams[0].cum.kpis.costPerParcel;
    return { otherTeamCostWithout: base, otherTeamCostWith: withHirer };
  })();
  return { solo, matches, labour, nSeeds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] || 60);
  const res = runAll(loadConfig(), n);
  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(res, null, 2));
  const pct = (x) => (x * 100).toFixed(0).padStart(4) + '%';
  console.log('Strategie'.padEnd(24), 'Kosten', ' Pünktl', '  CO2', ' Fehl', ' Std-alle', 'Nat', 'Kost', 'Zonen', ' Stadt Agglo  Land');
  for (const [k, v] of Object.entries(res.solo)) {
    console.log(k.padEnd(24), v.cost.toFixed(2).padStart(6), pct(v.onTime), v.co2.toFixed(0).padStart(6), pct(v.fail), pct(v.allStd), pct(v.stdNat), pct(v.stdCost), pct(v.stdZones), pct(v.stadt), pct(v.agglo), pct(v.land));
  }
  for (const m of res.matches) console.log('Match', JSON.stringify(m.wins), 'ohne Sieger', m.noWinner, 'Punkte', JSON.stringify(Object.fromEntries(Object.entries(m.points).map(([k, v]) => [k, +v.toFixed(2)]))));
  console.log('Arbeitsmarkt', JSON.stringify(res.labour));
}
