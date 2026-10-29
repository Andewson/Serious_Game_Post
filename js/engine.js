// Rechenkern von «Redesign the Last Mile».
// Reine Funktionen: gleiche Eingaben ergeben auf jedem Gerät dasselbe Ergebnis.
import { buildMap, fieldsInRange, areaFields, hexDistance, AREAS } from './map.js';

export const ZONES = ['stadt', 'agglo', 'land'];
export const REGION_IDS = ['nord', 'ost', 'west'];
export const KPI_KEYS = ['costPerParcel', 'onTime', 'co2PerParcel', 'failRate'];
const LOWER_IS_BETTER = { costPerParcel: true, onTime: false, co2PerParcel: true, failRate: true };

// ---------- Zufall ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Ereignis-Generator mit Leitplanken ----------
// Regeln: Null-Emissions-Zone kommt immer (2 Runden Vorlauf); Peak 1 Runde vorher angekündigt;
// höchstens ein Schock pro Runde, nie in Runde 1 und nie in der Peak-Runde;
// jede Runde enthält mindestens eine Ankündigung, einen Wirkungsbeginn oder einen Schock.
export function generateEvents(seed, cfg, rounds) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const ev = cfg.events;
  for (let attempt = 0; attempt < 500; attempt++) {
    const announced = [];
    const zezEff = randInt(rng, 1 + ev.zez.announceLead, rounds);
    announced.push({ type: 'zez', effectRound: zezEff, announceRound: zezEff - ev.zez.announceLead });
    const peakOptions = [];
    for (let r = 1 + ev.peak.announceLead; r <= rounds; r++) if (r !== zezEff) peakOptions.push(r);
    if (!peakOptions.length) continue;
    const peakEff = peakOptions[randInt(rng, 0, peakOptions.length - 1)];
    announced.push({ type: 'peak', effectRound: peakEff, announceRound: peakEff - ev.peak.announceLead });
    for (const type of shuffle(rng, ['co2tax', 'boxBoom']).slice(0, ev.extraAnnouncements)) {
      const lead = ev[type].announceLead;
      const eff = randInt(rng, 1 + lead, rounds);
      announced.push({ type, effectRound: eff, announceRound: eff - lead });
    }
    const shockRounds = [];
    for (let r = 2; r <= rounds; r++) if (r !== peakEff) shockRounds.push(r);
    const nShocks = Math.min(ev.shocksPerGame, shockRounds.length);
    const chosenRounds = shuffle(rng, shockRounds).slice(0, nShocks).sort((a, b) => a - b);
    const shockTypes = shuffle(rng, ['strike', 'fuel', 'shortage', 'demandSurge']).slice(0, nShocks);
    const shocks = chosenRounds.map((round, i) => {
      const s = { type: shockTypes[i], round };
      if (s.type === 'demandSurge') s.zone = ZONES[randInt(rng, 0, 2)];
      return s;
    });
    let ok = true;
    for (let r = 1; r <= rounds; r++) {
      const has = announced.some((a) => a.announceRound === r || a.effectRound === r) || shocks.some((s) => s.round === r);
      if (!has) { ok = false; break; }
    }
    if (ok) return { announced, shocks };
  }
  throw new Error('Keine gültige Ereignisfolge gefunden');
}

// Was die Spielenden zu Beginn von Runde r wissen (Schocks dieser Runde noch nicht).
export function knownSituation(state, r = state.round) {
  const { announced, shocks } = state.events;
  return {
    announcements: announced.filter((a) => a.announceRound <= r),
    pastShocks: shocks.filter((s) => s.round < r),
    active: activeEffects(state, r, false)
  };
}

export function activeEffects(state, r, includeShockOfRound = true) {
  const cfg = state.config;
  const { announced, shocks } = state.events;
  const eff = (type) => announced.find((a) => a.type === type);
  const visibleShocks = shocks.filter((s) => (includeShockOfRound ? s.round <= r : s.round < r));
  const zez = eff('zez');
  const peak = eff('peak');
  const co2 = eff('co2tax');
  const boom = eff('boxBoom');
  const strike = visibleShocks.find((s) => s.type === 'strike' && r >= s.round && r < s.round + cfg.events.strike.duration);
  const fuel = visibleShocks.find((s) => s.type === 'fuel' && r >= s.round && r < s.round + cfg.events.fuel.duration);
  const shortage = visibleShocks.find((s) => s.type === 'shortage' && r >= s.round);
  const surge = visibleShocks.find((s) => s.type === 'demandSurge' && r >= s.round && r < s.round + cfg.events.demandSurge.duration);
  return {
    zez: !!zez && r >= zez.effectRound,
    peak: !!peak && r === peak.effectRound,
    co2tax: !!co2 && r >= co2.effectRound,
    boxBoom: !!boom && r >= boom.effectRound,
    strike: !!strike,
    fuel: !!fuel,
    shortage: !!shortage,
    surgeZone: surge ? surge.zone : null
  };
}

