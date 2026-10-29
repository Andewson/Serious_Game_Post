// Rundenbericht, Schlussbericht und kleine Diagramme.
import { h, s, TEAM_COLORS, TEAM_HEX, icon } from './dom.js';
import { t, fmtChf, fmtPct, fmtInt, fmtG } from '../i18n.js';
import { ZONES, KPI_KEYS, cumulative, standardsOf, scoreGame } from '../engine.js';
import { coverageBlock } from './coverage.js';

export function fmtKpi(k, v) {
  if (k === 'costPerParcel') return fmtChf(v);
  if (k === 'co2PerParcel') return fmtG(v);
  return fmtPct(v, 1);
}
const better = { costPerParcel: -1, onTime: 1, co2PerParcel: -1, failRate: -1 };

export function eventTitle(ev) { return t('ev_' + ev.type); }
export function eventDesc(ev, cfg) {
  const E = cfg.events;
  const p = {
    p: Math.round(((ev.type === 'peak' ? E.peak.demandFactor : E.demandSurge.factor) - 1) * 100) + ' %',
    v: ev.type === 'co2tax' ? E.co2tax.chfPerKg.toFixed(2)
      : ev.type === 'boxBoom' ? Math.round(E.boxBoom.acceptance * 100) + ' %'
        : ev.type === 'strike' ? Math.round(E.strike.capacityFactor * 100) + ' %'
          : ev.type === 'shortage' ? Math.round(E.shortage.capacityFactor * 100) + ' %' : '',
    zone: ev.zone ? t('zone_' + ev.zone) : ''
  };
  return t('evDesc_' + ev.type, p);
}

export function messageText(m) {
  const p = { ...m };
  if (m.zone) p.zone = t('zone_' + m.zone);
  if (m.code === 'zoneBelowStandard' || m.code === 'highFail') p.value = fmtPct(m.value);
  if (m.code === 'expensiveZone' || m.code === 'co2tax') p.value = Number(m.value).toFixed(2);
  return t('msg_' + m.code, p);
}

