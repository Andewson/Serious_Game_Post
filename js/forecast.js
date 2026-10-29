// Prognose und Kennzahlen für die Planung.
// Die Prognose rechnet die laufende Runde mit dem echten Rechenkern, aber nur mit dem, was die Teams wissen:
// Schocks dieser und späterer Runden werden entfernt, die anderen Teams handeln nicht. Für die eigene Runde
// ist das Ergebnis darum exakt, ausser eine Überraschung tritt ein.
import { resolveRound, activeEffects, validateAction, ZONES } from './engine.js';
import { buildMap } from './map.js';

function knownState(state) {
  const s = { ...state, events: { ...state.events, shocks: state.events.shocks.filter((x) => x.round < state.round) } };
  return s;
}

// Liefert den Bericht, den das Team diese Runde mit `plan` bekäme (oder null, wenn das Spiel vorbei ist).
export function forecastReport(state, teamIdx, plan = []) {
  if (state.finished) return null;
  const acts = state.teams.map((_, i) => (i === teamIdx ? plan : []));
  const next = resolveRound(knownState(state), acts);
  const team = next.teams[teamIdx];
  return team.reports[team.reports.length - 1];
}

// Ausblick auf die nächste Runde, wenn das Team jetzt `plan` abgibt und danach nichts mehr tut.
// Nur angekündigte Ereignisse wirken (Ankündigungen haben mindestens eine Runde Vorlauf, also ist nichts
// verraten). Die Löhne sind eine Schätzung, weil die anderen Teams hier nichts tun.
export function outlookReport(state, teamIdx, plan = []) {
  if (state.finished || state.round >= state.rounds) return null;
  const acts = state.teams.map((_, i) => (i === teamIdx ? plan : []));
  const next = resolveRound(knownState(state), acts);
  return forecastReport(next, teamIdx, []);
}

// Wer trägt die Pakete einer Zone? Anteile nach Quelle (für die Abdeckungsbalken).
export function coverageOf(report, zone) {
  const map = buildMap();
  const out = { box: 0, own: 0, post: 0, crowd: 0, emergency: 0, demand: 0 };
  for (const [fid, rec] of Object.entries(report.perField)) {
    if (map.byId[fid].zone !== zone) continue;
    out.demand += rec.demand;
    for (const b of rec.by) {
      if (b.src === 'box' || b.src === 'post' || b.src === 'crowd' || b.src === 'emergency') out[b.src] += b.n;
      else out.own += b.n;
    }
  }
  return out;
}

// Anteil Notfall-Pakete pro Feld (für die Karte)
export function emergencyByField(report) {
  const res = {};
  for (const [fid, rec] of Object.entries(report.perField)) {
    const em = rec.by.filter((b) => b.src === 'emergency').reduce((a, b) => a + b.n, 0);
    res[fid] = rec.demand > 0 ? em / rec.demand : 0;
  }
  return res;
}

// ---------- Kennzahlen pro Option und Zone ----------
// Alle Werte pro Runde und mit Standard-Servicepolitik; berücksichtigt bekannte Effekte der laufenden Runde
// (CO₂-Abgabe, Null-Emissions-Zone, Treibstoffschock, Fahrermangel) und den aktuellen Lohnindex.
export const OPTION_KINDS = ['vanDiesel', 'vanE', 'hub', 'box', 'post', 'crowd', 'emergency'];

