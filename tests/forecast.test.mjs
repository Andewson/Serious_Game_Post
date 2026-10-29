import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../tools/load-config.mjs';
import { createGame, resolveRound } from '../js/engine.js';
import { forecastReport, optionSpecs, coverageOf } from '../js/forecast.js';

const cfg = loadConfig();
const plans = [
  [{ type: 'boxes', area: 'stadt' }, { type: 'post' }],
  [{ type: 'vans', field: 'S1', count: 2, drive: 'e' }, { type: 'hub', field: 'S2' }],
  [{ type: 'crowd', field: 'A5' }, { type: 'service', zone: 'stadt', policy: 'window' }],
  [{ type: 'convert', field: 'S1' }]
];

test('Prognose = echtes Ergebnis in Runden ohne Überraschung (100 Seeds)', () => {
  let compared = 0;
  for (let seed = 1; seed <= 100; seed++) {
    let s = createGame({ config: cfg, seed, teamNames: ['A', 'B'] });
    for (let r = 1; r <= s.rounds; r++) {
      const mine = plans[(seed + r) % plans.length];
      const fc = forecastReport(s, 0, mine);
      const next = resolveRound(s, [mine, []]);
      const real = next.teams[0].reports[r - 1];
      const shock = s.events.shocks.find((x) => x.round === r);
      if (!shock) {
        for (const k of Object.keys(real.kpis)) assert.ok(Math.abs(fc.kpis[k] - real.kpis[k]) < 1e-9, `Seed ${seed}, Runde ${r}, ${k}`);
        compared++;
      }
      s = next;
    }
  }
  assert.ok(compared > 150);
});

test('Prognose verrät keine Überraschung der laufenden Runde', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s0 = createGame({ config: cfg, seed, teamNames: ['A'] });
    let s = s0;
    for (let r = 1; r <= s.rounds; r++) {
      const shock = s.events.shocks.find((x) => x.round === r);
      const fc = forecastReport(s, 0, []);
      if (shock) {
        assert.equal(fc.effects.strike, false);
        if (shock.type === 'demandSurge') assert.equal(fc.effects.surgeZone, null);
        if (shock.type === 'fuel') assert.equal(fc.effects.fuel, false);
      }
      s = resolveRound(s, [[]]);
    }
  }
});

test('Kennzahlen: Kapazität und Kosten passen zum Rechenkern (ein E-Van in S1, voll ausgelastet)', () => {
  const s = createGame({ config: cfg, seed: 7, teamNames: ['A'] });
  const sp = optionSpecs(s, 'vanE', 'stadt');
  const E = cfg.elements.vanE;
  assert.ok(Math.abs(sp.capacity - E.capacity / (E.weight.stadt * (1 + cfg.zones.stadt.failRate))) < 1e-9);
  assert.ok(sp.fullCost > sp.variable && sp.fixed > 0);
  assert.equal(optionSpecs(s, 'hub', 'land').blocked, 'cityOnly');
  assert.equal(optionSpecs(s, 'post', 'stadt').blocked, 'landOnly');
});

test('Abdeckung: Quellen summieren sich zur Nachfrage', () => {
  const s = createGame({ config: cfg, seed: 3, teamNames: ['A'] });
  const rep = forecastReport(s, 0, [{ type: 'post' }]);
  for (const z of ['stadt', 'agglo', 'land']) {
    const c = coverageOf(rep, z);
    assert.ok(Math.abs(c.box + c.own + c.post + c.crowd + c.emergency - c.demand) < 1e-6, z);
  }
});

test('Ausblick verrät keine Überraschung der nächsten Runde', async () => {
  const { outlookReport } = await import('../js/forecast.js');
  for (let seed = 1; seed <= 200; seed++) {
    let s = createGame({ config: cfg, seed, teamNames: ['A'] });
    for (let r = 1; r < s.rounds; r++) {
      const nx = outlookReport(s, 0, []);
      const shockNext = s.events.shocks.find((x) => x.round === r + 1);
      if (shockNext && shockNext.type === 'strike') assert.equal(nx.effects.strike, false);
      if (shockNext && shockNext.type === 'demandSurge') assert.equal(nx.effects.surgeZone, null);
      const peak = s.events.announced.find((a) => a.type === 'peak');
      if (peak.effectRound === r + 1) assert.ok(peak.announceRound <= r && nx.effects.peak);
      s = resolveRound(s, [[]]);
    }
  }
});
