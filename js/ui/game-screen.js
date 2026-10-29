// Spielbildschirm: links die Aktionen als illustrierte Karten mit Symbol-Bewertung, Mitte die Karte mit
// Kennzahl-Filter und das Netz, rechts der Stand (Urteil, vier KPIs mit Bewertung und Erklärung), Plan und Abgabe.
import { h, clear, TEAM_COLORS, icon } from './dom.js';
import { renderMap } from './map-view.js';
import { t, fmtChf, fmtPct, fmtG, fmtInt, fmtMoney } from '../i18n.js';
import { validateAction, knownSituation, ZONES, KPI_KEYS, cumulative, standardsOf, activeEffects } from '../engine.js';
import { buildMap, areaFields, AREAS } from '../map.js';
import { forecastReport, outlookReport, coverageOf, optionSpecs, windowEffect, rateKpi, optionRatings, fieldValue, lateReasons } from '../forecast.js';
import { eventTitle, eventDesc, roundReportView, finalReportView, fmtKpi } from './report.js';
import { art } from './art.js';
import { rating, symbol, ratingWord, KPI_SYMBOL, RATING_FILL } from './rating.js';

const LOWER_BETTER = { costPerParcel: true, onTime: false, co2PerParcel: true, failRate: true };
const OPTS = ['vanE', 'vanDiesel', 'convert', 'hub', 'box', 'post', 'crowd', 'service'];
const NEEDS_FIELD = new Set(['vanDiesel', 'vanE', 'convert', 'hub', 'crowd']);
const SPEC_KIND = { vanDiesel: 'vanDiesel', vanE: 'vanE', convert: 'vanE', hub: 'hub', box: 'box', post: 'post', crowd: 'crowd' };
const ART_KIND = { vanDiesel: 'vanDiesel', vanE: 'vanE', convert: 'convert', hub: 'hub', box: 'box', post: 'post', crowd: 'crowd', service: 'service', emergency: 'emergency' };
const narrow = () => window.matchMedia('(max-width: 820px)').matches;

