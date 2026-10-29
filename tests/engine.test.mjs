import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../tools/load-config.mjs';
import { createGame, resolveRound, generateEvents, validateAction, scoreGame, cumulative, standardsOf, replay } from '../js/engine.js';
import { buildMap } from '../js/map.js';

const cfg = loadConfig();
const solo = (seed = 1) => createGame({ config: cfg, seed, teamNames: ['A'] });

test('Karte: 7 Stadt-, 11 Agglo-, 15 Landfelder in 3 Regionen', () => {
  const m = buildMap();
  const count = (z) => m.active.filter((f) => f.zone === z).length;
  assert.equal(count('stadt'), 7);
  assert.equal(count('agglo'), 11);
  assert.equal(count('land'), 15);
  for (const r of ['nord', 'ost', 'west']) assert.equal(m.active.filter((f) => f.region === r).length, 5);
});

test('Ereignisgenerator hält die Leitplanken ein (4–6 Runden, 300 Seeds)', () => {
  for (const rounds of [4, 5, 6]) {
    for (let seed = 1; seed <= 300; seed++) {
      const { announced, shocks } = generateEvents(seed, cfg, rounds);
      const zez = announced.find((a) => a.type === 'zez');
      const peak = announced.find((a) => a.type === 'peak');
      assert.ok(zez && zez.announceRound >= 1 && zez.effectRound - zez.announceRound === 2 && zez.effectRound <= rounds);
      assert.ok(peak && peak.announceRound >= 1 && peak.effectRound <= rounds);
      const shockRounds = shocks.map((s) => s.round);
      assert.equal(new Set(shockRounds).size, shockRounds.length, 'höchstens ein Schock pro Runde');
      assert.ok(shockRounds.every((r) => r >= 2 && r !== peak.effectRound));
      for (let r = 1; r <= rounds; r++) {
        const has = announced.some((a) => a.announceRound === r || a.effectRound === r) || shocks.some((s) => s.round === r);
        assert.ok(has, `Runde ${r} ohne Ereignis (Seed ${seed})`);
      }
    }
  }
});

test('Deterministisch: gleiche Eingaben ergeben gleiche Ergebnisse', () => {
  const acts = [[{ type: 'boxes', area: 'stadt' }, { type: 'post' }], [{ type: 'vans', field: 'S1', count: 2, drive: 'e' }], [], []];
  const run = () => { let s = solo(42); for (const a of acts) s = resolveRound(s, [a]); return JSON.stringify(cumulative(s.teams[0])); };
  assert.equal(run(), run());
});

test('Jedes Paket wird zugestellt: Zuteilung ergibt die Nachfrage', () => {
  let s = solo(3);
  s = resolveRound(s, [[{ type: 'post' }, { type: 'crowd', field: 'S1' }]]);
  const rep = s.teams[0].reports[0];
  for (const [id, rec] of Object.entries(rep.perField)) {
    const sum = rec.by.reduce((a, b) => a + b.n, 0);
    assert.ok(Math.abs(sum - rec.demand) < 1e-6, `Feld ${id}`);
  }
});

test('Post übernimmt nur Restmengen und verdrängt eigene Vans nicht', () => {
  let s = solo(5);
  s = resolveRound(s, [[{ type: 'post' }]]);
  const rep = s.teams[0].reports[0];
  const postParcels = Object.values(rep.perField).flatMap((r) => r.by).filter((b) => b.src === 'post').reduce((a, b) => a + b.n, 0);
  assert.ok(postParcels < 1e-6, 'eigene Land-Vans reichen, Post bekommt nichts');
});

test('Null-Emissions-Zone sperrt Diesel-Vans für Stadtfelder', () => {
  let s = solo(1);
  const zez = s.events.announced.find((a) => a.type === 'zez').effectRound;
  while (s.round <= zez && !s.finished) s = resolveRound(s, [[]]);
  const rep = s.teams[0].reports[zez - 1];
  assert.ok(rep.effects.zez);
  assert.ok(rep.zones.stadt.emergency / rep.zones.stadt.parcels > 0.99);
});

test('Fixkosten zusätzlicher Elemente werden voll in der Standortzone erfasst', () => {
  let s = solo(1);
  s = resolveRound(s, [[{ type: 'vans', field: 'A1', count: 1, drive: 'diesel' }]]);
  const rep = s.teams[0].reports[0];
  const base = resolveRound(solo(1), [[]]).teams[0].reports[0];
  const p = cfg.elements.vanDiesel;
  assert.ok(Math.abs(rep.zones.agglo.fixed - base.zones.agglo.fixed - (p.leasing + p.driverCost)) < 1e-6);
});

test('Hub und Box in der letzten Runde nicht wählbar, Hub nur in der Stadt', () => {
  let s = solo(1);
  assert.equal(validateAction(s, 0, { type: 'hub', field: 'A1' }).ok, false);
  assert.equal(validateAction(s, 0, { type: 'hub', field: 'S2' }).ok, true);
  while (s.round < s.rounds) s = resolveRound(s, [[]]);
  assert.equal(validateAction(s, 0, { type: 'hub', field: 'S2' }).ok, false);
  assert.equal(validateAction(s, 0, { type: 'boxes', area: 'stadt' }).ok, false);
});

test('Höchstens 2 Aktionen pro Runde werden angewendet', () => {
  let s = solo(1);
  s = resolveRound(s, [[{ type: 'post' }, { type: 'boxes', area: 'stadt' }, { type: 'crowd', field: 'S1' }]]);
  assert.equal(s.teams[0].actionsLog[0].actions.length, 2);
});

test('Wertung: Gleichstand teilt Rangpunkte, Startnetz verfehlt Standards', () => {
  let s = createGame({ config: cfg, seed: 9, teamNames: ['A', 'B'] });
  while (!s.finished) s = resolveRound(s, [[], []]);
  const sc = scoreGame(s);
  for (const t of sc.teams) assert.equal(t.points, 2, 'zwei identische Teams: je 0.5 Punkte pro KPI');
  assert.equal(sc.winner, null);
  assert.equal(sc.teams[0].standards.all, false);
});

test('Replay rechnet eine gespeicherte Partie identisch nach', () => {
  const acts = { 1: [[{ type: 'post' }]], 2: [[{ type: 'boxes', area: 'stadt' }]], 3: [[]], 4: [[]] };
  let s = solo(11);
  for (let r = 1; r <= 4; r++) s = resolveRound(s, acts[r]);
  const states = replay(cfg, { seed: 11, teamNames: ['A'], rounds: 4 }, acts);
  assert.equal(JSON.stringify(cumulative(states.at(-1).teams[0])), JSON.stringify(cumulative(s.teams[0])));
});

test('Mindeststandard pro Zone greift, auch wenn der Landesschnitt reicht', () => {
  const st = solo(1);
  const fakeCum = { kpis: { onTime: 0.95, costPerParcel: 4 }, zoneKpis: { stadt: { onTime: 1 }, agglo: { onTime: 1 }, land: { onTime: 0 } } };
  const r = standardsOf(st, fakeCum);
  assert.equal(r.onTimeNational, true);
  assert.equal(r.zones.land, false);
  assert.equal(r.all, false);
});
