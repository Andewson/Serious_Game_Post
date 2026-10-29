// Online-Mehrspielermodus über Supabase. Die Datenbank sammelt nur Aktionen;
// jedes Gerät rechnet den Spielstand mit dem Rechenkern selbst aus.
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JS } from './supabase-config.js';

let client = null;
let userId = null;

export async function initOnline() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lm-auth' }
  });
  let { data: { session } } = await client.auth.getSession();
  if (!session) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  userId = session.user.id;
  return client;
}

export function currentUserId() { return userId; }

function unwrap({ data, error }) {
  if (error) {
    const e = new Error(error.message || 'Fehler');
    e.code = /nicht gefunden/.test(error.message) ? 'notFound' : /läuft bereits/.test(error.message) ? 'running' : /voll/.test(error.message) ? 'full' : 'other';
    throw e;
  }
  return data;
}

export const OnlineBackend = {
  mode: 'online',
  async createGame({ rounds, configVersion }) {
    await initOnline();
    return unwrap(await client.rpc('create_game', { p_rounds: rounds, p_config_version: configVersion }));
  },
  async joinGame(code) {
    await initOnline();
    return unwrap(await client.rpc('join_game', { p_code: code }));
  },
  async startGame(gameId) {
    return unwrap(await client.rpc('start_game', { p_game: gameId }));
  },
  async submit(gameId, round, actions) {
    return unwrap(await client.rpc('submit_actions', { p_game: gameId, p_round: round, p_actions: actions }));
  },
  async skipMissing(gameId, minutes) {
    return unwrap(await client.rpc('skip_missing', { p_game: gameId, p_minutes: minutes }));
  },
  async saveResult(gameId, summary) {
    return unwrap(await client.rpc('save_result', { p_game: gameId, p_summary: summary }));
  },
  async loadGame(gameId) {
    await initOnline();
    const game = unwrap(await client.from('games').select('*').eq('id', gameId).single());
    const teams = unwrap(await client.from('teams').select('*').eq('game_id', gameId).order('slot'));
    const submissions = unwrap(await client.from('submissions').select('*').eq('game_id', gameId));
    const actions = unwrap(await client.from('actions').select('*').eq('game_id', gameId));
    return { game, teams, submissions, actions };
  },
  subscribe(gameId, onChange) {
    const ch = client.channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `game_id=eq.${gameId}` }, onChange)
      .subscribe();
    return () => client.removeChannel(ch);
  },
  async listFinished(limit = 50) {
    await initOnline();
    const games = unwrap(await client.from('games').select('id, code, created_at, finished_at, rounds, config_version, results(summary)').eq('status', 'finished').order('finished_at', { ascending: false }).limit(limit));
    return games;
  },
  async myOpenGames() {
    await initOnline();
    const teams = unwrap(await client.from('teams').select('game_id, slot, games(id, code, status, created_at)').eq('user_id', userId));
    return teams.filter((t) => t.games && t.games.status !== 'finished').map((t) => ({ ...t.games, slot: t.slot }));
  }
};

// Aktionen aus der Datenbank in das Format für replay(): nur vollständig abgeschlossene Runden
export function onlineActionsByRound(game, teams, actionRows) {
  const out = {};
  const resolved = game.status === 'finished' ? game.rounds : game.current_round - 1;
  for (let r = 1; r <= resolved; r++) {
    const rows = actionRows.filter((a) => a.round === r);
    out[r] = teams.map((t) => (rows.find((a) => a.slot === t.slot) || { actions: [] }).actions);
  }
  return out;
}
