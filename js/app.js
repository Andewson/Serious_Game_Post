// Einstieg: lädt die Spielzahlen, zeigt Startseite und steuert lokale und Online-Spiele.
import { h, clear, TEAM_COLORS } from './ui/dom.js';
import { t, setLang, getLang, fmtChf, fmtPct, fmtG } from './i18n.js';
import { replay, createGame, scoreGame, ZONES, KPI_KEYS } from './engine.js';
import { LocalBackend, localActionsByRound } from './backend-local.js';
import { OnlineBackend, initOnline, currentUserId, onlineActionsByRound } from './backend-online.js';
import { ROUND_TIME_LIMIT_MINUTES } from './supabase-config.js';
import { GameScreen } from './ui/game-screen.js';
import { finalReportView, exportCsv, buildSummary, fmtKpi } from './ui/report.js';

const app = document.getElementById('app');
let CONFIG = null;
let cleanup = null; // Abo/Timer der aktuellen Ansicht

async function loadConfig() {
  const res = await fetch('config/params.json', { cache: 'no-cache' });
  return res.json();
}

function topbar() {
  return h('div', { class: 'topbar' },
    h('button', { class: 'brand', onclick: () => nav('home'), 'aria-label': t('home') },
      h('span', { class: 'logo', html: '<svg viewBox="0 0 32 32" width="24" height="24"><polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#141414"/><path d="M8 19V12h10v7M18 14h4l3 3v2" stroke="#fff" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="12" cy="21" r="2" fill="#fff"/><circle cx="22" cy="21" r="2" fill="#fff"/></svg>' }),
      t('appTitle')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small ghost', onclick: () => nav('rules') }, t('rules')),
    h('button', { class: 'btn small', 'aria-label': getLang() === 'de' ? 'English' : 'Deutsch', onclick: () => { setLang(getLang() === 'de' ? 'en' : 'de'); current && current.rerender ? current.rerender() : nav(currentRoute.name, currentRoute.params); } }, t('lang')));
}

let current = null;
let currentRoute = { name: 'home', params: {} };

function nav(name, params = {}) {
  if (cleanup) { cleanup(); cleanup = null; }
  current = null;
  currentRoute = { name, params };
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  clear(app);
  app.append(topbar());
  const main = h('div');
  app.append(main);
  const screens = { home: Home, newOnline: NewOnline, join: Join, newLocal: NewLocal, lobby: Lobby, game: Game, history: History, stats: Stats, rules: Rules, final: Final };
  (screens[name] || Home)(main, params);
  window.scrollTo(0, 0);
}

function errorBox(msg) { return h('div', { class: 'notice' }, msg); }
function onlineError(e) {
  if (e && e.code === 'notFound') return t('errNotFound');
  if (e && e.code === 'running') return t('errRunning');
  if (e && e.code === 'full') return t('errFull');
  return `${t('errOnline')} (${e && e.message ? e.message : e})`;
}

// ---------- Startseite ----------
function Home(root) {
  const page = h('div', { class: 'page' });
  page.append(h('div', { class: 'home' },
    h('div', {},
      h('h1', {}, t('appTitle')),
      h('p', { class: 'muted', style: { fontSize: '16px' } }, t('tagline')),
      h('p', { class: 'lead' }, t('intro')),
      h('p', { class: 'goal' }, t('goal'))),
    h('div', { class: 'card mapcard', id: 'heroMap' })));
  page.append(h('div', { class: 'menu' },
    h('button', { class: 'tile primary', onclick: () => nav('newOnline') }, h('strong', {}, t('newOnline')), h('span', { class: 'small' }, `2–5 ${t('teams')}, ${t('online')}`)),
    h('button', { class: 'tile', onclick: () => nav('join') }, h('strong', {}, t('joinGame')), h('span', { class: 'small' }, t('joinHint'))),
    h('button', { class: 'tile', onclick: () => nav('newLocal') }, h('strong', {}, t('localGame')), h('span', { class: 'small' }, `1–5 ${t('teams')}, ${t('localHint')}`)),
    h('button', { class: 'tile', onclick: () => nav('history') }, h('strong', {}, t('history')), h('span', { class: 'small' }, t('historyHint'))),
    h('button', { class: 'tile', onclick: () => nav('stats') }, h('strong', {}, t('stats')), h('span', { class: 'small' }, t('statsHint'))),
    h('button', { class: 'tile', onclick: () => nav('rules') }, h('strong', {}, t('rules')), h('span', { class: 'small' }, t('rulesTitle')))));
  const resume = h('div', { class: 'resume', style: { marginTop: '12px' } });
  page.append(resume);
  root.append(page);
  import('./ui/map-view.js').then(({ renderMap }) => renderMap(document.getElementById('heroMap'), { teamIdx: 0, elements: [], zezState: 'announced' }));
  // Offene Spiele zum Weiterspielen
  const localOpen = (() => { try { return JSON.parse(localStorage.getItem('lm-local-games') || '[]').filter((g) => g.status === 'running'); } catch { return []; } })();
  const box = h('div', { class: 'card' }, h('h3', { style: { marginBottom: '4px' } }, t('resumeTitle')));
  let any = false;
  for (const g of localOpen.slice(0, 3)) {
    any = true;
    box.append(h('div', { class: 'rowline' }, h('span', {}, `${t('local')} · ${new Date(g.createdAt).toLocaleString()} · ${g.teamNames.length} ${t('teams')}`), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => nav('game', { mode: 'local', id: g.id }) }, t('open'))));
  }
  if (any) resume.append(box);
  OnlineBackend.myOpenGames().then((games) => {
    for (const g of games.slice(0, 3)) {
      if (!any) { resume.append(box); any = true; }
      box.append(h('div', { class: 'rowline' }, h('span', {}, `${t('online')} · ${g.code} · ${g.status === 'lobby' ? t('stLobby') : t('stRunning')}`), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => nav(g.status === 'lobby' ? 'lobby' : 'game', { mode: 'online', id: g.id }) }, t('open'))));
    }
  }).catch(() => {});
}