export function standardsPills(state, std) {
  const S = state.config.standards;
  const pill = (ok, label) => h('span', { class: `pill ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check' : 'x', 10), ' ', label);
  return h('div', { class: 'stds' },
    pill(std.onTimeNational, t('std_onTimeNational', { v: fmtPct(S.onTimeNational) })),
    ...ZONES.map((z) => pill(std.zones[z], t('std_zone', { zone: t('zone_' + z), v: fmtPct(S.onTimeZone) }))),
    pill(std.cost, t('std_cost', { v: state.config.tariffPerParcel.toFixed(2) })));
}

export function verdict(state, std) {
  if (std.all) return t('verdictOk');
  const S = state.config.standards;
  const list = [];
  if (!std.onTimeNational) list.push(t('std_onTimeNational', { v: fmtPct(S.onTimeNational) }));
  for (const z of ZONES) if (!std.zones[z]) list.push(t('std_zone', { zone: t('zone_' + z), v: fmtPct(S.onTimeZone) }));
  if (!std.cost) list.push(t('std_cost', { v: state.config.tariffPerParcel.toFixed(2) }));
  return t('verdictMissing', { list: list.join(', ') });
}

function kpiTiles(rep, prevRep, cum) {
  return h('div', { class: 'kpistrip four' }, KPI_KEYS.map((k) => {
    let delta = null;
    if (prevRep) {
      const d = rep.kpis[k] - prevRep.kpis[k];
      if (Math.abs(d) > 1e-6) {
        const good = d * better[k] > 0;
        const a = Math.abs(d); const sign = d > 0 ? '+' : '−';
        const txt = k === 'costPerParcel' ? `${sign}${a.toFixed(2)}` : k === 'co2PerParcel' ? `${sign}${Math.round(a)} g` : `${sign}${(a * 100).toFixed(1)} Pkt.`;
        delta = h('span', { class: good ? 'good' : 'bad' }, txt);
      }
    }
    return h('div', {},
      h('div', { class: 'kpi-l' }, t('kpi_' + k)),
      h('div', { class: 'kpi-v ink' }, fmtKpi(k, rep.kpis[k])),
      h('div', { class: 'kpi-c' }, delta, cum ? h('span', {}, delta ? ' · Ø ' : 'Ø ', fmtKpi(k, cum.kpis[k])) : null));
  }));
}

export function standardsList(state, std, cum) {
  const S = state.config.standards;
  const row = (ok, label, val) => h('div', { class: 'r' }, h('span', { class: `mark ${ok ? 'ok' : 'bad'}` }, icon(ok ? 'check' : 'x', 10)), h('span', {}, label), val ? h('span', { class: `v ${ok ? '' : 'bad'}` }, val) : null);
  return h('div', { class: 'stdlist' },
    row(std.onTimeNational, t('std_onTimeNational', { v: fmtPct(S.onTimeNational) }), cum ? fmtPct(cum.kpis.onTime, 1) : ''),
    ...ZONES.map((z) => row(std.zones[z], t('std_zone', { zone: t('zone_' + z), v: fmtPct(S.onTimeZone) }), cum ? fmtPct(cum.zoneKpis[z].onTime, 1) : '')),
    row(std.cost, t('std_cost', { v: state.config.tariffPerParcel.toFixed(2) }), cum ? fmtChf(cum.kpis.costPerParcel) : ''));
}

function zoneTable(state, rep) {
  const tariff = state.config.tariffPerParcel;
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, t('zone')), h('th', {}, t('parcels')), h('th', {}, t('kpi_onTime')), h('th', {}, t('kpi_failRate')), h('th', {}, t('kpi_costPerParcel')), h('th', {}, t('kpi_co2PerParcel')), h('th', {}, t('margin')))),
    h('tbody', {}, ZONES.map((z) => {
      const zk = rep.zoneKpis[z];
      const m = tariff * rep.zones[z].parcels - rep.zones[z].cost;
      return h('tr', {},
        h('td', {}, t('zone_' + z)), h('td', {}, fmtInt(rep.zones[z].parcels)),
        h('td', { class: zk.onTime < state.config.standards.onTimeZone ? 'bad' : '' }, fmtPct(zk.onTime)),
        h('td', {}, fmtPct(zk.failRate, 1)), h('td', {}, fmtChf(zk.costPerParcel)), h('td', {}, fmtG(zk.co2PerParcel)),
        h('td', { class: m < 0 ? 'bad' : '' }, (m >= 0 ? '+' : '−') + fmtInt(Math.abs(m))));
    })));
}

function costBars(rep) {
  const P = rep.totals.parcels;
  const entries = Object.entries(rep.breakdown).filter(([, v]) => v > 0.5);
  const max = Math.max(...entries.map(([, v]) => v / P), 0.01);
  return h('div', { class: 'bars' }, entries.sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'bar' },
    h('span', {}, t('cb_' + k)), h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${(v / P / max) * 100}%` } })), h('span', { class: 'right' }, (v / P).toFixed(2)))));
}

function utilTable(rep) {
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, t('element')), h('th', {}, t('location')), h('th', {}, t('utilization')))),
    h('tbody', {}, rep.utilization.map((u) => h('tr', {},
      h('td', {}, t('el_' + u.kind)), h('td', {}, u.field), h('td', { class: u.used / u.capacity < 0.4 ? 'bad' : '' }, fmtPct(u.capacity ? u.used / u.capacity : 0))))));
}

export function comparisonTable(state, mySlots = []) {
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, t('teams')), ...KPI_KEYS.map((k) => h('th', {}, t('kpi_' + k))), h('th', {}, t('standards')))),
    h('tbody', {}, state.teams.map((team) => {
      const cum = cumulative(team);
      const std = standardsOf(state, cum);
      const n = [std.onTimeNational, ...ZONES.map((z) => std.zones[z]), std.cost].filter(Boolean).length;
      return h('tr', { class: mySlots.includes(team.idx) ? 'me' : '' },
        h('td', {}, h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[team.idx] } }), team.name)),
        ...KPI_KEYS.map((k) => h('td', {}, team.reports.length ? fmtKpi(k, cum.kpis[k]) : '–')),
        h('td', {}, h('span', { class: `pill ${n === 5 ? 'ok' : 'bad'}` }, `${n} / 5`)));
    })));
}