// ---------- Spiel anlegen ----------
export const TEAM_NAMES = ['Alpenkurier', 'Paketfalke', 'Kurierwerk', 'Talexpress', 'Nordlicht Logistik'];

export function createGame({ config, seed, teamNames, rounds }) {
  const R = rounds || config.rounds;
  const map = buildMap();
  const teams = teamNames.map((name, idx) => {
    const team = {
      idx, name, nextId: 1, elements: [],
      service: { stadt: 'standard', agglo: 'standard', land: 'standard' },
      post: null, crowd: [], reports: [], actionsLog: []
    };
    for (const v of config.startNetwork.vans) {
      const field = v.field || map.active.find((f) => f.region === v.region && f.id.endsWith('1')).id;
      for (let i = 0; i < v.count; i++) team.elements.push({ id: `e${team.nextId++}`, kind: 'van', drive: 'diesel', field, activeFrom: 1, removeFrom: null });
    }
    return team;
  });
  const state = {
    version: config.version, config, seed, rounds: R, round: 1, finished: false,
    events: generateEvents(seed, config, R),
    teams, wage: 1.0, wageHistory: [1.0], baseDrivers: 0, revealedShocks: []
  };
  state.baseDrivers = teams.reduce((s, t) => s + teamDrivers(state, t, 1), 0);
  return state;
}

// ---------- Hilfen ----------
export function isActive(el, r) {
  return el.activeFrom <= r && (el.removeFrom == null || el.removeFrom > r);
}
function isPresent(el, r) { // aktiv oder im Bau, nicht abgebaut
  return el.removeFrom == null || el.removeFrom > r;
}
export function teamDrivers(state, team, r) {
  const E = state.config.elements;
  let d = 0;
  for (const el of team.elements) {
    if (!isActive(el, r)) continue;
    if (el.kind === 'van') d += E.vanDiesel.drivers;
    if (el.kind === 'hub') d += E.hub.drivers;
  }
  return d;
}
export function zoneOfField(fieldId) {
  return buildMap().byId[fieldId].zone;
}
function buildable(fieldId) {
  const f = buildMap().byId[fieldId];
  return !!f && ['stadt', 'agglo', 'land'].includes(f.zone);
}

