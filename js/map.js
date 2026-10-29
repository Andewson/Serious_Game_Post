// Sechseck-Karte einer stilisierten Schweiz (axiale Koordinaten, Spitze oben).
// Stadt = Zentrum + 1. Ring, Agglo = 2. Ring (ohne See), Land = drei Regionen.

export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function ring(radius) {
  if (radius === 0) return [[0, 0]];
  const cells = [];
  let q = DIRS[4][0] * radius;
  let r = DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      cells.push([q, r]);
      q += DIRS[side][0];
      r += DIRS[side][1];
    }
  }
  return cells;
}

export const REGIONS = {
  nord: { center: [2, -4], prefix: 'N' },
  ost: { center: [4, -1], prefix: 'O' },
  west: { center: [-4, 3], prefix: 'W' }
};

const LAKE = [[-2, 0], [-3, 1]];
const EXTRA_MOUNTAINS = [[3, -3], [1, 2], [-3, 0], [0, 3]];

let cached = null;

export function buildMap() {
  if (cached) return cached;
  const fields = [];
  const key = (q, r) => `${q},${r}`;
  const used = new Set();
  const add = (f) => { fields.push(f); used.add(key(f.q, f.r)); };
  const isLake = (q, r) => LAKE.some(([a, b]) => a === q && b === r);

  // Stadt
  let s = 1;
  for (const [q, r] of [...ring(0), ...ring(1)]) add({ id: `S${s++}`, q, r, zone: 'stadt' });
  // Agglo
  let a = 1;
  for (const [q, r] of ring(2)) {
    if (isLake(q, r)) add({ id: `L${key(q, r)}`, q, r, zone: 'see' });
    else add({ id: `A${a++}`, q, r, zone: 'agglo' });
  }
  // Land-Regionen
  for (const [region, def] of Object.entries(REGIONS)) {
    const [cq, cr] = def.center;
    let n = 1;
    add({ id: `${def.prefix}${n++}`, q: cq, r: cr, zone: 'land', region });
    const neigh = DIRS.map(([dq, dr]) => [cq + dq, cr + dr]);
    for (const [q, r] of neigh) {
      const d = hexDistance({ q, r }, { q: 0, r: 0 });
      if (used.has(key(q, r))) continue;
      if (d <= 4) add({ id: `${def.prefix}${n++}`, q, r, zone: 'land', region });
      else add({ id: `B${key(q, r)}`, q, r, zone: 'berg' });
    }
  }
  for (const [q, r] of [...LAKE, ...EXTRA_MOUNTAINS]) {
    if (used.has(key(q, r))) continue;
    add({ id: isLake(q, r) ? `L${key(q, r)}` : `B${key(q, r)}`, q, r, zone: isLake(q, r) ? 'see' : 'berg' });
  }
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const active = fields.filter((f) => ['stadt', 'agglo', 'land'].includes(f.zone));
  cached = { fields, byId, active };
  return cached;
}

export function fieldsInRange(fieldId, range) {
  const { byId, active } = buildMap();
  const origin = byId[fieldId];
  return active.filter((f) => hexDistance(f, origin) <= range);
}

export function areaFields(area) {
  const { active } = buildMap();
  if (area === 'stadt' || area === 'agglo') return active.filter((f) => f.zone === area);
  return active.filter((f) => f.region === area);
}

export const AREAS = ['stadt', 'agglo', 'nord', 'ost', 'west'];
