// Spielbildschirm: links die Aktionen mit vergleichbaren Kennzahlen, Mitte Karte und Netz,
// rechts die Prognose der laufenden Runde mit Plan und Abgabe. Für lokale und Online-Spiele.
import { h, clear, TEAM_COLORS, icon } from './dom.js';
import { renderMap } from './map-view.js';
import { t, fmtChf, fmtPct, fmtG, fmtInt, fmtMoney } from '../i18n.js';
import { validateAction, knownSituation, ZONES, KPI_KEYS, cumulative, standardsOf, activeEffects } from '../engine.js';
import { buildMap, areaFields, AREAS } from '../map.js';
import { forecastReport, outlookReport, coverageOf, emergencyByField, optionSpecs, windowEffect } from '../forecast.js';
import { eventTitle, eventDesc, roundReportView, finalReportView, fmtKpi } from './report.js';
import { coverageBlock } from './coverage.js';

const LOWER_BETTER = { costPerParcel: true, onTime: false, co2PerParcel: true, failRate: true };
const OPTS = ['vanDiesel', 'vanE', 'convert', 'hub', 'box', 'post', 'crowd', 'service'];
const NEEDS_FIELD = new Set(['vanDiesel', 'vanE', 'convert', 'hub', 'crowd']);
const SPEC_KIND = { vanDiesel: 'vanDiesel', vanE: 'vanE', convert: 'vanE', hub: 'hub', box: 'box', post: 'post', crowd: 'crowd' };
const narrow = () => window.matchMedia('(max-width: 820px)').matches;