// ---------- Aktionen ----------
// Typen: vans {field,count,drive} · convert {field} · hub {field} · boxes {area} · post · crowd {field}
//        service {zone,policy} · remove {ids:[...]} (Element-IDs oder 'post')
export function validateAction(state, teamIdx, action, pending = []) {
  const r = state.round;
  const team = state.teams[teamIdx];
  const last = r >= state.rounds;
  const sameTypeEarlier = (pred) => pending.some(pred);
  switch (action.type) {
    case 'vans': {
      if (!buildable(action.field)) return err('field');
      if (!(action.count >= 1 && action.count <= 3)) return err('count');
      if (!['diesel', 'e'].includes(action.drive)) return err('drive');
      return ok();
    }
    case 'convert': {
      const n = team.elements.filter((e) => e.kind === 'van' && e.drive === 'diesel' && e.field === action.field && isPresent(e, r)).length;
      if (!n) return err('noDiesel');
      if (sameTypeEarlier((p) => p.type === 'convert' && p.field === action.field)) return err('duplicate');
      return ok();
    }
    case 'hub': {
      if (last) return err('lastRound');
      if (!buildable(action.field) || !state.config.elements.hub.zones.includes(zoneOfField(action.field))) return err('field');
      const exists = team.elements.some((e) => e.kind === 'hub' && e.field === action.field && isPresent(e, r));
      if (exists || sameTypeEarlier((p) => p.type === 'hub' && p.field === action.field)) return err('exists');
      return ok();
    }
    case 'boxes': {
      if (last) return err('lastRound');
      if (!AREAS.includes(action.area)) return err('area');
      const fresh = areaFields(action.area).filter((f) => !team.elements.some((e) => e.kind === 'box' && e.field === f.id && isPresent(e, r)));
      if (!fresh.length || sameTypeEarlier((p) => p.type === 'boxes' && p.area === action.area)) return err('exists');
      return ok();
    }
    case 'post': {
      if ((team.post && isPresent(team.post, r)) || sameTypeEarlier((p) => p.type === 'post')) return err('exists');
      return ok();
    }
    case 'crowd': {
      if (!buildable(action.field)) return err('field');
      return ok();
    }
    case 'service': {
      if (!ZONES.includes(action.zone) || !['standard', 'window'].includes(action.policy)) return err('policy');
      if (team.service[action.zone] === action.policy) return err('same');
      if (sameTypeEarlier((p) => p.type === 'service' && p.zone === action.zone)) return err('duplicate');
      return ok();
    }
    case 'remove': {
      if (!Array.isArray(action.ids) || !action.ids.length) return err('empty');
      for (const id of action.ids) {
        if (id === 'post') { if (!team.post || !isPresent(team.post, r)) return err('unknown'); continue; }
        const el = team.elements.find((e) => e.id === id);
        if (!el || !isPresent(el, r)) return err('unknown');
      }
      return ok();
    }
    default:
      return err('type');
  }
  function ok() { return { ok: true }; }
  function err(code) { return { ok: false, error: code }; }
}

function applyAction(state, team, action) {
  const r = state.round;
  const E = state.config.elements;
  const newEl = (props) => team.elements.push({ id: `e${team.nextId++}`, removeFrom: null, ...props });
  switch (action.type) {
    case 'vans':
      for (let i = 0; i < action.count; i++) newEl({ kind: 'van', drive: action.drive, field: action.field, activeFrom: r });
      break;
    case 'convert':
      for (const e of team.elements) if (e.kind === 'van' && e.drive === 'diesel' && e.field === action.field && isPresent(e, r)) e.drive = 'e';
      break;
    case 'hub':
      newEl({ kind: 'hub', field: action.field, activeFrom: r + E.hub.buildDelay });
      break;
    case 'boxes':
      for (const f of areaFields(action.area)) {
        if (!team.elements.some((e) => e.kind === 'box' && e.field === f.id && isPresent(e, r))) newEl({ kind: 'box', field: f.id, activeFrom: r + E.box.buildDelay });
      }
      break;
    case 'post':
      team.post = { activeFrom: r, removeFrom: null };
      break;
    case 'crowd':
      team.crowd.push({ field: action.field, round: r });
      break;
    case 'service':
      team.service[action.zone] = action.policy;
      break;
    case 'remove':
      for (const id of action.ids) {
        if (id === 'post') {
          if (team.post.activeFrom > r) team.post = null; else team.post.removeFrom = r + 1;
          continue;
        }
        const el = team.elements.find((e) => e.id === id);
        if (el.activeFrom > r) team.elements = team.elements.filter((e) => e !== el); // noch im Bau: storniert
        else el.removeFrom = r + 1;
      }
      break;
  }
}

// ---------- Runde auswerten ----------
export function resolveRound(prev, actionsByTeam) {
  const state = structuredClone(prev);
  const r = state.round;
  const cfg = state.config;
  // 1. Aktionen anwenden (ungültige werden ignoriert und protokolliert)
  state.teams.forEach((team, i) => {
    const acts = (actionsByTeam[i] || []).slice(0, cfg.actionsPerRound);
    const accepted = [];
    for (const a of acts) {
      const v = validateAction(state, i, a, accepted);
      if (v.ok) { applyAction(state, team, a); accepted.push(a); }
    }
    team.actionsLog.push({ round: r, actions: accepted });
  });
  // 2. Schock dieser Runde aufdecken
  const shock = state.events.shocks.find((s) => s.round === r) || null;
  if (shock) state.revealedShocks.push(shock);
  const fx = activeEffects(state, r, true);
  // 3. Zustellung pro Team
  for (const team of state.teams) team.reports.push(simulateTeam(state, team, r, fx));
  // 4. Arbeitsmarkt: Lohnindex für die nächste Runde
  const drivers = state.teams.reduce((s, t) => s + teamDrivers(state, t, r), 0);
  const load = state.baseDrivers > 0 ? drivers / state.baseDrivers : 1;
  let growth = cfg.labour.baseWageGrowth + cfg.labour.scarcitySensitivity * Math.max(0, load - 1);
  if (shock && shock.type === 'shortage') growth += cfg.events.shortage.wageJump;
  for (const team of state.teams) {
    const rep = team.reports[team.reports.length - 1];
    rep.market = { drivers, baseDrivers: state.baseDrivers, load, wage: state.wage, nextWage: state.wage * (1 + growth), growth };
  }
  state.wage = state.wage * (1 + growth);
  state.wageHistory.push(state.wage);
  state.lastShock = shock;
  // 5. Nächste Runde
  if (r >= state.rounds) state.finished = true;
  else state.round = r + 1;
  return state;
}