// controller: { state, meta, mySlots, activeSlot, submittedSlots:Set, canSkip, submit(slot, actions), skip(), versionNote }
export function GameScreen(root, controller, nav) {
  const ui = { plan: {}, cfg: null, field: null, inspected: null, removeSel: {}, confirmEmpty: false, kpi: null, layer: 'net' };
  for (const sl of controller.mySlots) ui.plan[sl] = [];

  const slot = () => controller.activeSlot;
  const state = () => controller.state;
  const cfg = () => state().config;
  const team = () => state().teams[slot()];
  const plan = () => ui.plan[slot()] || (ui.plan[slot()] = []);
  const canPlay = () => controller.mySlots.includes(slot()) && !controller.submittedSlots.has(slot());
  const map = buildMap();
  const zoneOf = (id) => map.byId[id].zone;
  const r = () => state().round;

  let fc = null; let fcBase = null;
  function computeForecasts() {
    fc = forecastReport(state(), slot(), plan());
    fcBase = plan().length ? forecastReport(state(), slot(), []) : fc;
  }
  function resetConfig() { ui.cfg = null; ui.field = null; }

  function render() {
    const keepY = window.scrollY;
    clear(root);
    const st = state();
    if (st.finished) {
      root.append(h('div', { class: 'page' }, h('h1', { style: { marginBottom: '16px' } }, t('finalTitle')), finalReportView(st, { mySlots: controller.mySlots, onHome: () => nav('home'), onExport: controller.exportCsv })));
      return;
    }
    computeForecasts();
    root.append(gameBar());
    if (controller.versionNote) root.append(h('div', { style: { padding: '0 var(--pad) 12px' } }, h('div', { class: 'notice' }, controller.versionNote)));
    root.append(h('div', { class: 'game' },
      h('section', { class: 'panel palette', 'aria-label': t('optionsTitle') }, ui.cfg ? configurator() : optionList()),
      h('div', { class: 'canvascol' }, mapPanel(), networkPanel()),
      h('section', { class: 'panel status', 'aria-label': t('statusTitle') }, statusPanel())));
    window.scrollTo(0, keepY);
  }

  // ---------- Kopfzeile mit Fahrplan ----------
  function gameBar() {
    const st = state();
    const tm = team();
    return h('div', { class: 'gamebar' },
      h('div', { class: 'who' }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx], width: '12px', height: '12px' } }), h('h1', {}, tm.name),
        h('span', { class: 'sub' }, `${t('round')} ${st.round} ${t('of')} ${st.rounds}`)),
      timeline(),
      h('span', { class: 'spacer' }),
      controller.mySlots.length > 1 ? h('div', { class: 'teamtabs' }, controller.mySlots.map((sl) => h('button', {
        class: `teamtab ${sl === slot() ? 'sel' : ''}`,
        onclick: () => { controller.activeSlot = sl; resetConfig(); ui.inspected = null; ui.removeSel = {}; ui.confirmEmpty = false; render(); }
      }, h('span', { class: 'dot', style: { background: TEAM_COLORS[sl] } }), st.teams[sl].name, controller.submittedSlots.has(sl) ? h('span', { class: 'done' }, icon('check', 12)) : null))) : null,
      controller.meta.mode === 'online' && controller.meta.code ? h('span', { class: 'pill' }, `${t('code')} ${controller.meta.code}`) : null,
      st.round > 1 ? h('button', { class: 'btn small', onclick: () => showReport(st.round - 1) }, t('reportOf', { r: st.round - 1 })) : null);
  }

  function timeline() {
    const st = state();
    const k = knownSituation(st);
    const byRound = Array.from({ length: st.rounds }, () => []);
    for (const a of k.announcements) if (a.effectRound <= st.rounds) byRound[a.effectRound - 1].push({ text: t('evShort_' + a.type), full: eventTitle(a), cls: a.effectRound > st.round ? 'future' : '' });
    for (const sh of st.revealedShocks || []) byRound[sh.round - 1].push({ text: t('evShort_' + sh.type), full: eventTitle(sh), cls: 'shock' });
    return h('div', { class: 'timeline', role: 'list' }, byRound.map((evs, i) => {
      const rr = i + 1;
      return h('div', { class: `tl-round ${rr < st.round ? 'past' : rr === st.round ? 'now' : ''}`, role: 'listitem' },
        h('div', { class: 'r' }, t('inRound', { r: rr })),
        evs.map((e) => h('div', { class: `tl-ev ${e.cls}`, title: e.full }, e.text)));
    }));
  }

  // ---------- Aktionen als Karten ----------
  function availability(opt) {
    const st = state();
    const tm = team();
    const last = st.round >= st.rounds;
    if ((opt === 'hub' || opt === 'box') && last) return 'lastRound';
    if (opt === 'convert' && !tm.elements.some((e) => e.kind === 'van' && e.drive === 'diesel' && (e.removeFrom == null || e.removeFrom > st.round))) return 'noDiesel';
    if (opt === 'post') {
      if (tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > st.round)) return 'exists';
      if (plan().some((a) => a.type === 'post')) return 'planned';
    }
    return null;
  }

  function whenText(opt) {
    const rr = r();
    if (opt === 'hub' || opt === 'box') return t('fromNext', { r: rr + 1 });
    if (opt === 'crowd') return t('thisRoundOnly', { r: rr });
    return t('fromNow');
  }

  function tags(opt) {
    const E = cfg().elements;
    const out = [whenText(opt)];
    if (opt === 'vanDiesel' || opt === 'vanE' || opt === 'convert') out.push(t('rangeN', { n: E.vanE.range }));
    if (opt === 'hub') out.push(t('blocked_cityOnly'), t('rangeN1'));
    if (opt === 'crowd') out.push(t('rangeN', { n: E.crowd.range }));
    if (opt === 'post') out.push(t('blocked_landOnly'));
    if (opt === 'box') out.push(t('perAreaShort'));
    if (opt === 'vanDiesel' && zezState() !== 'none') out.push(t('notInZez'));
    if (opt === 'vanE' || opt === 'convert') out.push(t('okInZez'));
    return out;
  }

  function ratingRows(opt, size = 14, compact = false) {
    if (opt === 'service') return h('div', { class: 'rrows' }, h('div', { class: 'svc' }, t('svcEffect')));
    const kind = SPEC_KIND[opt] || opt;
    const rt = optionRatings(state(), kind);
    if (compact) {
      const cell = (sym, key, v) => h('div', { class: 'rc' }, h('span', { class: 'rl' }, t('rt_' + key)), rating(sym, v, size, t('rt_' + key)));
      return h('div', { class: 'rgrid' }, cell('coin', 'cost', rt.cost), cell('leaf', 'co2', rt.co2), cell('star', 'reliability', rt.reliability));
    }
    const row = (sym, key, v) => h('div', { class: 'rr' }, h('span', { class: 'rl' }, t('rt_' + key)), rating(sym, v, size, t('rt_' + key)));
    return h('div', { class: 'rrows' },
      row('coin', 'cost', rt.cost), row('leaf', 'co2', rt.co2), row('star', 'reliability', rt.reliability),
      Number.isFinite(rt.specs.capacity) ? h('div', { class: 'rr cap' }, h('span', { class: 'rl' }, t('rt_capacity')), h('span', {}, t('capShort', { n: fmtInt(rt.specs.capacity), zone: t('zone_' + rt.zone) }))) : null);
  }

  function capTag(opt) {
    if (opt === 'service') return null;
    const rt = optionRatings(state(), SPEC_KIND[opt] || opt);
    return Number.isFinite(rt.specs.capacity) ? t(opt === 'box' ? 'capTagField' : 'capTag', { n: fmtInt(rt.specs.capacity) }) : null;
  }

  function optionList() {
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'panel-h' }, h('h2', {}, t('optionsTitle')), h('span', { class: 'meta' }, t('planCount', { n: plan().length, max: cfg().actionsPerRound }))));
    wrap.append(h('p', { class: 'note', style: { marginTop: 0, marginBottom: '12px' } }, t('optsIntro')));
    const full = plan().length >= cfg().actionsPerRound;
    const cards = h('div', { class: 'cards' });
    for (const opt of OPTS) {
      const off = availability(opt);
      const canClick = !off && canPlay() && !full;
      const name = t('opt_' + opt);
      cards.append(h('button', {
        class: `ocard ${off ? 'off' : ''}`, disabled: canClick ? null : true,
        onclick: canClick ? () => startConfig(opt) : null
      },
      h('div', { class: `oart a-${opt}`, html: art(ART_KIND[opt]) }),
      h('div', { class: 'obody' },
        h('div', { class: 'oname' }, name),
        h('div', { class: 'owhy' }, off ? t('blocked_' + off) : whyText(opt)),
        ratingRows(opt, 12, true),
        h('div', { class: 'otags' }, [capTag(opt), ...tags(opt)].filter(Boolean).slice(0, 2).map((x) => h('span', { class: 'tag' }, x))))));
    }
    // Notfall als Hinweis
    const em = optionRatings(state(), 'emergency');
    cards.append(h('div', { class: 'ocard ref' },
      h('div', { class: 'oart a-emergency', html: art('emergency') }),
      h('div', { class: 'obody' }, h('div', { class: 'oname' }, t('opt_emergency')), h('div', { class: 'owhy' }, t('why_emergency')),
        h('div', { class: 'rgrid' },
          h('div', { class: 'rc' }, h('span', { class: 'rl' }, t('rt_cost')), rating('coin', em.cost, 12)),
          h('div', { class: 'rc' }, h('span', { class: 'rl' }, t('rt_co2')), rating('leaf', em.co2, 12)),
          h('div', { class: 'rc' }, h('span', { class: 'rl' }, t('rt_reliability')), rating('star', em.reliability, 12))))));
    wrap.append(cards);
    wrap.append(h('p', { class: 'note' }, t('ratingNote')));
    wrap.append(h('div', { style: { marginTop: '8px' } }, h('button', { class: 'linkbtn small', onclick: openCompare }, t('compareAll'))));
    return wrap;
  }

  function whyText(opt) {
    if (opt === 'box') return t('why_box', { acc: fmtPct(cfg().elements.box.acceptance) });
    return t('why_' + opt);
  }

  function startConfig(opt) {
    ui.cfg = { opt, count: 1, area: 'stadt', zone: 'stadt', details: false };
    ui.field = null; ui.inspected = null; ui.confirmEmpty = false; ui.layer = 'net'; ui.kpi = null;
    render();
    if (NEEDS_FIELD.has(opt) && !narrow()) document.querySelector('.mapwell')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- Konfigurator ----------
  function selectableFor(opt) {
    const tm = team();
    const rr = r();
    if (opt === 'convert') {
      const fields = new Set(tm.elements.filter((e) => e.kind === 'van' && e.drive === 'diesel' && (e.removeFrom == null || e.removeFrom > rr)).map((e) => e.field));
      return (id) => fields.has(id);
    }
    if (opt === 'hub') return (id) => zoneOf(id) === 'stadt';
    return () => true;
  }

  function currentAction() {
    const c = ui.cfg;
    if (!c) return null;
    switch (c.opt) {
      case 'vanDiesel': return ui.field ? { type: 'vans', field: ui.field, count: c.count, drive: 'diesel' } : null;
      case 'vanE': return ui.field ? { type: 'vans', field: ui.field, count: c.count, drive: 'e' } : null;
      case 'convert': return ui.field ? { type: 'convert', field: ui.field } : null;
      case 'hub': return ui.field ? { type: 'hub', field: ui.field } : null;
      case 'crowd': return ui.field ? { type: 'crowd', field: ui.field } : null;
      case 'box': return { type: 'boxes', area: c.area };
      case 'post': return { type: 'post' };
      case 'service': return { type: 'service', zone: c.zone, policy: team().service[c.zone] === 'window' ? 'standard' : 'window' };
      default: return null;
    }
  }

  function configurator() {
    const c = ui.cfg;
    const box = h('div', { class: 'config' });
    box.append(h('button', { class: 'btn ghost small back', onclick: () => { resetConfig(); render(); } }, '← ', t('backToList')));
    box.append(h('div', { class: `cart a-${c.opt}`, html: art(ART_KIND[c.opt]) }));
    const title = c.opt === 'service' && team().service[c.zone] === 'window' ? t('opt_serviceOff') : t('opt_' + c.opt);
    box.append(h('h3', {}, title), h('p', { class: 'desc' }, whyText(c.opt)));
    box.append(ratingRows(c.opt, 16));

    const seg = (vals, cur, label, onPick) => h('div', { class: 'seg' }, vals.map((v) => h('button', { class: v === cur ? 'sel' : '', onclick: () => onPick(v) }, label(v))));
    const steps = h('div', { class: 'steps' });
    if (c.opt === 'vanDiesel' || c.opt === 'vanE') steps.append(h('div', { class: 'ctl' }, h('span', {}, t('count')), seg([1, 2, 3], c.count, String, (v) => { c.count = v; render(); })));
    if (c.opt === 'box') {
      steps.append(h('div', { class: 'ctl' }, h('span', {}, t('chooseArea')),
        h('select', { onchange: (e) => { c.area = e.target.value; render(); }, 'aria-label': t('chooseArea') },
          AREAS.map((a) => h('option', { value: a, selected: c.area === a ? true : null }, `${t('area_' + a)} (${areaFields(a).length} ${t('fields')})`)))));
    }
    if (c.opt === 'service') {
      steps.append(h('div', { class: 'ctl' }, h('span', {}, t('zone')), seg(ZONES, c.zone, (v) => t('zone_' + v), (v) => { c.zone = v; render(); })));
      steps.append(h('p', { class: 'small muted' }, `${t('selected')}: ${t('policy_' + team().service[c.zone])} → ${t('policy_' + (team().service[c.zone] === 'window' ? 'standard' : 'window'))}`));
    }
    if (NEEDS_FIELD.has(c.opt)) {
      steps.append(ui.field
        ? h('div', { class: 'step done' }, h('span', {}, t('pickedField', { id: ui.field, zone: t('zone_' + zoneOf(ui.field)) })), h('span', { class: 'spacer' }), h('button', { class: 'linkbtn small', onclick: () => { ui.field = null; render(); } }, t('change')))
        : h('div', { class: 'step' }, h('span', { class: 'k' }, '→'), h('span', {}, t('pickOnMap'))));
      if (narrow()) { const mm = h('div', { class: 'minimap' }); steps.append(mm); drawMap(mm, true); }
    }
    box.append(steps);
    const action = currentAction();
    const v = action ? validateAction(state(), slot(), action, plan()) : null;
    box.append(effectBlock(action, v));
    if (action && !v.ok) box.append(h('p', { class: 'err' }, t('err_' + v.error)));
    // Genaue Werte auf Wunsch
    const det = h('details', { class: 'details', open: c.details ? true : null, ontoggle: (e) => { c.details = e.target.open; } }, h('summary', {}, t('exactValues')), specWell());
    box.append(det);
    box.append(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => { resetConfig(); render(); } }, t('cancel')), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', disabled: !action || !v.ok ? true : null, onclick: () => addAction(action) }, t('addToPlan'))));
    return box;
  }

  function specZone() {
    const c = ui.cfg;
    if (ui.field) return zoneOf(ui.field);
    if (c.opt === 'box') return ['stadt', 'agglo'].includes(c.area) ? c.area : 'land';
    if (c.opt === 'post') return 'land';
    return c.zone || 'stadt';
  }

  function specWell() {
    const c = ui.cfg;
    const z = specZone();
    if (c.opt === 'service') {
      const w = windowEffect(state(), z);
      return h('div', { class: 'kv' },
        h('div', { class: 'cap' }, t('specZone', { zone: t('zone_' + z) })),
        h('div', { class: 'r' }, h('span', {}, t('capacity')), h('b', {}, `−${fmtPct(w.capacityLoss)}`)),
        h('div', { class: 'r' }, h('span', {}, t('failRate')), h('b', {}, `${fmtPct(w.failBefore)} → ${fmtPct(w.failAfter)}`)));
    }
    const sp = optionSpecs(state(), SPEC_KIND[c.opt], z);
    const n = c.opt === 'vanDiesel' || c.opt === 'vanE' ? c.count : c.opt === 'box' ? areaFields(c.area).length : 1;
    const rows = [];
    const row = (k, v) => rows.push(h('div', { class: 'r' }, h('span', {}, k), h('b', {}, v)));
    if (sp.blocked) rows.push(h('div', { class: 'r' }, h('span', { class: 'bad' }, t('blocked_' + sp.blocked)), h('b', {}, '')));
    row(t('spec_fixed'), fmtMoney(sp.fixed * n));
    if (Number.isFinite(sp.capacity)) row(t('spec_capacity'), `${fmtInt(sp.capacity * n)} ${t('parcels')}`);
    row(t('spec_fullS'), fmtChf(sp.fullCost));
    row(t('spec_variable'), fmtChf(sp.variable));
    if (sp.tax > 0.005) row(t('spec_tax'), fmtChf(sp.tax));
    row(t('spec_co2'), fmtG(sp.co2));
    row(t('spec_onTime'), fmtPct(sp.onTime));
    const cap = n > 1 ? `${t('specZone', { zone: t('zone_' + z) })} · ${c.opt === 'box' ? `${n} ${t('fields')}` : t('nVehicles', { n })}` : t('specZone', { zone: t('zone_' + z) });
    return h('div', { class: 'kv' }, h('div', { class: 'cap' }, cap), rows);
  }

  function effectBlock(action, v) {
    const rr = r();
    if (!action) return h('div', { class: 'effect' }, h('div', { class: 'eh' }, t('effectTitle', { r: rr })), h('p', { class: 'note', style: { marginTop: 0 } }, t('effectNeedsField')));
    if (!v.ok) return h('div');
    if (action.type === 'hub' || action.type === 'boxes') {
      const before = outlookReport(state(), slot(), plan());
      const later = outlookReport(state(), slot(), [...plan(), action]);
      return h('div', { class: 'effect' }, h('div', { class: 'eh' }, t('effectTitle', { r: rr + 1 })), later ? effectRows(before, later) : null, h('p', { class: 'note' }, t('effectLater', { r: rr + 1 })));
    }
    const after = forecastReport(state(), slot(), [...plan(), action]);
    return h('div', { class: 'effect' }, h('div', { class: 'eh' }, t('effectTitle', { r: rr })), effectRows(fc, after));
  }

  function deltaText(k, d) {
    if (Math.abs(d) < 1e-6) return '±0';
    const sign = d > 0 ? '+' : '−';
    const a = Math.abs(d);
    if (k === 'costPerParcel') return `${sign}${a.toFixed(2)}`;
    if (k === 'co2PerParcel') return `${sign}${Math.round(a)} g`;
    return `${sign}${(a * 100).toFixed(1)} Pkt.`;
  }
  const goodBad = (k, d) => (Math.abs(d) < 1e-6 ? '' : (LOWER_BETTER[k] ? d < 0 : d > 0) ? 'good' : 'bad');

  // Vorher → nachher mit Bewertung
  function effectRows(before, after) {
    return h('div', { class: 'erows' }, KPI_KEYS.map((k) => {
      const d = after.kpis[k] - before.kpis[k];
      return h('div', { class: 'er' },
        h('span', { class: 'el' }, symbol(KPI_SYMBOL[k], true, 14), t('kpiShort_' + k)),
        rating(KPI_SYMBOL[k], rateKpi(cfg(), k, after.kpis[k]), 13),
        h('span', { class: 'ev' }, fmtKpi(k, after.kpis[k])),
        h('span', { class: `ed ${goodBad(k, d)}` }, deltaText(k, d)));
    }));
  }

  function addAction(action) {
    const p = plan();
    if (p.length >= cfg().actionsPerRound) return;
    p.push(action);
    resetConfig(); ui.confirmEmpty = false;
    render();
  }

  // ---------- Karte mit Filter ----------
  function zezState() {
    const st = state();
    const a = st.events.announced.find((x) => x.type === 'zez');
    if (!a || a.announceRound > st.round) return 'none';
    return st.round >= a.effectRound ? 'active' : 'announced';
  }

  function shortVal(k, v) {
    if (k === 'costPerParcel') return v.toFixed(2);
    if (k === 'co2PerParcel') return String(Math.round(v));
    return `${Math.round(v * 100)}%`;
  }

  function metricFor(k) {
    const fill = {}; const text = {}; const tip = {};
    for (const [fid, rec] of Object.entries(fc.perField)) {
      const v = fieldValue(rec, k);
      const rt = rateKpi(cfg(), k, v);
      fill[fid] = RATING_FILL[rt];
      text[fid] = shortVal(k, v);
      tip[fid] = `${t('kpi_' + k)} ${fmtKpi(k, v)} · ${ratingWord(rt)}`;
    }
    return { fill, text, tip };
  }

  function drawMap(box, compact = false) {
    const st = state();
    const tm = team();
    const rr = st.round;
    const elements = tm.elements.filter((e) => e.removeFrom == null || e.removeFrom > rr).map((e) => ({ ...e, pending: e.activeFrom > rr }));
    for (const a of plan()) {
      if (a.type === 'vans') for (let i = 0; i < a.count; i++) elements.push({ kind: 'van', drive: a.drive, field: a.field, pending: false });
      if (a.type === 'hub') elements.push({ kind: 'hub', field: a.field, pending: true });
    }
    const c = ui.cfg;
    const picking = c && NEEDS_FIELD.has(c.opt) && canPlay();
    const E = cfg().elements;
    let rangePreview = null;
    if (picking) rangePreview = c.opt === 'hub' ? { range: E.hub.range, zones: E.hub.zones } : { range: c.opt === 'crowd' ? E.crowd.range : E.vanE.range };
    const post = tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > rr) ? (tm.post.activeFrom > rr ? 'pending' : 'active') : (plan().some((a) => a.type === 'post') ? 'active' : null);
    const layer = picking || compact ? 'net' : ui.layer;
    const emergency = {};
    for (const [fid, rec] of Object.entries(fc.perField)) emergency[fid] = rec.demand ? rec.by.filter((b) => b.src === 'emergency').reduce((a, b) => a + b.n, 0) / rec.demand : 0;
    renderMap(box, {
      teamIdx: tm.idx, elements, crowd: plan().filter((a) => a.type === 'crowd').map((a) => ({ field: a.field })), post, zezState: zezState(),
      selectable: picking ? selectableFor(c.opt) : null, selectedField: picking ? ui.field : null, rangePreview,
      onSelect: (id) => { ui.field = id; render(); },
      emergency,
      metric: layer !== 'net' ? metricFor(layer) : null,
      inspected: compact ? null : ui.inspected,
      onInspect: compact ? null : (id) => { ui.inspected = ui.inspected === id ? null : id; render(); }
    });
  }

  function mapPanel() {
    const well = h('div', { class: 'mapwell' });
    const c = ui.cfg;
    const picking = c && NEEDS_FIELD.has(c.opt) && canPlay();
    if (!picking) {
      well.append(h('div', { class: 'layers', role: 'tablist', 'aria-label': t('mapView') },
        h('button', { class: ui.layer === 'net' ? 'sel' : '', role: 'tab', onclick: () => { ui.layer = 'net'; render(); } }, t('layer_net')),
        KPI_KEYS.map((k) => h('button', { class: ui.layer === k ? 'sel' : '', role: 'tab', onclick: () => { ui.layer = k; ui.kpi = k; render(); } }, symbol(KPI_SYMBOL[k], true, 14), t('kpiShort_' + k)))));
    }
    const mapBox = h('div', { style: { position: 'relative' } });
    well.append(mapBox);
    drawMap(mapBox);
    if (picking) {
      well.append(h('div', { class: 'maptools' }, h('div', { class: 'banner' },
        ui.field ? t('pickedField', { id: ui.field, zone: t('zone_' + zoneOf(ui.field)) }) : t('pickBanner', { what: t('opt_' + c.opt) }),
        h('button', { onclick: () => { resetConfig(); render(); } }, t('cancel')))));
    }
    if (ui.inspected && !picking) well.append(fieldCard(ui.inspected));
    well.append(mapLegend(picking));
    return well;
  }

  function mapLegend(picking) {
    if (!picking && ui.layer !== 'net') {
      const k = ui.layer;
      const thr = cfg().ratings.kpi[k];
      const fmt = (v) => (k === 'costPerParcel' ? v.toFixed(2) : k === 'co2PerParcel' ? `${v} g` : fmtPct(v, k === 'failRate' ? 1 : 0));
      const better = LOWER_BETTER[k] ? '≤' : '≥';
      const items = [5, 4, 3, 2, 1].map((rt, i) => h('span', {}, h('span', { class: 'swatch', style: { background: RATING_FILL[rt] } }), i < 4 ? `${ratingWord(rt)} ${better} ${fmt(thr[i])}` : ratingWord(rt)));
      return h('div', { class: 'legend' }, h('strong', {}, t('kpi_' + k), ' ', t('perField')), items, h('span', { class: 'muted' }, t('legendClick')));
    }
    return h('div', { class: 'legend' },
      ...['stadt', 'agglo', 'land'].map((z) => h('span', {}, h('span', { class: 'swatch', style: { background: `var(--zone-${z})` } }), t('zone_' + z))),
      zezState() !== 'none' ? h('span', {}, h('span', { class: 'swatch', style: { border: '2px dashed var(--zez)' } }), t('ev_zez')) : null,
      h('span', {}, h('span', { class: 'swatch', style: { background: 'rgba(196,36,42,.25)', border: '2px solid var(--negative)' } }), t('legendEmergency')),
      h('span', {}, h('span', { class: 'swatch', style: { background: '#2e7d32' } }), t('el_vanE')),
      h('span', {}, h('span', { class: 'swatch', style: { background: '#141414' } }), `${t('el_vanDiesel')}, Hub, Box`));
  }

  function elementLabel(id) {
    const el = team().elements.find((e) => e.id === id);
    if (!el) return t('plannedEl');
    const kind = el.kind === 'van' ? (el.drive === 'diesel' ? 'vanDiesel' : 'vanE') : el.kind;
    return `${t('el_' + kind)} ${el.field}`;
  }

  function fieldCard(id) {
    const rec = fc.perField[id];
    const f = map.byId[id];
    const agg = {};
    for (const b of rec.by) {
      const label = b.src === 'box' ? t('src_box') : b.src === 'post' ? t('src_post') : b.src === 'crowd' ? t('src_crowd') : b.src === 'emergency' ? t('el_emergency') : elementLabel(b.src);
      agg[label] = (agg[label] || 0) + b.n;
    }
    return h('div', { class: 'fieldcard', role: 'dialog', 'aria-label': id },
      h('button', { class: 'btn ghost small x', onclick: () => { ui.inspected = null; render(); }, 'aria-label': t('close') }, icon('x', 14)),
      h('strong', {}, `${id} · ${t('zone_' + f.zone)}`), f.region ? h('span', { class: 'muted' }, ` · ${t('region_' + f.region)}`) : null,
      h('div', { class: 'r', style: { marginTop: '6px' } }, h('span', { class: 'muted' }, t('fieldDemand')), h('b', {}, fmtInt(rec.demand))),
      KPI_KEYS.map((k) => { const v = fieldValue(rec, k); return h('div', { class: 'r' }, h('span', { class: 'muted' }, t('kpiShort_' + k)), h('span', { class: 'row', style: { gap: '6px' } }, rating(KPI_SYMBOL[k], rateKpi(cfg(), k, v), 11), h('b', {}, fmtKpi(k, v)))); }),
      h('div', { class: 'sub-h', style: { margin: '8px 0 2px', fontSize: '13px' } }, t('fieldServed')),
      Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, n]) => h('div', { class: 'r' }, h('span', { class: k === t('el_emergency') ? 'bad' : '' }, k), h('b', {}, fmtInt(n)))));
  }

  // ---------- Netz ----------
  function areaOfField(id) { const f = map.byId[id]; return f.zone === 'land' ? f.region : f.zone; }

  function networkGroups() {
    const st = state();
    const tm = team();
    const rr = st.round;
    const E = cfg().elements;
    const present = tm.elements.filter((e) => e.removeFrom == null || e.removeFrom > rr);
    const groups = new Map();
    for (const e of present) {
      const kind = e.kind === 'van' ? (e.drive === 'diesel' ? 'vanDiesel' : 'vanE') : e.kind;
      const loc = e.kind === 'box' ? areaOfField(e.field) : e.field;
      const key = `${kind}|${loc}`;
      if (!groups.has(key)) groups.set(key, { key, kind, loc, ids: [], pending: 0, zone: zoneOf(e.field) });
      const g = groups.get(key);
      g.ids.push(e.id);
      if (e.activeFrom > rr) g.pending++;
    }
    const util = {};
    for (const u of fc.utilization) util[u.id] = u;
    const out = [...groups.values()].map((g) => {
      let used = 0; let cap = 0;
      for (const id of g.ids) if (util[id]) { used += util[id].used; cap += util[id].capacity; }
      const unit = g.kind === 'vanDiesel' || g.kind === 'vanE' ? E[g.kind].leasing + E[g.kind].driverCost * E[g.kind].drivers * st.wage
        : g.kind === 'hub' ? E.hub.leasing + E.hub.driverCost * E.hub.drivers * st.wage : E.box.leasing;
      return { ...g, util: cap > 0 ? used / cap : null, fixed: unit * (g.ids.length - g.pending) };
    });
    const order = { stadt: 0, agglo: 1, land: 2 };
    out.sort((a, b) => order[a.zone] - order[b.zone] || a.loc.localeCompare(b.loc, 'de', { numeric: true }) || a.kind.localeCompare(b.kind));
    if (tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > rr)) {
      const pending = tm.post.activeFrom > rr;
      out.push({ key: 'post', kind: 'post', loc: 'land', ids: ['post'], pending: pending ? 1 : 0, zone: 'land', util: null, fixed: pending ? 0 : E.post.feePerRegion * 3 });
    }
    return out;
  }

  function networkPanel() {
    const groups = networkGroups();
    const editable = canPlay();
    const sec = h('section', { class: 'panel' });
    const total = groups.reduce((a, g) => a + g.fixed, 0);
    sec.append(h('div', { class: 'panel-h' }, h('h2', {}, t('networkTitle')), h('span', { class: 'meta' }, `${t('colFixed')} ${fmtMoney(total)} / ${t('round')}`)));
    const locLabel = (g) => (g.kind === 'post' ? t('zone_land') : g.kind === 'box' ? t('area_' + g.loc) : `${g.loc} · ${t('zone_' + g.zone)}`);
    const artKind = (k) => (k === 'post' ? 'post' : k);
    const rows = groups.map((g) => {
      const sel = ui.removeSel[g.key] || 0;
      const status = g.pending === g.ids.length ? t('pending') : g.pending ? `${g.ids.length - g.pending} ${t('ready')}, ${g.pending} ${t('pending')}` : t('ready');
      const u = g.util;
      return h('tr', {},
        h('td', { class: 'l' }, h('span', { class: 'nrow' }, h('span', { class: 'nart', html: art(artKind(g.kind)) }), h('span', {}, h('span', { class: 'nname' }, g.kind === 'post' ? t('el_postShort') : t('el_' + g.kind)), h('span', { class: 'nloc' }, locLabel(g))))),
        h('td', {}, g.kind === 'post' ? '1' : String(g.ids.length)),
        h('td', { class: 'hide-s' }, status),
        h('td', {}, u == null ? h('span', { class: 'muted' }, '–') : h('span', { class: `util ${u < 0.4 ? 'low' : ''}` }, h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: `${Math.min(100, u * 100)}%` } })), fmtPct(u))),
        h('td', { class: 'hide-s' }, fmtMoney(g.fixed)),
        editable ? h('td', {}, h('span', { class: 'stepper' },
          h('button', { 'aria-label': '−', disabled: sel <= 0 ? true : null, onclick: () => { ui.removeSel[g.key] = sel - 1; render(); } }, '−'),
          h('span', { class: 'num', style: { minWidth: '14px', textAlign: 'center' } }, String(sel)),
          h('button', { 'aria-label': '+', disabled: sel >= g.ids.length ? true : null, onclick: () => { ui.removeSel[g.key] = sel + 1; render(); } }, '+'))) : null);
    });
    sec.append(h('table', { class: 'nettable' },
      h('thead', {}, h('tr', {}, h('th', { class: 'l' }, t('colElement')), h('th', {}, t('colCount')), h('th', { class: 'hide-s' }, t('colStatus')), h('th', {}, t('colUtil')), h('th', { class: 'hide-s' }, t('colFixed')), editable ? h('th', {}, t('colRemove')) : null)),
      h('tbody', {}, rows)));
    sec.append(h('p', { class: 'note' }, t('utilNote')));
    const ids = [];
    for (const g of groups) { const n = ui.removeSel[g.key] || 0; if (n > 0) ids.push(...[...g.ids].reverse().slice(0, n)); }
    if (editable && ids.length) {
      const action = { type: 'remove', ids };
      const v = validateAction(state(), slot(), action, plan());
      sec.append(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small muted', style: { flex: '1 1 240px' } }, t('removeHint')),
        h('button', { class: 'btn', disabled: !v.ok || plan().length >= cfg().actionsPerRound ? true : null, onclick: () => { ui.removeSel = {}; addAction(action); } }, t('removeAdd', { n: ids.length }))));
    }
    return sec;
  }

  // ---------- Stand: Urteil, KPIs, Erklärung, Ausblick, Plan ----------
  function statusPanel() {
    const st = state();
    const tm = team();
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'panel-h' }, h('h2', {}, t('statusTitle')), h('span', { class: 'meta' }, t('forecastTitle', { r: st.round }))));
    const fxNow = activeNotices();
    if (fxNow.length) wrap.append(h('div', { class: 'active-fx' }, fxNow));
    // Urteil über alle Runden inkl. Prognose
    const cum = cumulative({ reports: [...tm.reports, fc] });
    const std = standardsOf(st, cum);
    const S = cfg().standards;
    const missed = [];
    if (!std.onTimeNational) missed.push(t('stdShort_onTime', { v: fmtPct(S.onTimeNational) }));
    for (const z of ZONES) if (!std.zones[z]) missed.push(t('stdShort_zone', { zone: t('zone_' + z) }));
    if (!std.cost) missed.push(t('stdShort_cost'));
    wrap.append(h('div', { class: `verdictbox ${std.all ? 'ok' : 'bad'}` },
      h('span', { class: 'vicon' }, icon(std.all ? 'check' : 'x', 18)),
      h('div', {}, h('div', { class: 'vt' }, std.all ? t('verdictPass') : t('verdictFail', { n: missed.length })),
        h('div', { class: 'vs' }, std.all ? t('verdictPassSub') : missed.join(' · ')))));
    // vier KPIs
    const last = tm.reports[tm.reports.length - 1];
    wrap.append(h('div', { class: 'kpicards' }, KPI_KEYS.map((k) => {
      const v = fc.kpis[k];
      const rt = rateKpi(cfg(), k, v);
      let sub = null;
      if (plan().length) { const d = v - fcBase.kpis[k]; if (Math.abs(d) > 1e-6) sub = h('span', { class: goodBad(k, d) }, `${deltaText(k, d)} ${t('byPlan')}`); }
      else if (last) { const d = v - last.kpis[k]; sub = h('span', { class: 'muted' }, t('lastRoundShort', { r: last.round, v: fmtKpi(k, last.kpis[k]) })); void d; }
      const stdLine = k === 'costPerParcel' ? t('stdLine_cost', { v: cfg().tariffPerParcel.toFixed(2) }) : k === 'onTime' ? t('stdLine_onTime', { v: fmtPct(S.onTimeNational) }) : t('stdLine_none');
      return h('button', { class: `kcard ${ui.kpi === k ? 'sel' : ''} r${rt}`, onclick: () => { ui.kpi = ui.kpi === k ? null : k; ui.layer = ui.kpi || 'net'; render(); }, 'aria-pressed': String(ui.kpi === k) },
        h('div', { class: 'kh' }, symbol(KPI_SYMBOL[k], true, 16), h('span', {}, t('kpi_' + k))),
        rating(KPI_SYMBOL[k], rt, 20, t('kpi_' + k)),
        h('div', { class: 'kv2' }, h('span', { class: 'kval' }, fmtKpi(k, v)), h('span', { class: `kword w${rt}` }, ratingWord(rt))),
        h('div', { class: 'kstd' }, stdLine),
        sub ? h('div', { class: 'ksub' }, sub) : null);
    })));
    wrap.append(h('p', { class: 'note' }, ui.kpi ? t('kpiHintOpen') : t('kpiHint')));
    if (ui.kpi) wrap.append(explain(ui.kpi, cum));
    const ol = outlookBlock();
    if (ol) wrap.append(ol);
    wrap.append(planBlock());
    return wrap;
  }

  // «Woher kommt das?»
  function explain(k, cum) {
    const box = h('div', { class: 'explain' });
    box.append(h('div', { class: 'xh' }, symbol(KPI_SYMBOL[k], true, 16), t('explainTitle_' + k)));
    const bars = (items, unit) => {
      const max = Math.max(...items.map((x) => x.v), 1e-9);
      return h('div', { class: 'xbars' }, items.filter((x) => x.v > 0.005).map((x) => h('div', { class: 'xb' },
        h('span', { class: 'xl' }, x.label), h('span', { class: 'xt' }, h('span', { class: 'xf', style: { width: `${(x.v / max) * 100}%`, background: x.color || 'var(--text)' } })), h('span', { class: 'xv' }, unit(x.v)))));
    };
    const tot = fc.totals;
    if (k === 'onTime') {
      const lr = lateReasons(fc);
      box.append(h('p', {}, t('explain_onTime', { ok: fmtInt(tot.onTime), all: fmtInt(tot.parcels), late: fmtInt(lr.total) })));
      box.append(bars([
        { label: t('late_failed'), v: lr.failed, color: '#1f7a80' },
        { label: t('late_emergency'), v: lr.emergency, color: 'var(--negative)' },
        { label: t('late_post'), v: lr.post, color: '#d9a21b' }], (v) => `${fmtInt(v)}`));
      box.append(h('div', { class: 'zonechips' }, ZONES.map((z) => { const ok = cum.zoneKpis[z].onTime >= cfg().standards.onTimeZone; return h('span', { class: `pill ${ok ? 'ok' : 'bad'}` }, `${t('zone_' + z)} ${fmtPct(fc.zoneKpis[z].onTime)}`); })));
      box.append(h('p', { class: 'note' }, t('tip_onTime')));
    } else if (k === 'failRate') {
      box.append(h('p', {}, t('explain_failRate')));
      box.append(bars(ZONES.map((z) => ({ label: `${t('zone_' + z)} (${t('policy_' + team().service[z]).split(' ')[0]})`, v: fc.zoneKpis[z].failRate, color: '#1f7a80' })), (v) => fmtPct(v, 1)));
      box.append(h('p', { class: 'note' }, t('tip_failRate', { box: fmtPct(cfg().elements.box.failRate, 1) })));
    } else if (k === 'costPerParcel') {
      const P = tot.parcels;
      const items = Object.entries(fc.breakdown).map(([kk, v]) => ({ label: t('cb_' + kk), v: v / P, color: kk === 'emergency' ? 'var(--negative)' : '#d9a21b' })).sort((a, b) => b.v - a.v).slice(0, 5);
      box.append(h('p', {}, t('explain_cost', { v: fmtChf(fc.kpis.costPerParcel) })));
      box.append(bars(items, (v) => v.toFixed(2)));
      box.append(h('p', { class: 'note' }, t('tip_cost')));
    } else if (k === 'co2PerParcel') {
      const P = tot.parcels;
      const items = Object.entries(fc.co2BySource).map(([kk, v]) => ({ label: t(kk === 'box' ? 'src_box' : kk === 'post' ? 'src_post' : kk === 'crowd' ? 'src_crowd' : 'el_' + kk), v: v / P, color: kk === 'vanDiesel' || kk === 'emergency' ? '#8a939d' : '#3f9b5a' })).sort((a, b) => b.v - a.v);
      box.append(h('p', {}, t('explain_co2', { v: fmtG(fc.kpis.co2PerParcel) })));
      box.append(bars(items, (v) => `${Math.round(v)} g`));
      box.append(h('p', { class: 'note' }, t('tip_co2')));
    }
    return box;
  }

  function activeNotices() {
    const st = state();
    const k = knownSituation(st);
    const items = [];
    for (const a of k.announcements) {
      if (a.type === 'peak' ? a.effectRound !== st.round : a.effectRound > st.round) continue;
      items.push(h('div', { class: 'fx' }, h('strong', {}, eventTitle(a)), ': ', eventDesc(a, st.config)));
    }
    const fx = activeEffects(st, st.round, false);
    for (const sh of k.pastShocks) {
      const still = (sh.type === 'shortage' && fx.shortage) || (sh.type === 'fuel' && fx.fuel);
      if (still) items.push(h('div', { class: 'fx' }, h('strong', {}, eventTitle(sh)), ': ', eventDesc(sh, st.config)));
    }
    return items;
  }

  function outlookBlock() {
    const st = state();
    const nx = outlookReport(st, slot(), plan());
    if (!nx) return null;
    const k = knownSituation(st);
    const evs = k.announcements.filter((a) => a.effectRound === st.round + 1).map((a) => t('evShort_' + a.type));
    const lines = ZONES.map((z) => ({ z, c: coverageOf(nx, z) })).filter((x) => x.c.emergency > 0.5);
    return h('div', { class: 'outlook' },
      h('div', { class: 'sub-h' }, t('outlookTitle', { r: st.round + 1 }), evs.length ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${evs.join(', ')}`) : null),
      h('div', { class: 'orows' }, KPI_KEYS.map((kk) => h('div', { class: 'or' }, h('span', { class: 'ol' }, t('kpiShort_' + kk)), rating(KPI_SYMBOL[kk], rateKpi(cfg(), kk, nx.kpis[kk]), 13), h('span', { class: 'ov' }, fmtKpi(kk, nx.kpis[kk]))))),
      lines.length
        ? h('div', { class: 'owarn' }, lines.map((x) => h('div', {}, t('outlookEm', { zone: t('zone_' + x.z), n: fmtInt(x.c.emergency) }))))
        : null,
      h('p', { class: 'note' }, t('outlookNote')));
  }

  function actionText(a) {
    switch (a.type) {
      case 'vans': return `${a.count} × ${t(a.drive === 'e' ? 'el_vanE' : 'el_vanDiesel')} · ${a.field}`;
      case 'convert': return `${t('act_convert')} · ${a.field}`;
      case 'hub': return `${t('el_hub')} · ${a.field}`;
      case 'boxes': return t('boxesIn', { area: t('area_' + a.area) });
      case 'post': return t('el_postShort');
      case 'crowd': return `${t('el_crowd')} · ${a.field}`;
      case 'service': return `${t('zone_' + a.zone)}: ${t('policy_' + a.policy)}`;
      case 'remove': return `${t('act_remove')}: ${a.ids.map((id) => (id === 'post' ? t('el_postShort') : elementLabel(id))).join(', ')}`;
      default: return a.type;
    }
  }
  const actionArt = (a) => (a.type === 'vans' ? (a.drive === 'e' ? 'vanE' : 'vanDiesel') : a.type === 'boxes' ? 'box' : a.type === 'remove' ? 'vanDiesel' : a.type);

  function marginal(i) {
    const p = plan();
    const a = p[i];
    if (a.type === 'hub' || a.type === 'boxes') return t('fromNext', { r: r() + 1 });
    const without = forecastReport(state(), slot(), p.filter((_, j) => j !== i));
    const parts = [];
    for (const k of KPI_KEYS) {
      const d = fc.kpis[k] - without.kpis[k];
      if (Math.abs(d) > 1e-6) parts.push(h('span', { class: goodBad(k, d) }, `${t('kpiShort_' + k)} ${deltaText(k, d)}`));
    }
    if (!parts.length) return '±0';
    return parts.flatMap((p2, j) => (j ? [' · ', p2] : [p2]));
  }

  function planBlock() {
    const st = state();
    const max = cfg().actionsPerRound;
    const p = plan();
    const box = h('div', { class: 'planbox' });
    box.append(h('div', { class: 'sub-h' }, t('planTitle')));
    if (!controller.mySlots.includes(slot())) return box;
    if (controller.submittedSlots.has(slot())) {
      const waiting = st.teams.filter((tm) => !controller.submittedSlots.has(tm.idx)).map((tm) => tm.name);
      box.append(h('div', { class: 'waiting' }, h('b', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'mark ok' }, icon('check', 10)), t('waitingTitle')), waiting.length ? h('div', { class: 'small muted' }, t('waitingFor', { names: waiting.join(', ') })) : null));
      if (controller.canSkip && controller.canSkip()) box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, t('skipAvailable')), h('button', { class: 'btn small', onclick: () => controller.skip() }, t('skipMissing'))));
      return box;
    }
    p.forEach((a, i) => box.append(h('div', { class: 'planrow' },
      h('span', { class: 'part', html: art(actionArt(a)) }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'n' }, actionText(a)), h('div', { class: 'e' }, marginal(i))),
      h('button', { class: 'btn ghost small x', 'aria-label': t('cancel'), onclick: () => { p.splice(i, 1); ui.confirmEmpty = false; render(); } }, icon('x', 14)))));
    for (let i = p.length; i < max; i++) box.append(h('div', { class: 'planrow empty' }, h('span', { class: 'part empty' }), h('div', { class: 'n' }, narrow() ? t('slotFreeS') : t('slotFree'))));
    const doSubmit = async (ev) => {
      ev.target.disabled = true;
      const sl = slot();
      const actions = [...p];
      ui.plan[sl] = []; resetConfig(); ui.removeSel = {}; ui.confirmEmpty = false; ui.inspected = null;
      await controller.submit(sl, actions);
    };
    const sb = h('div', { class: 'submitbox' });
    if (!p.length && ui.confirmEmpty) {
      sb.append(h('p', { class: 'confirm' }, t('confirmEmpty')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { ui.confirmEmpty = false; render(); } }, t('cancel')), h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: doSubmit }, t('confirmYes'))));
    } else if (!p.length) {
      sb.append(h('button', { class: 'btn secondary block', onclick: () => { ui.confirmEmpty = true; render(); } }, t('submitEmpty')));
    } else {
      sb.append(h('button', { class: `btn ${ui.cfg ? 'secondary' : 'primary'} block big`, onclick: doSubmit }, t('submitRound', { r: st.round })));
    }
    box.append(sb);
    return box;
  }

  // ---------- Vergleichstabelle (für genaue Zahlen) ----------
  function openCompare() {
    let z = 'stadt';
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const draw = () => {
      clear(overlay);
      const kinds = ['vanDiesel', 'vanE', 'hub', 'box', 'post', 'crowd', 'emergency'];
      const specs = kinds.map((k) => ({ k, sp: optionSpecs(state(), k, z) }));
      overlay.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': t('compareTitle') },
        h('header', {}, h('h2', {}, t('compareTitle')), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost small', onclick: () => overlay.remove(), 'aria-label': t('close') }, icon('x', 14))),
        h('div', { class: 'body stack' },
          h('div', { class: 'row' }, h('span', { class: 'small muted' }, t('figuresFor')), h('div', { class: 'seg' }, ZONES.map((zz) => h('button', { class: zz === z ? 'sel' : '', onclick: () => { z = zz; draw(); } }, t('zone_' + zz))))),
          h('div', { class: 'card', style: { overflowX: 'auto' } }, h('table', { class: 'compare-table' },
            h('thead', {}, h('tr', {}, h('th', { class: 'l' }, t('element')), h('th', {}, t('spec_fixed')), h('th', {}, t('spec_capacity')), h('th', {}, t('spec_fullS')), h('th', {}, t('spec_co2')), h('th', {}, t('spec_onTime')))),
            h('tbody', {}, specs.map(({ k, sp }) => sp.blocked
              ? h('tr', {}, h('td', { class: 'l' }, h('span', { class: 'nrow' }, h('span', { class: 'nart', html: art(k) }), t(k === 'box' ? 'el_box' : 'el_' + k))), h('td', { colspan: 5, class: 'muted' }, t('blocked_' + sp.blocked)))
              : h('tr', {},
                h('td', { class: 'l' }, h('span', { class: 'nrow' }, h('span', { class: 'nart', html: art(k) }), t(k === 'box' ? 'el_box' : 'el_' + k))),
                h('td', {}, fmtMoney(sp.fixed)), h('td', {}, Number.isFinite(sp.capacity) ? fmtInt(sp.capacity) : '–'),
                h('td', {}, fmtChf(sp.fullCost)), h('td', {}, fmtG(sp.co2)), h('td', {}, fmtPct(sp.onTime))))))),
          h('p', { class: 'note' }, t('compareNote')))));
    };
    draw();
    document.body.append(overlay);
  }

  // ---------- Rundenbericht ----------
  function showReport(round, afterClose) {
    const st = state();
    let viewSlot = controller.mySlots.includes(slot()) ? slot() : (controller.mySlots[0] ?? 0);
    const overlay = h('div', { class: 'overlay' });
    const draw = () => {
      clear(overlay);
      const isLast = st.finished && round === st.rounds;
      const closeLabel = isLast ? t('toResults') : (round === st.round - 1 && !st.finished ? t('nextRound', { n: st.round }) : t('close'));
      overlay.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': `${t('reportTitle')} ${round}` },
        h('header', {}, h('h2', {}, `${t('reportTitle')} · ${t('round')} ${round}`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn ghost small', onclick: close, 'aria-label': t('close') }, icon('x', 14))),
        h('div', { class: 'body' },
          controller.mySlots.length > 1 ? h('div', { class: 'teamtabs', style: { marginBottom: '12px' } }, controller.mySlots.map((sl) => h('button', { class: `teamtab ${sl === viewSlot ? 'sel' : ''}`, onclick: () => { viewSlot = sl; draw(); } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[sl] } }), st.teams[sl].name))) : null,
          roundReportView(st, viewSlot, round, { onClose: close, closeLabel, mySlots: controller.mySlots }))));
    };
    function close() { overlay.remove(); if (afterClose) afterClose(); }
    draw();
    document.body.append(overlay);
  }

  render();
  return { render, showReport };
}