// controller: { state, meta, mySlots, activeSlot, submittedSlots:Set, canSkip, submit(slot, actions), skip(), versionNote }
export function GameScreen(root, controller, nav) {
  const ui = { plan: {}, cfg: null, field: null, inspected: null, removeSel: {}, figZone: 'stadt', confirmEmpty: false };
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

  // Prognosen (pro Darstellung einmal gerechnet)
  let fc = null; let fcBase = null;
  function computeForecasts() {
    fc = forecastReport(state(), slot(), plan());
    fcBase = plan().length ? forecastReport(state(), slot(), []) : fc;
  }

  function resetConfig() { ui.cfg = null; ui.field = null; ui.error = ''; }

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
    const grid = h('div', { class: 'game' },
      h('section', { class: 'panel palette', 'aria-label': t('optionsTitle') }, ui.cfg ? configurator() : optionList()),
      h('div', { class: 'canvascol' }, mapPanel(), networkPanel()),
      h('section', { class: 'panel forecast', 'aria-label': t('forecastTitle', { r: st.round }) }, forecastPanel()));
    root.append(grid);
    window.scrollTo(0, keepY);
  }

  // ---------- Kopfzeile mit Fahrplan ----------
  function gameBar() {
    const st = state();
    const tm = team();
    const bar = h('div', { class: 'gamebar' },
      h('div', { class: 'who' }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx], width: '10px', height: '10px' } }), h('h1', {}, tm.name),
        h('span', { class: 'sub' }, `${t('round')} ${st.round} ${t('of')} ${st.rounds}`)),
      timeline(),
      h('span', { class: 'spacer' }),
      controller.mySlots.length > 1 ? h('div', { class: 'teamtabs' }, controller.mySlots.map((sl) => h('button', {
        class: `teamtab ${sl === slot() ? 'sel' : ''}`,
        onclick: () => { controller.activeSlot = sl; resetConfig(); ui.inspected = null; ui.removeSel = {}; ui.confirmEmpty = false; render(); }
      }, h('span', { class: 'dot', style: { background: TEAM_COLORS[sl] } }), st.teams[sl].name, controller.submittedSlots.has(sl) ? h('span', { class: 'done' }, icon('check', 12)) : null))) : null,
      controller.meta.mode === 'online' && controller.meta.code ? h('span', { class: 'pill' }, `${t('code')} ${controller.meta.code}`) : null,
      st.round > 1 ? h('button', { class: 'btn small', onclick: () => showReport(st.round - 1) }, t('reportOf', { r: st.round - 1 })) : null);
    return bar;
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

  // ---------- Aktionen: Liste mit Kennzahlen ----------
  function availability(opt) {
    const st = state();
    const tm = team();
    const last = st.round >= st.rounds;
    const p = plan();
    if ((opt === 'hub' || opt === 'box') && last) return 'lastRound';
    if (opt === 'convert' && !tm.elements.some((e) => e.kind === 'van' && e.drive === 'diesel' && (e.removeFrom == null || e.removeFrom > st.round))) return 'noDiesel';
    if (opt === 'post') {
      if (tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > st.round)) return 'exists';
      if (p.some((a) => a.type === 'post')) return 'planned';
    }
    return null;
  }

  function optionList() {
    const z = ui.figZone;
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'panel-h' }, h('h2', {}, t('optionsTitle')), h('span', { class: 'meta' }, t('planCount', { n: plan().length, max: cfg().actionsPerRound }))));
    wrap.append(h('div', { class: 'opts-head' }, h('span', { class: 'small muted' }, t('figuresFor')),
      h('div', { class: 'seg', role: 'tablist' }, ZONES.map((zz) => h('button', { class: zz === z ? 'sel' : '', role: 'tab', 'aria-selected': String(zz === z), onclick: () => { ui.figZone = zz; render(); } }, t('zone_' + zz))))));
    const rows = [];
    for (const opt of OPTS) rows.push(optionRow(opt, z));
    rows.push(optionRow('emergency', z));
    wrap.append(h('table', { class: 'opts' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { style: { width: '54px' } }, t('colFullS')), h('th', { style: { width: '52px' } }, t('colCapS')), h('th', { style: { width: '46px' } }, t('colCo2S')))),
      h('tbody', {}, rows.map((rw) => h('tr', {}, h('td', { colspan: 4 }, rw))))));
    wrap.append(h('p', { class: 'note' }, t('optsNote')));
    wrap.append(h('div', { style: { marginTop: '10px' } }, h('button', { class: 'linkbtn small', onclick: openCompare }, t('compareAll'))));
    return wrap;
  }

  function whyText(opt) {
    if (opt === 'box') return t('why_box', { acc: fmtPct(cfg().elements.box.acceptance) });
    if (opt === 'service') return team().service[ui.figZone] === 'window' ? t('policy_window') : t('why_service');
    return t('why_' + opt);
  }

  function whenText(opt) {
    const rr = r();
    if (opt === 'hub' || opt === 'box') return t('fromNext', { r: rr + 1 });
    if (opt === 'crowd') return t('thisRoundOnly', { r: rr });
    return t('fromNow');
  }

  function optionRow(opt, z) {
    const off = opt !== 'emergency' ? availability(opt) : null;
    const canClick = opt !== 'emergency' && !off && canPlay() && plan().length < cfg().actionsPerRound;
    const name = opt === 'service' && team().service[z] === 'window' ? t('opt_serviceOff') : t('opt_' + opt);
    const left = h('div', {}, h('div', { class: 'name' }, name),
      h('div', { class: 'why' }, off ? t('blocked_' + off) : whyText(opt)));
    let figs;
    if (opt === 'service') {
      const w = windowEffect(state(), z);
      figs = [h('div', { class: 'span3' }, t('serviceFig', { cap: fmtPct(w.capacityLoss), a: fmtPct(w.failBefore), b: fmtPct(w.failAfter) }))];
    } else {
      const sp = optionSpecs(state(), SPEC_KIND[opt] || opt, z);
      if (sp.blocked) figs = [h('div', { class: 'span3' }, t('blocked_' + sp.blocked))];
      else figs = [
        h('div', { class: 'fig' }, sp.fullCost.toFixed(2)),
        h('div', { class: 'fig' }, Number.isFinite(sp.capacity) ? fmtInt(sp.capacity) : '–'),
        h('div', { class: 'fig' }, fmtInt(sp.co2))];
    }
    const cls = ['opt', off ? 'off' : '', opt === 'emergency' ? 'ref' : ''].join(' ');
    if (opt === 'emergency') return h('div', { class: cls }, left, ...figs);
    return h('button', {
      class: cls, disabled: !canClick && opt !== 'emergency' ? true : null, title: whenText(opt),
      onclick: canClick ? () => startConfig(opt) : null
    }, left, ...figs);
  }

  function startConfig(opt) {
    const tm = team();
    const z = ui.figZone;
    ui.cfg = { opt, count: 1, area: opt === 'box' ? (z === 'land' ? 'nord' : z) : 'stadt', zone: z };
    ui.field = null; ui.error = ''; ui.inspected = null; ui.confirmEmpty = false;
    if (opt === 'post') ui.cfg.zone = 'land';
    if (opt === 'service') ui.cfg.zone = z;
    if (opt === 'hub') ui.cfg.zone = 'stadt';
    render();
    if (NEEDS_FIELD.has(opt) && !narrow()) document.querySelector('.mapwell')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    void tm;
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
    const title = c.opt === 'service' && team().service[c.zone] === 'window' ? t('opt_serviceOff') : t('opt_' + c.opt);
    box.append(h('h3', {}, title), h('p', { class: 'desc' }, c.opt === 'service' ? t('why_service') : whyText(c.opt)));

    const seg = (vals, cur, label, onPick) => h('div', { class: 'seg' }, vals.map((v) => h('button', { class: v === cur ? 'sel' : '', onclick: () => onPick(v) }, label(v))));
    if (c.opt === 'vanDiesel' || c.opt === 'vanE') {
      box.append(h('div', { class: 'ctl' }, h('span', {}, t('count')), seg([1, 2, 3], c.count, String, (v) => { c.count = v; render(); })));
    }
    if (c.opt === 'box') {
      box.append(h('div', { class: 'ctl' }, h('span', {}, t('chooseArea')),
        h('select', { onchange: (e) => { c.area = e.target.value; render(); }, 'aria-label': t('chooseArea') },
          AREAS.map((a) => h('option', { value: a, selected: c.area === a ? true : null }, `${t('area_' + a)} (${areaFields(a).length} ${t('fields')})`)))));
    }
    if (c.opt === 'service') {
      box.append(h('div', { class: 'ctl' }, h('span', {}, t('zone')), seg(ZONES, c.zone, (v) => t('zone_' + v), (v) => { c.zone = v; render(); })));
      box.append(h('p', { class: 'small muted' }, `${t('selected')}: ${t('policy_' + team().service[c.zone])} → ${t('policy_' + (team().service[c.zone] === 'window' ? 'standard' : 'window'))}`));
    }
    // Standort
    if (NEEDS_FIELD.has(c.opt)) {
      if (ui.field) {
        box.append(h('div', { class: 'step done' }, h('span', {}, t('pickedField', { id: ui.field, zone: t('zone_' + zoneOf(ui.field)) })), h('span', { class: 'spacer' }),
          h('button', { class: 'linkbtn small', onclick: () => { ui.field = null; render(); } }, t('change'))));
      } else {
        box.append(h('div', { class: 'step' }, h('span', { class: 'k' }, '→'), h('span', {}, t('pickOnMap'))));
      }
      if (narrow()) {
        const mm = h('div', { class: 'minimap' });
        box.append(mm);
        drawMap(mm, true);
      }
    }
    // Kennzahlen für die betroffene Zone
    box.append(specWell());
    // Wirkung
    const action = currentAction();
    const v = action ? validateAction(state(), slot(), action, plan()) : null;
    box.append(effectBlock(action, v));
    if (action && !v.ok) box.append(h('p', { class: 'err' }, t('err_' + v.error)));
    box.append(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => { resetConfig(); render(); } }, t('cancel')), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', disabled: !action || !v.ok ? true : null, onclick: () => addAction(action) }, t('addToPlan'))));
    return box;
  }

  function specZone() {
    const c = ui.cfg;
    if (ui.field) return zoneOf(ui.field);
    if (c.opt === 'box') return ['stadt', 'agglo'].includes(c.area) ? c.area : 'land';
    if (c.opt === 'hub') return 'stadt';
    if (c.opt === 'post') return 'land';
    return c.zone;
  }

  function specWell() {
    const c = ui.cfg;
    const z = specZone();
    if (c.opt === 'service') {
      const w = windowEffect(state(), z);
      return h('div', { class: 'kv' },
        h('div', { class: 'cap' }, t('specZone', { zone: t('zone_' + z) })),
        h('div', { class: 'r' }, h('span', {}, t('capacity')), h('b', {}, `−${fmtPct(w.capacityLoss)}`)),
        h('div', { class: 'r' }, h('span', {}, t('failRate')), h('b', {}, `${fmtPct(w.failBefore)} → ${fmtPct(w.failAfter)}`)),
        h('div', { class: 'r' }, h('span', {}, t('spec_from')), h('b', {}, t('fromNow'))));
    }
    const sp = optionSpecs(state(), SPEC_KIND[c.opt], z);
    const n = c.opt === 'vanDiesel' || c.opt === 'vanE' ? c.count : c.opt === 'box' ? areaFields(c.area).length : 1;
    const rows = [];
    const row = (k, v) => rows.push(h('div', { class: 'r' }, h('span', {}, k), h('b', {}, v)));
    if (sp.blocked) rows.push(h('div', { class: 'r' }, h('span', { class: 'bad' }, t('blocked_' + sp.blocked)), h('b', {}, '')));
    row(t('spec_fixed'), n > 1 ? `${fmtMoney(sp.fixed * n)}` : fmtMoney(sp.fixed));
    if (Number.isFinite(sp.capacity)) row(t('spec_capacity'), `${fmtInt(sp.capacity * n)} ${t('parcels')}`);
    row(t('spec_fullS'), fmtChf(sp.fullCost));
    row(t('spec_variable'), fmtChf(sp.variable));
    if (sp.tax > 0.005) row(t('spec_tax'), fmtChf(sp.tax));
    row(t('spec_co2'), fmtG(sp.co2));
    row(t('spec_onTime'), fmtPct(sp.onTime));
    if (sp.range) row(t('spec_range'), `${sp.range} ${sp.range === 1 ? t('field') : t('fields')}`);
    row(t('spec_from'), whenText(c.opt));
    const cap = n > 1 ? `${t('specZone', { zone: t('zone_' + z) })} · ${c.opt === 'box' ? `${n} ${t('fields')}` : t('nVehicles', { n })}` : t('specZone', { zone: t('zone_' + z) });
    return h('div', { class: 'kv' }, h('div', { class: 'cap' }, cap), rows);
  }

  function effectBlock(action, v) {
    const rr = r();
    const head = h('div', { class: 'eh' }, t('effectTitle', { r: rr }));
    if (!action) return h('div', { class: 'effect' }, head, h('p', { class: 'note', style: { marginTop: 0 } }, t('effectNeedsField')));
    if (!v.ok) return h('div');
    if (action.type === 'hub' || action.type === 'boxes') {
      const before = outlookReport(state(), slot(), plan());
      const later = outlookReport(state(), slot(), [...plan(), action]);
      return h('div', { class: 'effect' }, h('div', { class: 'eh' }, t('effectTitle', { r: rr + 1 })), later ? deltaGrid(before, later) : null, h('p', { class: 'note' }, t('effectLater', { r: rr + 1 })));
    }
    const after = forecastReport(state(), slot(), [...plan(), action]);
    return h('div', { class: 'effect' }, head, deltaGrid(fc, after));
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

  function deltaGrid(before, after) {
    return h('div', { class: 'deltas' }, KPI_KEYS.map((k) => {
      const d = after.kpis[k] - before.kpis[k];
      return h('div', {}, h('div', { class: 'l' }, t('kpi_' + k)), h('div', { class: 'v' }, fmtKpi(k, after.kpis[k])), h('div', { class: `d ${goodBad(k, d)}` }, deltaText(k, d)));
    }));
  }

  function addAction(action) {
    const p = plan();
    if (p.length >= cfg().actionsPerRound) { ui.error = t('planFull'); render(); return; }
    p.push(action);
    resetConfig(); ui.confirmEmpty = false;
    render();
  }

  // ---------- Karte ----------
  function zezState() {
    const st = state();
    const a = st.events.announced.find((x) => x.type === 'zez');
    if (!a || a.announceRound > st.round) return 'none';
    return st.round >= a.effectRound ? 'active' : 'announced';
  }

  function drawMap(box, compact = false) {
    const st = state();
    const tm = team();
    const rr = st.round;
    const elements = tm.elements.filter((e) => e.removeFrom == null || e.removeFrom > rr).map((e) => ({ ...e, pending: e.activeFrom > rr }));
    // geplante Vans und Hubs schon zeigen
    for (const a of plan()) {
      if (a.type === 'vans') for (let i = 0; i < a.count; i++) elements.push({ kind: 'van', drive: a.drive, field: a.field, pending: false });
      if (a.type === 'hub') elements.push({ kind: 'hub', field: a.field, pending: true });
    }
    const c = ui.cfg;
    const picking = c && NEEDS_FIELD.has(c.opt) && canPlay();
    const E = cfg().elements;
    let rangePreview = null;
    if (picking) {
      if (c.opt === 'hub') rangePreview = { range: E.hub.range, zones: E.hub.zones };
      else if (c.opt === 'crowd') rangePreview = { range: E.crowd.range };
      else rangePreview = { range: E.vanDiesel.range };
    }
    const post = tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > rr) ? (tm.post.activeFrom > rr ? 'pending' : 'active') : (plan().some((a) => a.type === 'post') ? 'active' : null);
    renderMap(box, {
      teamIdx: tm.idx, elements, crowd: plan().filter((a) => a.type === 'crowd').map((a) => ({ field: a.field })), post, zezState: zezState(),
      selectable: picking ? selectableFor(c.opt) : null, selectedField: picking ? ui.field : null, rangePreview,
      onSelect: (id) => { ui.field = id; render(); },
      emergency: fc ? emergencyByField(fc) : null,
      inspected: compact ? null : ui.inspected,
      onInspect: compact ? null : (id) => { ui.inspected = ui.inspected === id ? null : id; render(); }
    });
  }

  function mapPanel() {
    const well = h('div', { class: 'mapwell' });
    const mapBox = h('div', { style: { position: 'relative' } });
    well.append(mapBox);
    drawMap(mapBox);
    const c = ui.cfg;
    if (c && NEEDS_FIELD.has(c.opt) && canPlay()) {
      well.append(h('div', { class: 'maptools' }, h('div', { class: 'banner' },
        ui.field ? t('pickedField', { id: ui.field, zone: t('zone_' + zoneOf(ui.field)) }) : t('pickBanner', { what: t('opt_' + c.opt) }),
        h('button', { onclick: () => { resetConfig(); render(); } }, t('cancel')))));
    }
    if (ui.inspected && fc && !c) well.append(fieldCard(ui.inspected));
    const leg = h('div', { class: 'legend' },
      ...['stadt', 'agglo', 'land'].map((z) => h('span', {}, h('span', { class: 'swatch', style: { background: `var(--zone-${z})` } }), t('zone_' + z))),
      zezState() !== 'none' ? h('span', {}, h('span', { class: 'swatch', style: { border: '2px dashed var(--zez)' } }), t('ev_zez')) : null,
      h('span', {}, h('span', { class: 'swatch', style: { background: 'rgba(196,36,42,.25)', border: '2px solid var(--negative)' } }), t('legendEmergency')),
      h('span', {}, h('span', { class: 'swatch', style: { background: '#2e7d32' } }), t('el_vanE')),
      h('span', {}, h('span', { class: 'swatch', style: { background: '#141414' } }), `${t('el_vanDiesel')}, Hub, Box`));
    well.append(leg);
    return well;
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
      h('div', { class: 'r' }, h('span', { class: 'muted' }, t('fieldServed')), h('b', {}, '')),
      Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, n]) => h('div', { class: 'r' }, h('span', { class: k === t('el_emergency') ? 'bad' : '' }, k), h('b', {}, fmtInt(n)))));
  }

  // ---------- Netz ----------
  function areaOfField(id) {
    const f = map.byId[id];
    return f.zone === 'land' ? f.region : f.zone;
  }

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
      if (!groups.has(key)) groups.set(key, { key, kind, loc, ids: [], pending: 0, zone: e.kind === 'box' ? zoneOf(e.field) : zoneOf(e.field) });
      const g = groups.get(key);
      g.ids.push(e.id);
      if (e.activeFrom > rr) g.pending++;
    }
    const util = {};
    if (fc) for (const u of fc.utilization) util[u.id] = u;
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
    const locLabel = (g) => g.kind === 'post' ? t('zone_land') : g.kind === 'box' ? t('area_' + g.loc) : `${g.loc} · ${t('zone_' + g.zone)}`;
    const rows = groups.map((g) => {
      const sel = ui.removeSel[g.key] || 0;
      const status = g.pending === g.ids.length ? t('pending') : g.pending ? `${g.ids.length - g.pending} ${t('ready')}, ${g.pending} ${t('pending')}` : t('ready');
      const u = g.util;
      return h('tr', {},
        h('td', { class: 'l' }, locLabel(g), h('span', { class: 'show-s' }, g.kind === 'post' ? t('el_postShort') : t('el_' + g.kind))),
        h('td', { class: 'l hide-s' }, g.kind === 'post' ? t('el_postShort') : t('el_' + g.kind)),
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
      h('thead', {}, h('tr', {}, h('th', { class: 'l' }, t('colLocation')), h('th', { class: 'l hide-s' }, t('colElement')), h('th', {}, t('colCount')), h('th', { class: 'hide-s' }, t('colStatus')), h('th', {}, t('colUtil')), h('th', { class: 'hide-s' }, t('colFixed')), editable ? h('th', {}, t('colRemove')) : null)),
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

  // ---------- Prognose, Standards, Plan, Abgabe ----------
  function forecastPanel() {
    const st = state();
    const tm = team();
    const wrap = h('div', {});
    const wagePct = st.wage - 1;
    wrap.append(h('div', { class: 'panel-h' }, h('h2', {}, t('forecastTitle', { r: st.round })), wagePct > 0.0005 ? h('span', { class: 'meta' }, t('wageUp', { p: fmtPct(wagePct, 1) })) : null));
    // Was gilt jetzt?
    const fxNow = activeNotices();
    if (fxNow.length) wrap.append(h('div', { class: 'active-fx' }, fxNow));
    // KPI
    const last = tm.reports[tm.reports.length - 1];
    wrap.append(h('div', { class: 'kpistrip' }, KPI_KEYS.map((k) => {
      const v = fc.kpis[k];
      let sub;
      if (plan().length) {
        const d = v - fcBase.kpis[k];
        sub = h('div', { class: 'kpi-c' }, h('span', { class: goodBad(k, d) }, deltaText(k, d)), ' ', t('vsNoPlan'));
      } else if (last) sub = h('div', { class: 'kpi-c' }, t('lastRoundShort', { r: last.round, v: fmtKpi(k, last.kpis[k]) }));
      else sub = h('div', { class: 'kpi-c' }, t('nothingYet'));
      const [num, unit] = splitKpi(k, v);
      return h('div', {}, h('div', { class: 'kpi-l' }, t('kpi_' + k)), h('div', { class: 'kpi-v' }, num, unit ? h('span', { class: 'u' }, unit) : null), sub);
    })));
    wrap.append(h('p', { class: 'note' }, t('forecastNote')));
    // Standards (kumuliert inkl. Prognose)
    const cum = cumulative({ reports: [...tm.reports, fc] });
    const std = standardsOf(st, cum);
    const S = cfg().standards;
    const stdRow = (ok, label, val) => h('div', { class: 'r' }, h('span', { class: `mark ${ok ? 'ok' : 'bad'}`, 'aria-label': ok ? t('met') : t('missed') }, icon(ok ? 'check' : 'x', 10)), h('span', {}, label), h('span', { class: `v ${ok ? '' : 'bad'}` }, val));
    wrap.append(h('div', { class: 'sub-h' }, t('standardsCum')),
      h('div', { class: 'stdlist' },
        stdRow(std.onTimeNational, t('std_onTimeNational', { v: fmtPct(S.onTimeNational) }), fmtPct(cum.kpis.onTime, 1)),
        ...ZONES.map((z) => stdRow(std.zones[z], t('std_zone', { zone: t('zone_' + z), v: fmtPct(S.onTimeZone) }), fmtPct(cum.zoneKpis[z].onTime, 1))),
        stdRow(std.cost, t('std_cost', { v: cfg().tariffPerParcel.toFixed(2) }), fmtChf(cum.kpis.costPerParcel))),
      h('p', { class: 'note' }, t('standardsCumNote')));
    // Abdeckung
    wrap.append(h('div', { class: 'sub-h' }, t('coverageTitle')), coverageBlock(fc));
    // Ausblick
    const ol = outlookBlock();
    if (ol) wrap.append(ol);
    // Plan
    wrap.append(planBlock());
    return wrap;
  }

  function outlookBlock() {
    const st = state();
    const nx = outlookReport(st, slot(), plan());
    if (!nx) return null;
    const k = knownSituation(st);
    const evs = k.announcements.filter((a) => (a.type === 'peak' ? a.effectRound === st.round + 1 : a.effectRound === st.round + 1)).map((a) => t('evShort_' + a.type));
    const lines = ZONES.map((z) => ({ z, c: coverageOf(nx, z) })).filter((x) => x.c.emergency > 0.5);
    return h('div', {},
      h('div', { class: 'sub-h' }, t('outlookTitle', { r: st.round + 1 }), evs.length ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${evs.join(', ')}`) : null),
      h('div', { class: 'kpistrip' }, ['costPerParcel', 'onTime'].map((kk) => {
        const [num, unit] = splitKpi(kk, nx.kpis[kk]);
        const d = nx.kpis[kk] - fc.kpis[kk];
        return h('div', {}, h('div', { class: 'kpi-l' }, t('kpi_' + kk)), h('div', { class: 'kpi-v ink', style: { fontSize: '18px', lineHeight: '24px' } }, num, h('span', { class: 'u' }, unit)),
          h('div', { class: 'kpi-c' }, h('span', { class: goodBad(kk, d) }, deltaText(kk, d)), ' ', t('vsThisRound')));
      })),
      lines.length
        ? h('div', { style: { marginTop: '8px' } }, lines.map((x) => h('div', { class: 'small bad' }, t('outlookEm', { zone: t('zone_' + x.z), n: fmtInt(x.c.emergency) }))))
        : h('p', { class: 'note' }, t('outlookAll')),
      h('p', { class: 'note' }, t('outlookNote')));
  }

  function splitKpi(k, v) {
    if (k === 'costPerParcel') return [v.toFixed(2), 'CHF'];
    if (k === 'co2PerParcel') return [String(Math.round(v)), 'g'];
    return [(v * 100).toFixed(1), '%'];
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

  function actionText(a) {
    switch (a.type) {
      case 'vans': return `${a.count} × ${t(a.drive === 'e' ? 'el_vanE' : 'el_vanDiesel')} · ${a.field}`;
      case 'convert': return `${t('act_convert')} · ${a.field}`;
      case 'hub': return `${t('el_hub')} · ${a.field}`;
      case 'boxes': return t('boxesIn', { area: t('area_' + a.area) });
      case 'post': return t('el_postShort');
      case 'crowd': return `${t('el_crowd')} · ${a.field}`;
      case 'service': return `${t('zone_' + a.zone)}: ${t('policy_' + a.policy)}`;
      case 'remove': return `${t('act_remove')}: ${a.ids.map((id) => (id === 'post' ? t('el_post') : elementLabel(id))).join(', ')}`;
      default: return a.type;
    }
  }

  function marginal(i) {
    const p = plan();
    const without = forecastReport(state(), slot(), p.filter((_, j) => j !== i));
    const a = p[i];
    if (a.type === 'hub' || a.type === 'boxes') return t('fromNext', { r: r() + 1 });
    const parts = [];
    for (const k of ['costPerParcel', 'onTime', 'co2PerParcel']) {
      const d = fc.kpis[k] - without.kpis[k];
      if (Math.abs(d) > 1e-6) parts.push(h('span', { class: goodBad(k, d) }, `${t('kpi_' + k)} ${deltaText(k, d)}`));
    }
    if (!parts.length) return '±0';
    return parts.flatMap((p2, j) => (j ? [' · ', p2] : [p2]));
  }

  function planBlock() {
    const st = state();
    const max = cfg().actionsPerRound;
    const p = plan();
    const box = h('div', {});
    box.append(h('div', { class: 'sub-h', style: { marginTop: '20px' } }, t('planTitle')));
    if (!controller.mySlots.includes(slot())) return box;
    if (controller.submittedSlots.has(slot())) {
      const waiting = st.teams.filter((tm) => !controller.submittedSlots.has(tm.idx)).map((tm) => tm.name);
      box.append(h('div', { class: 'waiting' }, h('b', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'mark ok' }, icon('check', 10)), t('waitingTitle')), waiting.length ? h('div', { class: 'small muted' }, t('waitingFor', { names: waiting.join(', ') })) : null));
      if (controller.canSkip && controller.canSkip()) box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, t('skipAvailable')), h('button', { class: 'btn small', onclick: () => controller.skip() }, t('skipMissing'))));
      return box;
    }
    const list = h('div', {});
    p.forEach((a, i) => list.append(h('div', { class: 'planrow' },
      h('div', {}, h('div', { class: 'n' }, actionText(a)), h('div', { class: 'e' }, marginal(i))),
      h('button', { class: 'btn ghost small x', 'aria-label': t('cancel'), onclick: () => { p.splice(i, 1); ui.confirmEmpty = false; render(); } }, icon('x', 14)))));
    for (let i = p.length; i < max; i++) list.append(h('div', { class: 'planrow empty' }, h('div', { class: 'n' }, narrow() ? t('slotFreeS') : t('slotFree'))));
    box.append(list);
    const configuring = !!ui.cfg;
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
      sb.append(h('button', { class: `btn ${configuring ? 'secondary' : 'primary'} block`, onclick: doSubmit }, t('submitRound', { r: st.round })));
    }
    box.append(sb);
    return box;
  }

  // ---------- Vergleichstabelle ----------
  function openCompare() {
    let z = ui.figZone;
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const draw = () => {
      clear(overlay);
      const kinds = ['vanDiesel', 'vanE', 'hub', 'box', 'post', 'crowd', 'emergency'];
      const specs = kinds.map((k) => ({ k, sp: optionSpecs(state(), k, z) }));
      const valid = specs.filter((x) => !x.sp.blocked);
      const best = (key, low = true) => { const vals = valid.map((x) => x.sp[key]).filter(Number.isFinite); return low ? Math.min(...vals) : Math.max(...vals); };
      const bFull = best('fullCost'); const bCo2 = best('co2'); const bOn = best('onTime', false);
      const unitNote = (k) => (k === 'box' ? t('perField') : k === 'post' ? t('perAllRegions') : '');
      overlay.append(h('div', { class: 'modal', role: 'dialog', 'aria-label': t('compareTitle') },
        h('header', {}, h('h2', {}, t('compareTitle')), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost small', onclick: () => overlay.remove(), 'aria-label': t('close') }, icon('x', 14))),
        h('div', { class: 'body stack' },
          h('div', { class: 'row' }, h('span', { class: 'small muted' }, t('figuresFor')), h('div', { class: 'seg' }, ZONES.map((zz) => h('button', { class: zz === z ? 'sel' : '', onclick: () => { z = zz; draw(); } }, t('zone_' + zz))))),
          h('div', { class: 'card', style: { overflowX: 'auto' } }, h('table', { class: 'compare-table' },
            h('thead', {}, h('tr', {}, h('th', { class: 'l' }, t('element')), h('th', {}, t('spec_fixed')), h('th', {}, t('spec_capacity')), h('th', {}, t('spec_full')), h('th', {}, t('spec_variable')), h('th', {}, t('spec_co2')), h('th', {}, t('spec_onTime')), h('th', {}, t('spec_range')), h('th', {}, t('spec_from')))),
            h('tbody', {}, specs.map(({ k, sp }) => sp.blocked
              ? h('tr', {}, h('td', { class: 'l' }, t(k === 'box' ? 'el_box' : 'el_' + k)), h('td', { colspan: 8, class: 'muted' }, t('blocked_' + sp.blocked)))
              : h('tr', {},
                h('td', { class: 'l' }, t(k === 'box' ? 'el_box' : 'el_' + k), unitNote(k) ? h('span', { class: 'muted' }, ` ${unitNote(k)}`) : null),
                h('td', {}, fmtMoney(sp.fixed)),
                h('td', {}, Number.isFinite(sp.capacity) ? fmtInt(sp.capacity) : '–'),
                h('td', { class: Math.abs(sp.fullCost - bFull) < 1e-9 ? 'best' : '' }, fmtChf(sp.fullCost)),
                h('td', {}, fmtChf(sp.variable)),
                h('td', { class: Math.abs(sp.co2 - bCo2) < 1e-9 ? 'best' : '' }, fmtG(sp.co2)),
                h('td', { class: Math.abs(sp.onTime - bOn) < 1e-9 ? 'best' : '' }, fmtPct(sp.onTime)),
                h('td', {}, sp.range ? `${sp.range}` : '–'),
                h('td', {}, k === 'emergency' ? t('fromNow') : whenText(k === 'vanDiesel' || k === 'vanE' ? 'vanE' : k))))))),
          h('p', { class: 'note' }, t('compareNote'), ' ', t('optsNote')))));
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