function simulateTeam(state, team, r, fx) {
  const cfg = state.config;
  const E = cfg.elements;
  const Z = cfg.zones;
  const map = buildMap();
  const capFactorDriver = (fx.strike ? cfg.events.strike.capacityFactor : 1) * (fx.shortage ? cfg.events.shortage.capacityFactor : 1);
  const acceptance = fx.boxBoom ? cfg.events.boxBoom.acceptance : E.box.acceptance;
  const fuelFactor = fx.fuel ? cfg.events.fuel.dieselVarFactor : 1;

  const zoneAcc = () => ({ parcels: 0, onTime: 0, failed: 0, emergency: 0, postLate: 0, fixed: 0, variable: 0, co2: 0, cost: 0 });
  const zones = { stadt: zoneAcc(), agglo: zoneAcc(), land: zoneAcc() };
  const breakdown = { personnel: 0, leasing: 0, energy: 0, resupply: 0, secondAttempts: 0, emergency: 0, post: 0, crowd: 0, co2tax: 0 };
  let zezBlocked = false;

  // Aktive Zusteller
  const active = team.elements.filter((e) => isActive(e, r));
  const vehicles = [];
  for (const el of active) {
    if (el.kind === 'van') {
      const p = el.drive === 'diesel' ? E.vanDiesel : E.vanE;
      vehicles.push({ el, p, kind: el.drive === 'diesel' ? 'vanDiesel' : 'vanE', cap: p.capacity * capFactorDriver, capTotal: p.capacity * capFactorDriver, used: 0,
        unitVar: p.varCost * (el.drive === 'diesel' ? fuelFactor : 1), reach: new Set(fieldsInRange(el.field, p.range).map((f) => f.id)) });
    } else if (el.kind === 'hub') {
      vehicles.push({ el, p: E.hub, kind: 'hub', cap: E.hub.capacity * capFactorDriver, capTotal: E.hub.capacity * capFactorDriver, used: 0,
        unitVar: E.hub.varCost + E.hub.resupplyCost,
        reach: new Set(fieldsInRange(el.field, E.hub.range).filter((f) => E.hub.zones.includes(f.zone)).map((f) => f.id)) });
    }
  }
  // Lokale Zusteller zuerst (kleinste Reichweite), flexible zuletzt; bei Gleichstand die günstigsten Kosten pro Paket.
  // So bleiben flexible Fahrzeuge für Felder ohne Alternative frei.
  vehicles.sort((a, b) => a.reach.size - b.reach.size || a.unitVar - b.unitVar || a.el.id.localeCompare(b.el.id, 'en', { numeric: true }));
  const boxes = new Set(active.filter((e) => e.kind === 'box').map((e) => e.field));
  const crowds = team.crowd.filter((c) => c.round === r).map((c) => ({ ...c, cap: E.crowd.capacity, used: 0, reach: new Set(fieldsInRange(c.field, E.crowd.range).map((f) => f.id)) }));
  const postActive = team.post && isActive(team.post, r);
  const postCap = {};
  if (postActive) {
    for (const reg of REGION_IDS) {
      const base = map.active.filter((f) => f.region === reg).length * Z.land.demand;
      postCap[reg] = base * E.post.capacityShare * (fx.strike ? cfg.events.strike.capacityFactor : 1);
    }
  }

  const demandOf = (f) => Z[f.zone].demand * (fx.peak ? cfg.events.peak.demandFactor : 1) * (fx.surgeZone === f.zone ? cfg.events.demandSurge.factor : 1);
  const canServe = (v, f) => v.reach.has(f.id) && !(fx.zez && v.kind === 'vanDiesel' && f.zone === 'stadt');
  const failRate = (f) => Z[f.zone].failRate * (team.service[f.zone] === 'window' ? cfg.timeWindowFailFactor : 1);
  const twFactor = (f) => (team.service[f.zone] === 'window' ? 1 / (1 - Z[f.zone].timeWindowCapacityLoss) : 1);

  // Felder mit den wenigsten Optionen zuerst
  const order = map.active.map((f) => {
    let n = 0;
    if (boxes.has(f.id)) n++;
    if (postActive && f.zone === 'land') n++;
    for (const v of vehicles) if (canServe(v, f)) n++;
    for (const c of crowds) if (c.reach.has(f.id)) n++;
    return { f, n };
  }).sort((a, b) => a.n - b.n || map.active.indexOf(a.f) - map.active.indexOf(b.f));

  const perField = {};
  for (const { f } of order) {
    const z = zones[f.zone];
    const dist = Z[f.zone].distance;
    const D = demandOf(f);
    let R = D;
    z.parcels += D;
    const rec = { demand: D, by: [] };
    perField[f.id] = rec;
    const book = (src, n) => { rec.by.push({ src, n }); };
    // a) Box
    if (boxes.has(f.id) && R > 0) {
      const n = Math.min(R, D * acceptance);
      R -= n;
      const fails = n * E.box.failRate;
      z.onTime += n - fails; z.failed += fails;
      const energy = n * E.box.varCost; const res = n * E.box.resupplyCost;
      z.variable += energy + res + fails * E.box.varCost;
      breakdown.energy += energy; breakdown.resupply += res; breakdown.secondAttempts += fails * E.box.varCost;
      z.co2 += n * E.box.resupplyCo2;
      book('box', n);
    }
    // b) Eigene Fahrzeuge
    if (fx.zez && f.zone === 'stadt' && vehicles.some((v) => v.kind === 'vanDiesel' && v.reach.has(f.id))) zezBlocked = true;
    for (const v of vehicles) {
      if (R <= 1e-9) break;
      if (!canServe(v, f) || v.cap <= 1e-9) continue;
      const p = failRate(f);
      const unitCap = v.p.weight[f.zone] * (1 + p) * twFactor(f);
      const n = Math.min(R, v.cap / unitCap);
      if (n <= 1e-9) continue;
      v.cap -= n * unitCap; v.used += n * unitCap;
      R -= n;
      const fails = n * p;
      z.onTime += n - fails; z.failed += fails;
      const varPer = v.kind === 'hub' ? v.p.varCost * dist : v.unitVar * dist;
      const energy = n * varPer;
      const res = v.kind === 'hub' ? n * v.p.resupplyCost : 0;
      const second = fails * varPer;
      z.variable += energy + res + second;
      breakdown.energy += energy; breakdown.resupply += res; breakdown.secondAttempts += second;
      const co2 = (n + fails) * v.p.co2 * dist + (v.kind === 'hub' ? n * v.p.resupplyCo2 : 0);
      z.co2 += co2;
      book(v.el.id, n);
    }
    // c) Post (nur Restmenge)
    if (postActive && f.zone === 'land' && R > 1e-9) {
      const n = Math.min(R, postCap[f.region]);
      if (n > 1e-9) {
        postCap[f.region] -= n; R -= n;
        const fails = n * E.post.failRate;
        z.onTime += n * E.post.onTimeRate; z.failed += fails; z.postLate += n * (1 - E.post.onTimeRate);
        const c = n * E.post.varCost;
        z.variable += c; breakdown.post += c;
        z.co2 += n * E.post.co2;
        book('post', n);
      }
    }
    // d) Crowd
    for (const c of crowds) {
      if (R <= 1e-9) break;
      if (!c.reach.has(f.id)) continue;
      const unitCap = 1 + E.crowd.failRate;
      const n = Math.min(R, (c.cap - c.used) / unitCap);
      if (n <= 1e-9) continue;
      c.used += n * unitCap; R -= n;
      const fails = n * E.crowd.failRate;
      z.onTime += n - fails; z.failed += fails;
      const cost = (n + fails) * E.crowd.varCost;
      z.variable += cost; breakdown.crowd += cost;
      z.co2 += (n + fails) * E.crowd.co2 * dist;
      book('crowd', n);
    }
    // e) Notfall-Subunternehmer
    if (R > 1e-9) {
      const n = R;
      const fails = n * E.emergency.failRate;
      z.failed += fails; z.emergency += n;
      const cost = n * (E.emergency.varCost + (fx.fuel ? cfg.events.fuel.emergencyExtra : 0));
      z.variable += cost; breakdown.emergency += cost;
      z.co2 += n * E.emergency.co2 * dist;
      book('emergency', n);
    }
  }

  // Fixkosten nach Standortprinzip
  for (const el of active) {
    const zone = zoneOfField(el.field);
    let personnel = 0, leasing = 0;
    if (el.kind === 'van') { const p = el.drive === 'diesel' ? E.vanDiesel : E.vanE; personnel = p.driverCost * p.drivers * state.wage; leasing = p.leasing; }
    if (el.kind === 'hub') { personnel = E.hub.driverCost * E.hub.drivers * state.wage; leasing = E.hub.leasing; }
    if (el.kind === 'box') { leasing = E.box.leasing; }
    zones[zone].fixed += personnel + leasing;
    breakdown.personnel += personnel; breakdown.leasing += leasing;
  }
  if (postActive) {
    const fee = E.post.feePerRegion * REGION_IDS.length;
    zones.land.fixed += fee; breakdown.post += fee;
  }
  // CO2-Abgabe
  if (fx.co2tax) {
    for (const zk of ZONES) {
      const tax = (zones[zk].co2 / 1000) * cfg.events.co2tax.chfPerKg;
      zones[zk].variable += tax; breakdown.co2tax += tax;
    }
  }
  for (const zk of ZONES) zones[zk].cost = zones[zk].fixed + zones[zk].variable;

  const totals = sumZones(zones);
  const utilization = [
    ...vehicles.map((v) => ({ id: v.el.id, kind: v.kind, field: v.el.field, used: v.used, capacity: v.capTotal })),
    ...crowds.map((c) => ({ id: `crowd-${c.field}`, kind: 'crowd', field: c.field, used: c.used, capacity: c.cap }))
  ];
  const report = {
    round: r, zones, totals, breakdown, utilization, perField,
    service: { ...team.service }, effects: fx, zezBlocked,
    drivers: teamDrivers(state, team, r), wage: state.wage
  };
  report.kpis = kpisOf(totals);
  report.zoneKpis = Object.fromEntries(ZONES.map((zk) => [zk, kpisOf(zones[zk])]));
  report.messages = buildMessages(state, report);
  return report;
}