// ---------- Neues Online-Spiel ----------
function roundsPicker(state) {
  return h('div', { class: 'row' }, h('span', {}, t('rounds')), h('div', { class: 'seg' }, [4, 5, 6].map((n) => h('button', { class: state.rounds === n ? 'sel' : '', onclick: (e) => { state.rounds = n; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === e.target)); } }, String(n)))));
}

function NewOnline(root) {
  const st = { rounds: CONFIG.rounds };
  const msg = h('div');
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    btn.disabled = true; clear(msg).append(h('p', { class: 'muted' }, t('connecting')));
    try {
      const game = await OnlineBackend.createGame({ rounds: st.rounds, configVersion: CONFIG.version });
      nav('lobby', { mode: 'online', id: game.id });
    } catch (e) { clear(msg).append(errorBox(onlineError(e))); btn.disabled = false; }
  } }, t('create'));
  root.append(h('div', { class: 'page' }, h('div', { class: 'card stack', style: { maxWidth: '520px' } },
    h('h2', {}, t('newOnline')), roundsPicker(st), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => nav('home') }, t('back')), btn), msg)));
}

function Join(root, params) {
  const input = h('input', { type: 'text', class: 'code', placeholder: 'ABC-12', value: params.code || '', maxlength: 6 });
  const msg = h('div');
  const go = async () => {
    clear(msg).append(h('p', { class: 'muted' }, t('connecting')));
    try {
      const team = await OnlineBackend.joinGame(input.value);
      const { game } = await OnlineBackend.loadGame(team.game_id);
      nav(game.status === 'lobby' ? 'lobby' : 'game', { mode: 'online', id: team.game_id });
    } catch (e) { clear(msg).append(errorBox(onlineError(e))); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  root.append(h('div', { class: 'page' }, h('div', { class: 'card stack', style: { maxWidth: '520px' } },
    h('h2', {}, t('joinGame')), h('label', { class: 'stack' }, h('span', {}, t('code')), input),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => nav('home') }, t('back')), h('button', { class: 'btn primary', onclick: go }, t('join'))), msg)));
  input.focus();
}

