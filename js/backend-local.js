// Spiele auf einem Gerät: alles im Browser-Speicher (localStorage).
import { TEAM_NAMES } from './engine.js';

const KEY = 'lm-local-games';
let memory = null; // Ersatz, falls localStorage gesperrt ist

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return memory || []; }
}
function writeAll(list) {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* nur im Speicher */ }
}

export const LocalBackend = {
  mode: 'local',
  createGame({ teamCount, rounds, configVersion }) {
    const game = {
      id: `local-${Date.now().toString(36)}`,
      code: 'LOKAL',
      mode: 'local',
      createdAt: new Date().toISOString(),
      seed: Math.floor(Math.random() * 2147483647),
      rounds,
      configVersion,
      teamNames: TEAM_NAMES.slice(0, teamCount),
      actions: {}, // round -> { slot: [actions] }
      status: 'running',
      summary: null
    };
    writeAll([game, ...readAll()].slice(0, 50));
    return game;
  },
  load(id) { return readAll().find((g) => g.id === id) || null; },
  update(game) {
    const list = readAll();
    const i = list.findIndex((g) => g.id === game.id);
    if (i >= 0) list[i] = game; else list.unshift(game);
    writeAll(list);
  },
  submit(game, round, slot, actions) {
    game.actions[round] = game.actions[round] || {};
    game.actions[round][slot] = actions;
    const done = Object.keys(game.actions[round]).length >= game.teamNames.length;
    if (done && round >= game.rounds) game.status = 'finished';
    this.update(game);
    return done;
  },
  saveSummary(game, summary) { game.summary = summary; this.update(game); },
  listFinished() { return readAll().filter((g) => g.status === 'finished' && g.summary); },
  remove(id) { writeAll(readAll().filter((g) => g.id !== id)); }
};

// Aktionen in das Format für replay(): {runde: [aktionenTeam0, aktionenTeam1, ...]}
export function localActionsByRound(game) {
  const out = {};
  for (const [round, bySlot] of Object.entries(game.actions)) {
    if (Object.keys(bySlot).length < game.teamNames.length) continue;
    out[round] = game.teamNames.map((_, i) => bySlot[i] || []);
  }
  return out;
}