function sumZones(zones) {
  const t = { parcels: 0, onTime: 0, failed: 0, emergency: 0, postLate: 0, fixed: 0, variable: 0, co2: 0, cost: 0 };
  for (const zk of ZONES) for (const k of Object.keys(t)) t[k] += zones[zk][k];
  return t;
}

export function kpisOf(t) {
  const n = t.parcels || 1;
  return { costPerParcel: t.cost / n, onTime: t.onTime / n, co2PerParcel: t.co2 / n, failRate: t.failed / n };
}

function buildMessages(state, rep) {
  const msgs = [];
  const std = state.config.standards;
  for (const zk of ZONES) {
    const z = rep.zones[zk];
    if (z.emergency / z.parcels > 0.05) {
      msgs.push({ sev: 3 + z.emergency / z.parcels, code: zk === 'stadt' && rep.zezBlocked ? 'emergencyZez' : 'emergency', zone: zk, n: Math.round(z.emergency) });
    }
    if (rep.zoneKpis[zk].onTime < std.onTimeZone) msgs.push({ sev: 2.5, code: 'zoneBelowStandard', zone: zk, value: rep.zoneKpis[zk].onTime });
    if (rep.zoneKpis[zk].failRate > 0.08) msgs.push({ sev: 1.5, code: 'highFail', zone: zk, value: rep.zoneKpis[zk].failRate });
  }
  const costs = ZONES.map((zk) => ({ zk, c: rep.zoneKpis[zk].costPerParcel })).sort((a, b) => b.c - a.c);
  if (costs[0].c > 1.6 * rep.kpis.costPerParcel) msgs.push({ sev: 1.2, code: 'expensiveZone', zone: costs[0].zk, value: costs[0].c });
  if (rep.effects.co2tax && rep.breakdown.co2tax > 0) msgs.push({ sev: 1, code: 'co2tax', value: rep.breakdown.co2tax });
  if (rep.effects.strike) msgs.push({ sev: 2, code: 'strike' });
  if (rep.effects.shortage) msgs.push({ sev: 1.4, code: 'shortage' });
  const idle = rep.utilization.filter((u) => u.kind !== 'crowd' && u.capacity > 0 && u.used / u.capacity < 0.4);
  if (idle.length) msgs.push({ sev: 1.1, code: 'idle', n: idle.length });
  if (!msgs.length) msgs.push({ sev: 0, code: 'allGood' });
  return msgs.sort((a, b) => b.sev - a.sev).slice(0, 3);
}