function NewLocal(root) {
  const st = { rounds: CONFIG.rounds, teams: 2 };
  root.append(h('div', { class: 'page' }, h('div', { class: 'card stack', style: { maxWidth: '520px' } },
    h('h2', {}, t('localGame')),
    h('div', { class: 'row' }, h('span', {}, t('teams')), h('div', { class: 'seg' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: st.teams === n ? 'sel' : '', onclick: (e) => { st.teams = n; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === e.target)); } }, String(n))))),
    roundsPicker(st),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => nav('home') }, t('back')),
      h('button', { class: 'btn primary', onclick: () => { const g = LocalBackend.createGame({ teamCount: st.teams, rounds: st.rounds, configVersion: CONFIG.version }); nav('game', { mode: 'local', id: g.id }); } }, t('start'))))));
}

// ---------- Warteraum (online) ----------
function Lobby(root, params) {
  const page = h('div', { class: 'page' });
  root.append(page);
  let stop = null;
  let poll = null;
  let sig = '';
  const draw = async () => {
    let data;
    try { data = await OnlineBackend.loadGame(params.id); } catch (e) { clear(page).append(errorBox(onlineError(e))); return; }
    const { game, teams } = data;
    if (game.status !== 'lobby') { nav('game', params); return; }
    // Nur neu zeichnen, wenn sich etwas geändert hat (sonst gehen Klicks verloren)
    const nextSig = `${getLang()}|${teams.map((x) => x.slot + x.name).join(',')}`;
    if (nextSig === sig) return;
    sig = nextSig;
    const isHost = game.created_by === currentUserId();
    clear(page).append(h('div', { class: 'card stack', style: { maxWidth: '640px' } },
      h('h2', {}, t('lobbyTitle')), h('p', {}, t('lobbyShare')), h('div', { class: 'bigcode' }, game.code),
      h('p', { class: 'muted small' }, `${t('rounds')}: ${game.rounds}`),
      h('div', { class: 'stack' }, teams.map((tm) => h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.slot] } }), h('strong', {}, tm.name), tm.user_id === currentUserId() ? h('span', { class: 'pill accent' }, t('lobbyYou')) : null))),
      isHost
        ? h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async (e) => { e.target.disabled = true; try { await OnlineBackend.startGame(game.id); nav('game', params); } catch (err) { page.append(errorBox(onlineError(err))); } } }, t('start'), ` (${teams.length} ${t('teams')})`))
        : h('p', { class: 'muted' }, t('lobbyWaiting'))));
  };
  draw().then(() => {
    try { stop = OnlineBackend.subscribe(params.id, () => draw()); } catch { /* Polling reicht */ }
    poll = setInterval(draw, 6000);
  });
  cleanup = () => { if (stop) stop(); if (poll) clearInterval(poll); };
}

// ---------- Spiel ----------
function Game(root, params) {
  if (params.mode === 'local') return LocalGame(root, params);
  return OnlineGame(root, params);
}