export function roundReportView(state, slot, round, { onClose, closeLabel, mySlots = [] } = {}) {
  const team = state.teams[slot];
  const rep = team.reports[round - 1];
  const prev = team.reports[round - 2];
  const cum = cumulative({ reports: team.reports.slice(0, round) });
  const std = standardsOf(state, cum);
  const shock = state.revealedShocks.find((x) => x.round === round);
  const share = rep.kpis.costPerParcel / (rep.kpis.costPerParcel + state.config.upstreamCostPerParcel);
  const m = rep.market || {};
  return h('div', { class: 'stack' },
    shock
      ? h('div', { class: 'shock' }, h('div', { class: 'small' }, t('shockTitle')), h('div', { class: 'headline' }, eventTitle(shock)), h('div', {}, eventDesc(shock, state.config)))
      : h('div', { class: 'shock calm' }, t('noShock')),
    kpiTiles(rep, prev, cum),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, t('keyPoints')), h('div', { class: 'msgs' }, rep.messages.map((msg) => h('div', { class: `msg ${msg.code === 'allGood' ? 'good' : ''}` }, messageText(msg))))),
      h('div', { class: 'card' }, h('h3', {}, t('standards'), h('span', { class: 'muted', style: { fontWeight: 400 } }, ' (Ø)')), standardsList(state, std, cum), h('p', { class: 'verdict' }, verdict(state, std)))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, t('coverageTitle')), coverageBlock(rep)),
      h('div', { class: 'card' }, h('h3', {}, t('costBreakdown')), costBars(rep),
        h('p', { class: 'note' }, `${t('lastMileShare')}: ${fmtPct(share)}`))),
    h('div', { class: 'card', style: { overflowX: 'auto' } }, h('h3', {}, t('zones')), zoneTable(state, rep)),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, t('marketTitle')),
        h('p', {}, `${t('drivers')}: ${m.drivers ?? '–'} · ${t('marketLoad')}: ${m.load ? fmtPct(m.load) : '–'}`),
        h('p', {}, `${t('wage')}: ${(m.wage ?? 1).toFixed(3)} → ${(m.nextWage ?? 1).toFixed(3)} (+${((m.growth ?? 0) * 100).toFixed(1)} %)`),
        h('p', { class: 'note' }, t('driversNote'))),
      h('details', { class: 'card' }, h('summary', {}, t('utilization')), utilTable(rep))),
    h('div', { class: 'card', style: { overflowX: 'auto' } }, h('h3', {}, t('comparison')), comparisonTable(state, mySlots)),
    onClose ? h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: onClose }, closeLabel || t('close'))) : null);
}

export function lineChart(state, k) {
  const W = 300, H = 150, P = 48, TOP = 22;
  const series = state.teams.map((team) => team.reports.map((r) => r.kpis[k]));
  const all = series.flat();
  if (!all.length) return h('div');
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const n = state.rounds;
  const x = (i) => P + (i * (W - P - 8)) / Math.max(1, n - 1);
  const y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 18 - TOP);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' },
    s('text', { x: 4, y: 12, style: 'font-weight:600;fill:#0a0a0a;font-size:11px' }, t('kpi_' + k)),
    s('line', { x1: P, x2: W - 8, y1: H - 18, y2: H - 18, stroke: '#d4d4d4' }),
    ...Array.from({ length: n }, (_, i) => s('text', { x: x(i), y: H - 4, 'text-anchor': 'middle' }, `R${i + 1}`)),
    s('text', { x: P - 4, y: y(hi) + 3, 'text-anchor': 'end' }, fmtKpi(k, hi).replace('CHF ', '')),
    s('text', { x: P - 4, y: y(lo) + 3, 'text-anchor': 'end' }, fmtKpi(k, lo).replace('CHF ', '')),
    ...series.map((vals, ti) => s('polyline', { points: vals.map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: TEAM_HEX[ti], 'stroke-width': 2.2 })),
    ...series.flatMap((vals, ti) => vals.map((v, i) => s('circle', { cx: x(i), cy: y(v), r: 2, fill: TEAM_HEX[ti] }))));
  return svg;
}