// ---------- Kumulierte Werte und Wertung ----------
export function cumulative(team) {
  const zones = { stadt: null, agglo: null, land: null };
  for (const zk of ZONES) {
    const acc = { parcels: 0, onTime: 0, failed: 0, emergency: 0, postLate: 0, fixed: 0, variable: 0, co2: 0, cost: 0 };
    for (const rep of team.reports) for (const k of Object.keys(acc)) acc[k] += rep.zones[zk][k];
    zones[zk] = acc;
  }
  const totals = sumZones(zones);
  return { zones, totals, kpis: kpisOf(totals), zoneKpis: Object.fromEntries(ZONES.map((zk) => [zk, kpisOf(zones[zk])])) };
}

export function standardsOf(state, cum) {
  const std = state.config.standards;
  const zoneOk = Object.fromEntries(ZONES.map((zk) => [zk, cum.zoneKpis[zk].onTime >= std.onTimeZone]));
  const res = {
    onTimeNational: cum.kpis.onTime >= std.onTimeNational,
    zones: zoneOk,
    cost: cum.kpis.costPerParcel <= state.config.tariffPerParcel
  };
  res.all = res.onTimeNational && res.cost && Object.values(zoneOk).every(Boolean);
  return res;
}

export function scoreGame(state) {
  const teams = state.teams.map((t) => {
    const cum = cumulative(t);
    const lastMileShare = cum.kpis.costPerParcel / (cum.kpis.costPerParcel + state.config.upstreamCostPerParcel);
    const margin = Object.fromEntries(ZONES.map((zk) => [zk, state.config.tariffPerParcel * cum.zones[zk].parcels - cum.zones[zk].cost]));
    return { idx: t.idx, name: t.name, cum, standards: standardsOf(state, cum), points: 0, kpiPoints: {}, lastMileShare, margin };
  });
  const n = teams.length;
  for (const k of KPI_KEYS) {
    const sorted = [...teams].sort((a, b) => (LOWER_IS_BETTER[k] ? a.cum.kpis[k] - b.cum.kpis[k] : b.cum.kpis[k] - a.cum.kpis[k]));
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && Math.abs(sorted[j + 1].cum.kpis[k] - sorted[i].cum.kpis[k]) < 1e-9) j++;
      let pts = 0;
      for (let p = i; p <= j; p++) pts += n - 1 - p;
      pts /= j - i + 1;
      for (let p = i; p <= j; p++) { sorted[p].kpiPoints[k] = pts; sorted[p].points += pts; }
      i = j + 1;
    }
  }
  const ranking = [...teams].sort((a, b) => (b.standards.all - a.standards.all) || (b.points - a.points) || (a.cum.kpis.costPerParcel - b.cum.kpis.costPerParcel));
  const qualified = ranking.filter((t) => t.standards.all);
  const winner = qualified.length ? qualified[0].idx : null;
  return { teams, ranking, winner };
}

// Komplette Partie aus gespeicherten Aktionen nachrechnen (für Verlauf und Statistik)
export function replay(config, meta, actionsByRound) {
  let state = createGame({ config, seed: meta.seed, teamNames: meta.teamNames, rounds: meta.rounds });
  const states = [state];
  for (let r = 1; r <= meta.rounds; r++) {
    const acts = actionsByRound[r];
    if (!acts) break;
    state = resolveRound(state, acts);
    states.push(state);
  }
  return states;
}

export { hexDistance };