export function optionSpecs(state, kind, zone) {
  const cfg = state.config;
  const E = cfg.elements;
  const Z = cfg.zones[zone];
  const fx = activeEffects(state, state.round, false);
  const wage = state.wage;
  const capF = (fx.strike ? cfg.events.strike.capacityFactor : 1) * (fx.shortage ? cfg.events.shortage.capacityFactor : 1);
  const taxPerG = fx.co2tax ? cfg.events.co2tax.chfPerKg / 1000 : 0;
  const f = Z.failRate;
  const dist = Z.distance;
  const fieldsIn = (z) => buildMap().active.filter((x) => x.zone === z).length;
  let r;
  switch (kind) {
    case 'vanDiesel':
    case 'vanE': {
      const p = E[kind];
      const fuel = kind === 'vanDiesel' && fx.fuel ? cfg.events.fuel.dieselVarFactor : 1;
      const capacity = (p.capacity * capF) / (p.weight[zone] * (1 + f));
      const variable = p.varCost * fuel * dist * (1 + f);
      const co2 = p.co2 * dist * (1 + f);
      r = { fixed: p.leasing + p.driverCost * p.drivers * wage, capacity, variable, co2, onTime: 1 - f, fail: f, range: p.range, delay: 0, drivers: p.drivers };
      if (kind === 'vanDiesel' && zone === 'stadt' && fx.zez) r.blocked = 'zez';
      break;
    }
    case 'hub': {
      const p = E.hub;
      const capacity = (p.capacity * capF) / (p.weight[zone] * (1 + f));
      const variable = p.varCost * dist * (1 + f) + p.resupplyCost;
      const co2 = p.co2 * dist * (1 + f) + p.resupplyCo2;
      r = { fixed: p.leasing + p.driverCost * p.drivers * wage, capacity, variable, co2, onTime: 1 - f, fail: f, range: p.range, delay: p.buildDelay, drivers: p.drivers };
      if (!p.zones.includes(zone)) r.blocked = 'cityOnly';
      break;
    }
    case 'box': {
      const p = E.box;
      const acc = fx.boxBoom ? cfg.events.boxBoom.acceptance : p.acceptance;
      // pro Feld: eine Box nimmt höchstens den Abholanteil der Nachfrage dieses Felds
      r = { fixed: p.leasing, capacity: Z.demand * acc, variable: p.varCost * (1 + p.failRate) + p.resupplyCost, co2: p.resupplyCo2, onTime: 1 - p.failRate, fail: p.failRate, range: 0, delay: p.buildDelay, perField: true, fields: fieldsIn(zone), acceptance: acc };
      break;
    }
    case 'post': {
      const p = E.post;
      const n = fieldsIn('land');
      r = { fixed: p.feePerRegion * 3, capacity: cfg.zones.land.demand * n * p.capacityShare * (fx.strike ? cfg.events.strike.capacityFactor : 1), variable: p.varCost, co2: p.co2, onTime: p.onTimeRate, fail: p.failRate, range: null, delay: 0 };
      if (zone !== 'land') r.blocked = 'landOnly';
      break;
    }
    case 'crowd': {
      const p = E.crowd;
      r = { fixed: 0, capacity: p.capacity / (1 + p.failRate), variable: p.varCost * (1 + p.failRate), co2: p.co2 * dist * (1 + p.failRate), onTime: 1 - p.failRate, fail: p.failRate, range: p.range, delay: 0, oneRound: true };
      break;
    }
    case 'emergency': {
      const p = E.emergency;
      r = { fixed: 0, capacity: Infinity, variable: p.varCost + (fx.fuel ? cfg.events.fuel.emergencyExtra : 0), co2: p.co2 * dist, onTime: 0, fail: p.failRate, range: null, delay: 0, fallback: true };
      break;
    }
    default: return null;
  }
  r.tax = r.co2 * taxPerG;
  r.fullCost = (r.capacity > 0 && Number.isFinite(r.capacity) ? r.fixed / r.capacity : 0) + r.variable + r.tax;
  r.kind = kind;
  r.zone = zone;
  return r;
}

// Servicepolitik «Zeitfenster»: was sich ändert
export function windowEffect(state, zone) {
  const Z = state.config.zones[zone];
  return { capacityLoss: Z.timeWindowCapacityLoss, failBefore: Z.failRate, failAfter: Z.failRate * state.config.timeWindowFailFactor };
}

// Prüft eine Aktion gegen den Plan; liefert {ok, error}
export function checkAction(state, teamIdx, action, plan) {
  return validateAction(state, teamIdx, action, plan);
}

export { ZONES };

// ---------- Bewertungen 1–5 ----------
const HIGHER_BETTER = { onTime: true, reliability: true };
function scale(thr, v, higher) {
  for (let i = 0; i < thr.length; i++) if (higher ? v >= thr[i] - 1e-9 : v <= thr[i] + 1e-9) return 5 - i;
  return 1;
}
// KPI eines Teams oder eines Felds (costPerParcel, onTime, co2PerParcel, failRate)
export function rateKpi(cfg, k, v) { return scale(cfg.ratings.kpi[k], v, !!HIGHER_BETTER[k]); }
// Eigenschaften einer Option (cost = CHF pro Paket voll ausgelastet, co2 = g pro Paket, reliability = Anteil pünktlich)
export function rateOption(cfg, k, v) { return scale(cfg.ratings.option[k], v, !!HIGHER_BETTER[k]); }

// Typischer Einsatzort einer Option für die feste Bewertung
const RATING_ZONE = { vanDiesel: 'stadt', vanE: 'stadt', hub: 'stadt', box: 'stadt', post: 'land', crowd: 'stadt', emergency: 'stadt' };
export function optionRatings(state, kind) {
  const z = RATING_ZONE[kind];
  const sp = optionSpecs({ ...state, events: { ...state.events, shocks: [] } }, kind, z);
  return {
    zone: z, specs: sp,
    cost: rateOption(state.config, 'cost', sp.fullCost),
    co2: rateOption(state.config, 'co2', sp.co2),
    reliability: rateOption(state.config, 'reliability', sp.onTime)
  };
}

// Kennzahl pro Feld aus einem Bericht
export function fieldValue(rec, k) {
  const d = rec.demand || 1;
  if (k === 'onTime') return rec.onTime / d;
  if (k === 'costPerParcel') return rec.cost / d;
  if (k === 'co2PerParcel') return rec.co2 / d;
  if (k === 'failRate') return rec.failed / d;
  return null;
}

// Warum kommen Pakete zu spät? (Anzahl Pakete)
export function lateReasons(report) {
  const t = report.totals;
  const em = t.emergency;
  const post = t.postLate;
  const failed = Math.max(0, t.parcels - t.onTime - em - post);
  return { failed, emergency: em, post, total: t.parcels - t.onTime, parcels: t.parcels };
}