export function finalReportView(state, { mySlots = [], onHome, onExport } = {}) {
  const score = scoreGame(state);
  const winner = score.winner != null ? score.teams.find((x) => x.idx === score.winner) : null;
  return h('div', { class: 'stack' },
    winner
      ? h('div', { class: 'winner' }, h('div', { class: 'small' }, t('winner')), h('h2', {}, winner.name), h('div', {}, `${t('points')}: ${winner.points.toFixed(1)}`))
      : h('div', { class: 'notice' }, t('noWinner')),
    h('div', { class: 'card', style: { overflowX: 'auto' } },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, t('rank')), h('th', { class: 'l' }, t('teams')), ...KPI_KEYS.map((k) => h('th', {}, t('kpi_' + k))), h('th', {}, t('standards')), h('th', {}, t('points')))),
        h('tbody', {}, score.ranking.map((tm, i) => {
          const n = [tm.standards.onTimeNational, ...ZONES.map((z) => tm.standards.zones[z]), tm.standards.cost].filter(Boolean).length;
          return h('tr', { class: mySlots.includes(tm.idx) ? 'me' : '' },
            h('td', {}, String(i + 1)),
            h('td', { class: 'l' }, h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx] } }), tm.name)),
            ...KPI_KEYS.map((k) => h('td', {}, fmtKpi(k, tm.cum.kpis[k]), h('div', { class: 'small muted' }, `${(tm.kpiPoints[k] ?? 0).toFixed(1)} P.`))),
            h('td', {}, h('span', { class: `pill ${n === 5 ? 'ok' : 'bad'}` }, `${n}/5`)),
            h('td', {}, h('strong', {}, tm.points.toFixed(1))));
        })))),
    h('div', { class: 'grid2' }, score.ranking.map((tm) => h('div', { class: 'card' },
      h('h3', { class: 'row', style: { gap: '8px', marginBottom: '8px' } }, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx] } }), tm.name),
      standardsList(state, tm.standards, tm.cum),
      h('p', { class: 'verdict' }, verdict(state, tm.standards)),
      h('p', { class: 'note' },
        `${t('margin')}: ${ZONES.map((z) => `${t('zone_' + z)} ${tm.margin[z] >= 0 ? '+' : ''}${fmtInt(tm.margin[z])}`).join(' · ')}`, h('br'),
        `${t('lastMileShare')}: ${fmtPct(tm.lastMileShare)}`)))),
    h('div', { class: 'card' }, h('h3', {}, t('perRound')), h('div', { class: 'grid2' }, KPI_KEYS.map((k) => lineChart(state, k))),
      h('div', { class: 'legend' }, state.teams.map((tm) => h('span', {}, h('span', { class: 'dot', style: { background: TEAM_COLORS[tm.idx] } }), tm.name)))),
    h('div', { class: 'row' },
      onExport ? h('button', { class: 'btn', onclick: onExport }, t('export')) : null,
      h('span', { class: 'spacer' }),
      onHome ? h('button', { class: 'btn primary', onclick: onHome }, t('home')) : null));
}

export function exportCsv(state, meta) {
  const rows = [['game', 'team', 'round', 'actions', ...KPI_KEYS, ...ZONES.map((z) => `onTime_${z}`), 'shock']];
  for (const team of state.teams) {
    team.reports.forEach((rep, i) => {
      const acts = (team.actionsLog[i] || { actions: [] }).actions;
      const shock = state.revealedShocks.find((x) => x.round === rep.round);
      rows.push([meta.code || meta.id, team.name, rep.round, JSON.stringify(acts), ...KPI_KEYS.map((k) => rep.kpis[k].toFixed(4)), ...ZONES.map((z) => rep.zoneKpis[z].onTime.toFixed(4)), shock ? shock.type : '']);
    });
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `last-mile-${meta.code || meta.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Kompakte Zusammenfassung für Verlauf und Statistik
export function buildSummary(state, meta) {
  const score = scoreGame(state);
  const lastRound = state.rounds;
  return {
    v: state.config.version, rounds: state.rounds, code: meta.code, date: new Date().toISOString(), winner: score.winner,
    events: state.events,
    teams: score.teams.map((tm) => {
      const team = state.teams[tm.idx];
      const built = { stadt: {}, agglo: {}, land: {} };
      for (const el of team.elements) {
        if (el.activeFrom > lastRound || (el.removeFrom != null && el.removeFrom <= lastRound)) continue;
        const zone = el.field[0] === 'S' ? 'stadt' : el.field[0] === 'A' ? 'agglo' : 'land';
        const key = el.kind === 'van' ? (el.drive === 'diesel' ? 'vanDiesel' : 'vanE') : el.kind;
        built[zone][key] = (built[zone][key] || 0) + 1;
      }
      if (team.post && (team.post.removeFrom == null || team.post.removeFrom > lastRound)) built.land.post = 1;
      return { name: tm.name, idx: tm.idx, kpis: tm.cum.kpis, zoneOnTime: Object.fromEntries(ZONES.map((z) => [z, tm.cum.zoneKpis[z].onTime])), standards: tm.standards, points: tm.points, built };
    })
  };
}