function LocalGame(root, params) {
  const game = LocalBackend.load(params.id);
  if (!game) { root.append(h('div', { class: 'page' }, errorBox(t('errNotFound')))); return; }
  const compute = () => replay(CONFIG, { seed: game.seed, teamNames: game.teamNames, rounds: game.rounds }, localActionsByRound(game)).at(-1);
  const submittedFor = (round) => new Set(Object.keys(game.actions[round] || {}).map(Number));
  const controller = {
    meta: { mode: 'local', id: game.id, code: game.code },
    mySlots: game.teamNames.map((_, i) => i),
    activeSlot: 0,
    state: compute(),
    submittedSlots: new Set(),
    exportCsv: () => exportCsv(controller.state, controller.meta),
    async submit(slot, actions) {
      const round = controller.state.round;
      const done = LocalBackend.submit(game, round, slot, actions);
      controller.submittedSlots = submittedFor(round);
      if (done) {
        controller.state = compute();
        controller.submittedSlots = submittedFor(controller.state.finished ? -1 : controller.state.round);
        controller.activeSlot = 0;
        if (controller.state.finished && !game.summary) LocalBackend.saveSummary(game, buildSummary(controller.state, controller.meta));
        screen.render();
        screen.showReport(round);
      } else {
        const next = controller.mySlots.find((sl) => !controller.submittedSlots.has(sl));
        if (next != null) controller.activeSlot = next;
        screen.render();
      }
    }
  };
  controller.submittedSlots = submittedFor(controller.state.round);
  const firstOpen = controller.mySlots.find((sl) => !controller.submittedSlots.has(sl));
  if (firstOpen != null) controller.activeSlot = firstOpen;
  let screen = GameScreen(root, controller, nav);
  current = { rerender: () => { clear(app); app.append(topbar()); const m = h('div'); app.append(m); root = m; screen = GameScreen(m, controller, nav); } };
}

async function OnlineGame(root, params) {
  root.append(h('div', { class: 'page' }, h('p', { class: 'muted' }, t('connecting'))));
  let data;
  try { await initOnline(); data = await OnlineBackend.loadGame(params.id); } catch (e) { clear(root).append(h('div', { class: 'page' }, errorBox(onlineError(e)))); return; }
  const me = currentUserId();
  let lastResolved = -1;
  let screen = null;
  let sig = '';
  const signature = (d) => `${d.game.status}|${d.game.current_round}|${d.teams.length}|${d.submissions.map((x) => `${x.round}:${x.slot}`).sort().join(',')}`;
  const controller = {
    meta: { mode: 'online', id: params.id, code: data.game.code },
    mySlots: [],
    activeSlot: 0,
    state: null,
    submittedSlots: new Set(),
    exportCsv: () => exportCsv(controller.state, controller.meta),
    canSkip: () => data.game.status === 'running' && data.game.round_started_at && (Date.now() - new Date(data.game.round_started_at).getTime()) > ROUND_TIME_LIMIT_MINUTES * 60000,
    async skip() { try { await OnlineBackend.skipMissing(params.id, ROUND_TIME_LIMIT_MINUTES); await refresh(); } catch (e) { alertBox(onlineError(e)); } },
    async submit(slot, actions) {
      try { await OnlineBackend.submit(params.id, controller.state.round, actions); } catch (e) { alertBox(onlineError(e)); }
      await refresh();
    }
  };
  if (data.game.config_version !== CONFIG.version) controller.versionNote = t('versionMismatch', { a: data.game.config_version, b: CONFIG.version });

  function apply(d) {
    data = d;
    const { game, teams, submissions, actions } = d;
    if (game.status === 'lobby') { nav('lobby', params); return false; }
    const mine = teams.find((x) => x.user_id === me);
    controller.mySlots = mine ? [mine.slot] : [];
    controller.activeSlot = mine ? mine.slot : 0;
    const acts = onlineActionsByRound(game, teams, actions);
    controller.state = replay(CONFIG, { seed: Number(game.seed), teamNames: teams.map((x) => x.name), rounds: game.rounds }, acts).at(-1);
    const round = game.status === 'finished' ? -1 : game.current_round;
    controller.submittedSlots = new Set(submissions.filter((x) => x.round === round).map((x) => x.slot));
    return true;
  }

  async function refresh() {
    let d;
    try { d = await OnlineBackend.loadGame(params.id); } catch { return; }
    const nextSig = signature(d);
    if (screen && nextSig === sig) return; // nichts Neues: Eingaben und Scrollposition bleiben unberührt
    sig = nextSig;
    const before = lastResolved;
    if (!apply(d)) return;
    const resolved = controller.state.finished ? controller.state.rounds : controller.state.round - 1;
    lastResolved = resolved;
    if (!screen) { clear(root); screen = GameScreen(root, controller, nav); }
    else screen.render();
    if (before >= 0 && resolved > before && controller.mySlots.length) screen.showReport(resolved);
    if (controller.state.finished && controller.mySlots.length) {
      OnlineBackend.saveResult(params.id, buildSummary(controller.state, controller.meta)).catch(() => {});
    }
  }

  function alertBox(msg) {
    const o = h('div', { class: 'overlay' }, h('div', { class: 'modal' }, h('div', { class: 'body', style: { paddingTop: '18px' } }, errorBox(msg), h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => o.remove() }, t('close'))))));
    document.body.append(o);
  }

  if (!apply(data)) return;
  sig = signature(data);
  lastResolved = controller.state.finished ? controller.state.rounds : controller.state.round - 1;
  clear(root);
  screen = GameScreen(root, controller, nav);
  current = { rerender: () => { clear(app); app.append(topbar()); const m = h('div'); app.append(m); root = m; screen = GameScreen(m, controller, nav); } };
  let stop = null;
  try { stop = OnlineBackend.subscribe(params.id, () => refresh()); } catch { /* Polling reicht */ }
  const poll = setInterval(refresh, 8000);
  let skipShown = false; // «Fehlende überspringen» erst nach Ablauf der Zeit einblenden, und nur einmal neu zeichnen
  const tick = setInterval(() => { const can = !!controller.canSkip(); if (can !== skipShown && screen) { skipShown = can; screen.render(); } }, 30000);
  cleanup = () => { if (stop) stop(); clearInterval(poll); clearInterval(tick); };
}

