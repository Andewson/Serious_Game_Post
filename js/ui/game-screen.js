// Spielbildschirm: Karte, Lage, Aktionsplanung, Netz, Abgabe. Für lokale und Online-Spiele.
import { h, clear, TEAM_COLORS } from './dom.js';
import { renderMap } from './map-view.js';
import { t, fmtChf, fmtPct, fmtG } from '../i18n.js';
import { validateAction, knownSituation, isActive, ZONES } from '../engine.js';
import { buildMap, areaFields, AREAS } from '../map.js';
import { eventTitle, eventDesc, roundReportView, finalReportView } from './report.js';

const ACTIONS = ['vans', 'hub', 'boxes', 'post', 'crowd', 'service', 'remove'];

// controller: { state, meta, mySlots, activeSlot, submittedSlots:Set, canSkip, submit(slot, actions), skip(), onFinished }
export function GameScreen(root, controller, nav) {
  const ui = { plan: {}, configuring: null, selectedField: null, removeSel: new Set(), error: '' };
  for (const sl of controller.mySlots) ui.plan[sl] = [];

  function slot() { return controller.activeSlot; }
  function state() { return controller.state; }
  function cfg() { return state().config; }
  function team() { return state().teams[slot()]; }
  function plan() { return ui.plan[slot()] || (ui.plan[slot()] = []); }
  const submittedMine = () => controller.submittedSlots.has(slot());

  function render() {
    clear(root);
    const st = state();
    if (st.finished) {
      root.append(h('div', { class: 'page' }, h('h1', {}, t('finalTitle')), finalReportView(st, { mySlots: controller.mySlots, onHome: () => nav('home'), onExport: controller.exportCsv })));
      return;
    }
    const grid = h('div', { class: 'game' });
    const mapCol = h('div', { class: 'mapwrap' });
    const side = h('div', { class: 'side' });
    grid.append(mapCol, side);
    root.append(grid);
    renderStatus(mapCol);
    const mapBox = h('div', { style: { position: 'relative' } });
    mapCol.append(mapBox);
    renderTheMap(mapBox);
    mapCol.append(legend());
    renderSide(side);
  }

  function renderStatus(col) {
    const st = state();
    const tm = team();
    col.append(h('div', { class: 'statusbar' },
      h('span', { class: 'pill', style: { borderColor: TEAM_COLORS[tm.idx] } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx] } }), tm.name),
      h('span', { class: 'pill accent' }, `${t('round')} ${st.round} ${t('of')} ${st.rounds}`),
      h('span', { class: 'pill' }, `${t('wage')} ${st.wage.toFixed(3)}`),
      controller.meta.code && controller.meta.mode === 'online' ? h('span', { class: 'pill' }, `${t('code')}: ${controller.meta.code}`) : null,
      h('span', { class: 'spacer' }),
      st.round > 1 ? h('button', { class: 'btn small', onclick: () => showReport(st.round - 1) }, t('showReport')) : null));
    if (controller.versionNote) col.append(h('div', { class: 'notice small' }, controller.versionNote));
  }

  function zezState() {
    const st = state();
    const a = st.events.announced.find((x) => x.type === 'zez');
    if (!a || a.announceRound > st.round) return 'none';
    return st.round >= a.effectRound ? 'active' : 'announced';
  }

  function renderTheMap(box) {
    const st = state();
    const tm = team();
    const r = st.round;
    const elements = tm.elements.filter((e) => e.removeFrom == null || e.removeFrom > r).map((e) => ({ ...e, pending: e.activeFrom > r }));
    const conf = ui.configuring;
    let selectable = null;
    let rangePreview = null;
    if (conf && ['vans', 'hub', 'crowd'].includes(conf.type) && !submittedMine()) {
      const E = cfg().elements;
      if (conf.type === 'vans' && conf.mode === 'convert') {
        const fields = new Set(tm.elements.filter((e) => e.kind === 'van' && e.drive === 'diesel' && (e.removeFrom == null || e.removeFrom > r)).map((e) => e.field));
        selectable = (id) => fields.has(id);
        rangePreview = { range: E.vanDiesel.range };
      } else if (conf.type === 'vans') { selectable = () => true; rangePreview = { range: E.vanDiesel.range }; }
      else if (conf.type === 'hub') { selectable = (id) => buildMap().byId[id].zone === 'stadt'; rangePreview = { range: E.hub.range, zones: E.hub.zones }; }
      else if (conf.type === 'crowd') { selectable = () => true; rangePreview = { range: E.crowd.range }; }
    }
    // Status der letzten Runde: Felder mit Notfall-Paketen rot
    let fieldStatus = null;
    const last = tm.reports[tm.reports.length - 1];
    if (last && !conf) {
      fieldStatus = {};
      for (const [fid, rec] of Object.entries(last.perField)) {
        const em = rec.by.filter((b) => b.src === 'emergency').reduce((a, b) => a + b.n, 0);
        fieldStatus[fid] = em / rec.demand > 0.05 ? 'bad' : 'ok';
      }
    }
    const post = tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > r) ? (tm.post.activeFrom > r ? 'pending' : 'active') : null;
    renderMap(box, {
      teamIdx: tm.idx, elements, crowd: [], post, zezState: zezState(),
      selectable, selectedField: ui.selectedField, rangePreview,
      onSelect: (id) => { ui.selectedField = id; ui.error = ''; render(); },
      fieldStatus
    });
  }

  function legend() {
    return h('div', { class: 'legend' },
      ...['stadt', 'agglo', 'land', 'see', 'berg'].map((z) => h('span', {}, h('span', { class: 'swatch', style: { background: `var(--zone-${z})` } }), t('zone_' + z))),
      h('span', {}, h('span', { class: 'swatch', style: { border: '2px dashed var(--bad)', background: 'transparent' } }), t('ev_zez')),
      h('span', {}, h('span', { class: 'swatch', style: { border: '2px solid var(--bad)', background: 'transparent' } }), t('el_emergency')),
      h('span', { class: 'muted' }, t('tutorialHint')));
  }

  function renderSide(side) {
    if (controller.mySlots.length > 1) {
      side.append(h('div', { class: 'teamtabs' }, controller.mySlots.map((sl) => h('button', {
        class: `teamtab ${sl === slot() ? 'sel' : ''}`,
        onclick: () => { controller.activeSlot = sl; ui.configuring = null; ui.selectedField = null; ui.removeSel.clear(); render(); }
      }, h('span', { class: 'dot', style: { background: TEAM_COLORS[sl] } }), state().teams[sl].name, controller.submittedSlots.has(sl) ? ' ✓' : ''))));
    }
    side.append(situationSection(), planSection(), networkSection());
  }

  function situationSection() {
    const st = state();
    const k = knownSituation(st);
    const items = [];
    for (const a of k.announcements) {
      if (a.type === 'peak' && a.effectRound < st.round) continue;
      const active = a.effectRound <= st.round;
      const when = a.type === 'peak' ? t('effectOnlyRound', { r: a.effectRound }) : t('effectInRound', { r: a.effectRound });
      items.push(h('div', { class: `event ${active ? 'active' : ''}` }, h('div', { class: 'when' }, active ? t('activeNow') : t('announcements'), ' · ', when), h('strong', {}, eventTitle(a)), h('div', { class: 'small' }, eventDesc(a, st.config))));
    }
    for (const sh of k.pastShocks) {
      const fx = st.config.events;
      const still = (sh.type === 'shortage') || (sh.type === 'fuel' && st.round < sh.round + fx.fuel.duration);
      if (!still) continue;
      items.push(h('div', { class: 'event active' }, h('div', { class: 'when' }, t('activeNow')), h('strong', {}, eventTitle(sh)), h('div', { class: 'small' }, eventDesc(sh, st.config))));
    }
    return h('section', {}, h('h4', {}, t('situation')), items.length ? items : h('p', { class: 'muted small' }, t('noAnnouncements')));
  }

  function planSection() {
    const st = state();
    const max = st.config.actionsPerRound;
    const p = plan();
    const sec = h('section', {}, h('h4', {}, t('yourActions'), ' · ', t('actionsLeft', { n: max - p.length, max })));
    if (submittedMine()) {
      const waiting = st.teams.filter((tm) => !controller.submittedSlots.has(tm.idx)).map((tm) => tm.name);
      sec.append(h('div', { class: 'planned' }, '✓ ', t('submitted')));
      if (waiting.length) sec.append(h('p', { class: 'small muted' }, t('waitingFor', { names: waiting.join(', ') })));
      if (controller.canSkip && controller.canSkip()) sec.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'small muted' }, t('skipAvailable')), h('button', { class: 'btn small', onclick: () => controller.skip() }, t('skipMissing'))));
      return sec;
    }
    p.forEach((a, i) => sec.append(h('div', { class: 'planned' }, h('span', {}, actionText(a)), h('span', { class: 'spacer' }), h('button', { class: 'btn small ghost', onclick: () => { p.splice(i, 1); render(); } }, '✕'))));
    for (let i = p.length; i < max; i++) sec.append(h('div', { class: 'slotempty' }, t('chooseAction')));
    if (p.length < max) sec.append(h('div', { style: { marginTop: '10px' } }, ui.configuring ? configurator() : actionMenu()));
    if (ui.error) sec.append(h('p', { class: 'err' }, ui.error));
    sec.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: async (ev) => { ev.target.disabled = true; await controller.submit(slot(), [...p]); ui.plan[slot()] = []; ui.configuring = null; ui.selectedField = null; } }, t('submit'))));
    return sec;
  }

  function actionMenu() {
    return h('div', { class: 'actlist' }, ACTIONS.filter((a) => a !== 'remove').map((type) => h('button', {
      class: 'actbtn',
      onclick: () => { ui.configuring = { type, mode: 'new', count: 1, drive: 'e', area: 'stadt', zone: 'stadt', policy: 'window' }; ui.selectedField = null; ui.error = ''; render(); }
    }, h('div', { class: 't' }, t('act_' + type)), h('div', { class: 'd' }, actionDesc(type)))));
  }

  function actionDesc(type) {
    if (type === 'boxes') return t('actDesc_boxes', { acc: fmtPct(cfg().elements.box.acceptance) });
    return t('actDesc_' + type);
  }

  function specs(kind) {
    const E = cfg().elements;
    const w = state().wage;
    const Z = cfg().zones;
    const rows = [];
    const add = (k, v) => rows.push(h('span', {}, t(k)), h('b', {}, v));
    if (kind === 'vanDiesel' || kind === 'vanE') {
      const p = E[kind];
      add('fixPerRound', fmtChf(p.leasing + p.driverCost * p.drivers * w));
      add('varPerParcel', `${fmtChf(p.varCost)} × Distanz`);
      add('capacity', `${p.capacity} (Stadt), ${Math.round(p.capacity / p.weight.agglo)} (Agglo), ${Math.round(p.capacity / p.weight.land)} (Land)`);
      add('co2', `${fmtG(p.co2)} × Distanz`);
      add('range', `${p.range} ${t('fields')}`);
    } else if (kind === 'hub') {
      const p = E.hub;
      add('fixPerRound', fmtChf(p.leasing + p.driverCost * p.drivers * w));
      add('varPerParcel', fmtChf(p.varCost + p.resupplyCost));
      add('capacity', String(p.capacity));
      add('co2', fmtG(p.co2 + p.resupplyCo2));
      add('activeFrom', t('nextRoundShort'));
    } else if (kind === 'box') {
      const p = E.box;
      add('fixPerRound', `${fmtChf(p.leasing)} / Feld`);
      add('varPerParcel', fmtChf(p.varCost + p.resupplyCost));
      add('co2', fmtG(p.resupplyCo2));
      add('failRate', fmtPct(p.failRate, 1));
      add('activeFrom', t('nextRoundShort'));
    } else if (kind === 'post') {
      const p = E.post;
      add('fixPerRound', fmtChf(p.feePerRegion * 3));
      add('varPerParcel', fmtChf(p.varCost));
      add('kpi_onTime', fmtPct(p.onTimeRate));
      add('co2', fmtG(p.co2));
    } else if (kind === 'crowd') {
      const p = E.crowd;
      add('varPerParcel', fmtChf(p.varCost));
      add('capacity', String(p.capacity));
      add('failRate', fmtPct(p.failRate));
      add('co2', `${fmtG(p.co2)} × Distanz`);
    } else if (kind === 'service') {
      for (const z of ZONES) add('zone_' + z, `−${Math.round(Z[z].timeWindowCapacityLoss * 100)} % ${t('capacity')}, ${t('failRate')} ${fmtPct(Z[z].failRate * cfg().timeWindowFailFactor)} statt ${fmtPct(Z[z].failRate)}`);
    }
    return h('div', { class: 'specs' }, rows);
  }

  function configurator() {
    const c = ui.configuring;
    const box = h('div', { class: 'config stack' });
    box.append(h('div', { class: 'row' }, h('strong', {}, t('act_' + c.type)), h('span', { class: 'spacer' }), h('button', { class: 'btn small ghost', onclick: () => { ui.configuring = null; ui.selectedField = null; ui.error = ''; render(); } }, t('cancel'))));
    const seg = (key, options, labelKey) => h('div', { class: 'seg' }, options.map((o) => h('button', { class: c[key] === o ? 'sel' : '', onclick: () => { c[key] = o; if (key === 'mode') ui.selectedField = null; render(); } }, t(`${labelKey}_${o}`))));
    let action = null;
    if (c.type === 'vans') {
      box.append(seg('mode', ['new', 'convert'], 'mode'));
      if (c.mode === 'new') {
        box.append(h('div', { class: 'row' }, h('span', { class: 'small' }, t('drive')), seg('drive', ['e', 'diesel'], 'drive'),
          h('span', { class: 'small' }, t('count')), h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', { class: c.count === n ? 'sel' : '', onclick: () => { c.count = n; render(); } }, String(n))))));
        box.append(specs(c.drive === 'e' ? 'vanE' : 'vanDiesel'));
        if (ui.selectedField) action = { type: 'vans', field: ui.selectedField, count: c.count, drive: c.drive };
      } else {
        box.append(specs('vanE'));
        if (ui.selectedField) action = { type: 'convert', field: ui.selectedField };
      }
      box.append(fieldHint());
    } else if (c.type === 'hub') {
      box.append(specs('hub'), fieldHint());
      if (ui.selectedField) action = { type: 'hub', field: ui.selectedField };
    } else if (c.type === 'crowd') {
      box.append(specs('crowd'), fieldHint());
      if (ui.selectedField) action = { type: 'crowd', field: ui.selectedField };
    } else if (c.type === 'boxes') {
      box.append(h('div', { class: 'row' }, h('span', { class: 'small' }, t('area')),
        h('select', { onchange: (e) => { c.area = e.target.value; render(); } }, AREAS.map((a) => h('option', { value: a, selected: c.area === a }, `${t('area_' + a)} (${areaFields(a).length} ${t('fields')})`)))));
      box.append(specs('box'));
      action = { type: 'boxes', area: c.area };
    } else if (c.type === 'post') {
      box.append(specs('post'));
      action = { type: 'post' };
    } else if (c.type === 'service') {
      box.append(h('div', { class: 'row' }, h('span', { class: 'small' }, t('zone')), seg('zone', ZONES, 'zone')));
      box.append(h('div', { class: 'row' }, h('span', { class: 'small' }, t('policy')), seg('policy', ['standard', 'window'], 'policy')));
      box.append(h('p', { class: 'small muted', style: { margin: 0 } }, `${t('selected')}: ${t('policy_' + team().service[c.zone])}`));
      box.append(specs('service'));
      action = { type: 'service', zone: c.zone, policy: c.policy };
    }
    const v = action ? validateAction(state(), slot(), action, plan()) : null;
    box.append(h('div', { class: 'row' }, h('span', { class: 'spacer' }),
      action && !v.ok ? h('span', { class: 'err' }, t('err_' + v.error)) : null,
      h('button', { class: 'btn primary small', disabled: !action || !v.ok, onclick: () => addAction(action) }, t('addAction'))));
    return box;
  }

  function fieldHint() {
    return h('div', { class: 'small' }, ui.selectedField ? h('span', { class: 'pill accent' }, `${t('selected')}: ${ui.selectedField}`) : h('span', { class: 'muted' }, '→ ', t('selectField')));
  }

  function addAction(action) {
    const p = plan();
    if (p.length >= cfg().actionsPerRound) { ui.error = t('err_full'); render(); return; }
    p.push(action);
    ui.configuring = null; ui.selectedField = null; ui.error = '';
    render();
  }

  function actionText(a) {
    switch (a.type) {
      case 'vans': return `${a.count} × ${t(a.drive === 'e' ? 'el_vanE' : 'el_vanDiesel')} · ${a.field}`;
      case 'convert': return `${t('act_convert')} · ${a.field}`;
      case 'hub': return `${t('el_hub')} · ${a.field}`;
      case 'boxes': return `${t('el_box')} · ${t('area_' + a.area)}`;
      case 'post': return t('el_post');
      case 'crowd': return `${t('el_crowd')} · ${a.field}`;
      case 'service': return `${t('zone_' + a.zone)}: ${t('policy_' + a.policy)}`;
      case 'remove': return `${t('act_remove')}: ${a.ids.length}`;
      default: return a.type;
    }
  }

  function networkSection() {
    const st = state();
    const tm = team();
    const r = st.round;
    const sec = h('section', {}, h('h4', {}, t('myNetwork')));
    const present = tm.elements.filter((e) => e.removeFrom == null || e.removeFrom > r);
    const groups = {};
    for (const e of present) {
      const z = buildMap().byId[e.field].zone;
      (groups[z] = groups[z] || []).push(e);
    }
    const list = h('div', { class: 'netlist' });
    const canEdit = !submittedMine();
    for (const z of ZONES) {
      const items = groups[z] || [];
      list.append(h('div', { class: 'small muted', style: { marginTop: '8px', fontWeight: 650 } }, `${t('zone_' + z)} · ${t('policy_' + tm.service[z])}`));
      if (!items.length && !(z === 'land' && tm.post)) list.append(h('div', { class: 'small muted' }, t('none')));
      for (const e of items) {
        const kind = e.kind === 'van' ? (e.drive === 'diesel' ? 'vanDiesel' : 'vanE') : e.kind;
        const status = e.activeFrom > r ? t('pending') : t('ready');
        list.append(h('label', {},
          canEdit ? h('input', { type: 'checkbox', checked: ui.removeSel.has(e.id), onchange: (ev) => { if (ev.target.checked) ui.removeSel.add(e.id); else ui.removeSel.delete(e.id); render(); } }) : null,
          h('span', {}, t('el_' + kind)), h('span', { class: 'muted' }, e.field), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, status)));
      }
      if (z === 'land' && tm.post && (tm.post.removeFrom == null || tm.post.removeFrom > r)) {
        list.append(h('label', {},
          canEdit ? h('input', { type: 'checkbox', checked: ui.removeSel.has('post'), onchange: (ev) => { if (ev.target.checked) ui.removeSel.add('post'); else ui.removeSel.delete('post'); render(); } }) : null,
          h('span', {}, t('el_post')), h('span', { class: 'spacer' }), h('span', { class: 'small muted' }, tm.post.activeFrom > r ? t('pending') : t('ready'))));
      }
    }
    sec.append(list);
    if (canEdit && ui.removeSel.size) {
      const action = { type: 'remove', ids: [...ui.removeSel] };
      const v = validateAction(st, slot(), action, plan());
      sec.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, t('actDesc_remove')),
        h('button', { class: 'btn small', disabled: !v.ok || plan().length >= cfg().actionsPerRound, onclick: () => { addAction(action); ui.removeSel.clear(); render(); } }, t('removeSelected'), ` (${ui.removeSel.size})`)));
    }
    return sec;
  }

  function showReport(round, afterClose) {
    const st = state();
    let viewSlot = controller.mySlots.includes(slot()) ? slot() : controller.mySlots[0];
    const overlay = h('div', { class: 'overlay' });
    const draw = () => {
      clear(overlay);
      const isLast = st.finished && round === st.rounds;
      const closeLabel = isLast ? t('toResults') : (round === st.round - 1 && !st.finished ? t('nextRound', { n: st.round }) : t('close'));
      overlay.append(h('div', { class: 'modal' },
        h('header', {}, h('h2', {}, `${t('reportTitle')} · ${t('round')} ${round}`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn small ghost', onclick: close }, '✕')),
        h('div', { class: 'body' },
          controller.mySlots.length > 1 ? h('div', { class: 'teamtabs' }, controller.mySlots.map((sl) => h('button', { class: `teamtab ${sl === viewSlot ? 'sel' : ''}`, onclick: () => { viewSlot = sl; draw(); } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[sl] } }), st.teams[sl].name))) : null,
          roundReportView(st, viewSlot, round, { onClose: close, closeLabel, mySlots: controller.mySlots }))));
    };
    function close() { overlay.remove(); if (afterClose) afterClose(); }
    draw();
    document.body.append(overlay);
  }

  render();
  return { render, showReport };
}