// ---------- Schlussbericht aus dem Verlauf ----------
async function Final(root, params) {
  const page = h('div', { class: 'page' }, h('p', { class: 'muted' }, t('loading')));
  root.append(page);
  let state; let meta;
  try {
    if (params.mode === 'local') {
      const g = LocalBackend.load(params.id);
      state = replay(CONFIG, { seed: g.seed, teamNames: g.teamNames, rounds: g.rounds }, localActionsByRound(g)).at(-1);
      meta = { mode: 'local', id: g.id, code: g.code };
    } else {
      const d = await OnlineBackend.loadGame(params.id);
      state = replay(CONFIG, { seed: Number(d.game.seed), teamNames: d.teams.map((x) => x.name), rounds: d.game.rounds }, onlineActionsByRound(d.game, d.teams, d.actions)).at(-1);
      meta = { mode: 'online', id: d.game.id, code: d.game.code };
    }
  } catch (e) { clear(page).append(errorBox(onlineError(e))); return; }
  clear(page).append(h('h1', {}, t('finalTitle'), ' ', h('span', { class: 'muted', style: { fontSize: '1rem' } }, meta.code)),
    finalReportView(state, { onHome: () => nav('history'), onExport: () => exportCsv(state, meta) }));
}

// ---------- Vergangene Spiele ----------
async function History(root) {
  const page = h('div', { class: 'page' }, h('h1', {}, t('history')));
  const list = h('div', { class: 'card' }, h('p', { class: 'muted' }, t('loading')));
  page.append(list);
  root.append(page);
  const rows = LocalBackend.listFinished().map((g) => ({ mode: 'local', id: g.id, code: t('local'), date: g.summary.date || g.createdAt, summary: g.summary }));
  try {
    const online = await OnlineBackend.listFinished(80);
    for (const g of online) {
      const res = Array.isArray(g.results) ? g.results[0] : g.results;
      rows.push({ mode: 'online', id: g.id, code: g.code, date: g.finished_at, summary: res ? res.summary : null });
    }
  } catch { /* nur lokale Spiele */ }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  clear(list);
  if (!rows.length) { list.append(h('p', { class: 'muted' }, t('historyEmpty'))); return; }
  list.append(h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, t('date')), h('th', {}, t('code')), h('th', {}, t('teams')), h('th', {}, t('winner')), h('th', {}, ''))),
    h('tbody', {}, rows.map((r) => {
      const s = r.summary;
      const win = s && s.winner != null ? (s.teams.find((x) => x.idx === s.winner) || {}).name : '–';
      return h('tr', {},
        h('td', {}, new Date(r.date).toLocaleString()), h('td', {}, r.code), h('td', {}, s ? s.teams.map((x) => x.name).join(', ') : '–'), h('td', {}, win || '–'),
        h('td', {}, h('button', { class: 'btn small', onclick: () => nav('final', { mode: r.mode, id: r.id }) }, t('open'))));
    }))));
}

// ---------- Statistiken ----------
async function Stats(root) {
  const page = h('div', { class: 'page' }, h('h1', {}, t('stats')));
  const body = h('div', {}, h('p', { class: 'muted' }, t('loading')));
  page.append(body);
  root.append(page);
  const summaries = LocalBackend.listFinished().map((g) => g.summary);
  try {
    for (const g of await OnlineBackend.listFinished(200)) {
      const res = Array.isArray(g.results) ? g.results[0] : g.results;
      if (res && res.summary) summaries.push(res.summary);
    }
  } catch { /* nur lokal */ }
  const same = summaries.filter((s) => s && s.v === CONFIG.version);
  clear(body);
  if (!same.length) { body.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, t('statsEmpty')))); return; }
  const teams = same.flatMap((s) => s.teams);
  const avg = Object.fromEntries(KPI_KEYS.map((k) => [k, teams.reduce((a, x) => a + x.kpis[k], 0) / teams.length]));
  const qualified = teams.filter((x) => x.standards.all).length / teams.length;
  const winners = same.filter((s) => s.winner != null).map((s) => s.teams.find((x) => x.idx === s.winner)).filter(Boolean);
  const built = { stadt: {}, agglo: {}, land: {} };
  for (const w of winners) for (const z of ZONES) for (const [k, n] of Object.entries(w.built[z] || {})) built[z][k] = (built[z][k] || 0) + n / winners.length;
  body.append(
    h('p', { class: 'muted small' }, t('configNote', { v: CONFIG.version })),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, t('gamesPlayed')), h('div', { class: 'v' }, String(same.length))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, t('teamsPlayed')), h('div', { class: 'v' }, String(teams.length))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, t('shareQualified')), h('div', { class: 'v' }, fmtPct(qualified))),
      h('div', { class: 'kpi' }, h('div', { class: 'l' }, t('winner')), h('div', { class: 'v' }, `${winners.length}/${same.length}`))),
    h('div', { class: 'card', style: { marginTop: '12px' } }, h('h3', { style: { marginBottom: '8px' } }, t('avgKpis')),
      h('div', { class: 'kpis' }, KPI_KEYS.map((k) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, t('kpi_' + k)), h('div', { class: 'v' }, fmtKpi(k, avg[k])))))),
    h('div', { class: 'card' }, h('h3', { style: { marginBottom: '8px' } }, t('winnersBuilt')),
      winners.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('zone')), h('th', {}, 'Ø'))),
        h('tbody', {}, ZONES.map((z) => h('tr', {}, h('td', {}, t('zone_' + z)), h('td', { style: { textAlign: 'left' } }, Object.entries(built[z]).map(([k, n]) => `${t('el_' + k)} ${n.toFixed(1)}`).join(' · ') || '–')))))
        : h('p', { class: 'muted' }, '–')));
}

// ---------- Regeln ----------
function Rules(root) {
  const c = CONFIG;
  const E = c.elements;
  const S = c.standards;
  const de = getLang() === 'de';
  const row = (kind, fix, varc, cap, co2, fail, note) => h('tr', {}, h('td', {}, t('el_' + kind)), h('td', {}, fix), h('td', {}, varc), h('td', {}, cap), h('td', {}, co2), h('td', {}, fail), h('td', { style: { textAlign: 'left' } }, note));
  root.append(h('div', { class: 'page rulesheet' }, h('div', { class: 'card' },
    h('h1', {}, t('rulesTitle')),
    h('p', { style: { fontSize: '15px', lineHeight: '22px', marginTop: '8px' } }, t('goal')),
    h('h3', {}, de ? 'Ablauf einer Runde' : 'Round flow'),
    h('ol', {},
      h('li', {}, de ? 'Lage lesen: Fahrplan mit den angekündigten Ereignissen, Prognose, Karte. Rote Felder bekommen in der Prognose Pakete vom Notfall-Subunternehmer.' : 'Read the situation: the timeline of announced events, the forecast, the map. Red fields get parcels from the emergency subcontractor in the forecast.'),
      h('li', {}, de ? `Bis zu ${c.actionsPerRound} Aktionen wählen. Vor dem Hinzufügen zeigt das Spiel die Wirkung auf die Prognose dieser Runde.` : `Choose up to ${c.actionsPerRound} actions. Before you add one, the game shows its effect on this round's forecast.`),
      h('li', {}, de ? 'Abgeben.' : 'Submit.'),
      h('li', {}, de ? 'Wenn alle abgegeben haben: Überraschung aufdecken, Runde wird berechnet.' : 'When everyone has submitted: the surprise is revealed and the round is calculated.'),
      h('li', {}, de ? 'Rundenbericht lesen – Ursachen pro Zone.' : 'Read the round report – causes per zone.')),
    h('p', {}, de ? `Ein Spiel hat ${c.rounds} Runden (wählbar 4–6). Jedes Team hat in jedem Feld eigene Pakete; niemand nimmt anderen etwas weg. Gemeinsam ist nur der Arbeitsmarkt: Je mehr Fahrer alle Teams zusammen beschäftigen, desto stärker steigen die Löhne für alle.`
      : `A game has ${c.rounds} rounds (4–6 selectable). Each team has its own parcels in every field; nobody takes anything from others. Only the labour market is shared: the more drivers all teams employ together, the faster wages rise for everyone.`),
    h('h3', {}, de ? 'Elemente' : 'Elements'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, t('fixPerRound')), h('th', {}, t('varPerParcel')), h('th', {}, t('capacity')), h('th', {}, t('co2')), h('th', {}, t('failRate')), h('th', {}, ''))),
      h('tbody', {},
        row('vanDiesel', fmtChf(E.vanDiesel.leasing + E.vanDiesel.driverCost), `${fmtChf(E.vanDiesel.varCost)}×D`, `${E.vanDiesel.capacity}`, `${fmtG(E.vanDiesel.co2)}×D`, 'Zone', de ? 'Reichweite 2; ab Null-Emissions-Zone nicht in der Stadt' : 'Range 2; banned from city once the zone applies'),
        row('vanE', fmtChf(E.vanE.leasing + E.vanE.driverCost), `${fmtChf(E.vanE.varCost)}×D`, `${E.vanE.capacity}`, `${fmtG(E.vanE.co2)}×D`, 'Zone', de ? 'Reichweite 2' : 'Range 2'),
        row('hub', fmtChf(E.hub.leasing + E.hub.driverCost * E.hub.drivers), fmtChf(E.hub.varCost + E.hub.resupplyCost), `${E.hub.capacity}`, fmtG(E.hub.co2 + E.hub.resupplyCo2), 'Zone', de ? 'nur Stadt, Reichweite 1, ab nächster Runde' : 'city only, range 1, from next round'),
        row('box', `${fmtChf(E.box.leasing)}/Feld`, fmtChf(E.box.varCost + E.box.resupplyCost), `${fmtPct(E.box.acceptance)}`, fmtG(E.box.resupplyCo2), fmtPct(E.box.failRate, 1), de ? 'pro Gebiet, ab nächster Runde' : 'per area, from next round'),
        row('post', fmtChf(E.post.feePerRegion * 3), fmtChf(E.post.varCost), de ? 'Rest' : 'remainder', fmtG(E.post.co2), fmtPct(E.post.failRate), de ? `nur Land, ${fmtPct(E.post.onTimeRate)} pünktlich` : `countryside only, ${fmtPct(E.post.onTimeRate)} on time`),
        row('crowd', '–', fmtChf(E.crowd.varCost), `${E.crowd.capacity}`, `${fmtG(E.crowd.co2)}×D`, fmtPct(E.crowd.failRate), de ? 'nur diese Runde, Reichweite 2' : 'this round only, range 2'),
        row('emergency', '–', fmtChf(E.emergency.varCost), '∞', `${fmtG(E.emergency.co2)}×D`, fmtPct(E.emergency.failRate), de ? 'automatisch für jeden Rest – immer verspätet' : 'automatic for any remainder – always late'))),
    h('p', { class: 'small muted' }, de ? `D = Distanzfaktor: Stadt ${c.zones.stadt.distance}, Agglo ${c.zones.agglo.distance}, Land ${c.zones.land.distance}. Fahrzeuge schaffen in Agglo und Land weniger Pakete (längere Wege). Fehlzustellungen ohne Zeitfenster: Stadt ${fmtPct(c.zones.stadt.failRate)}, Agglo ${fmtPct(c.zones.agglo.failRate)}, Land ${fmtPct(c.zones.land.failRate)}.`
      : `D = distance factor: city ${c.zones.stadt.distance}, suburbs ${c.zones.agglo.distance}, countryside ${c.zones.land.distance}. Vehicles deliver fewer parcels in suburbs and countryside (longer routes). Failed deliveries without time windows: city ${fmtPct(c.zones.stadt.failRate)}, suburbs ${fmtPct(c.zones.agglo.failRate)}, countryside ${fmtPct(c.zones.land.failRate)}.`),
    h('h3', {}, de ? 'Pünktlich' : 'On time'),
    h('p', {}, de ? 'Pünktlich ist ein Paket, das am nächsten Tag erfolgreich ankommt. Scheitert der erste Versuch, ist es verspätet und kostet eine Zweitzustellung.' : 'A parcel is on time if it arrives successfully the next day. A failed first attempt makes it late and costs a second attempt.'),
    h('h3', {}, t('standards')),
    h('ul', {}, h('li', {}, t('std_onTimeNational', { v: fmtPct(S.onTimeNational) })), h('li', {}, t('std_zone', { zone: de ? 'jeder Zone' : 'every zone', v: fmtPct(S.onTimeZone) })), h('li', {}, t('std_cost', { v: c.tariffPerParcel.toFixed(2) }))),
    h('p', {}, de ? 'Wertung: Pro KPI gibt es Rangpunkte (beste = meiste). Gewinnen kann nur, wer alle Mindeststandards erfüllt; unter diesen Teams zählen die Punkte.' : 'Scoring: rank points per KPI (best = most). Only teams meeting all minimum standards can win; among them, points decide.'),
    h('h3', {}, de ? 'Ereignisse' : 'Events'),
    h('p', {}, de ? 'Ankündigungen (Null-Emissions-Zone, Black Friday, CO₂-Abgabe, Boxen beliebter) seht ihr im Voraus. Überraschungen (Streik, Treibstoffpreis, Fahrermangel, Nachfrageschub) werden erst nach eurer Abgabe aufgedeckt – Puffer lohnen sich.' : 'Announcements (zero-emission zone, Black Friday, CO₂ levy, lockers popular) are visible in advance. Surprises (strike, fuel price, driver shortage, demand surge) are revealed only after you submit – buffers pay off.'),
    h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => history.length > 1 ? nav('home') : nav('home') }, t('home'))))));
}

// ---------- Start ----------
(async () => {
  setLang(getLang());
  try { CONFIG = await loadConfig(); } catch (e) { app.append(errorBox('config/params.json konnte nicht geladen werden.')); return; }
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('join')) nav('join', { code: hash.get('join') });
  else if (hash.has('demo')) { const g = LocalBackend.createGame({ teamCount: 2, rounds: CONFIG.rounds, configVersion: CONFIG.version }); history.replaceState(null, '', location.pathname); nav('game', { mode: 'local', id: g.id }); }
  else nav('home');
})();
