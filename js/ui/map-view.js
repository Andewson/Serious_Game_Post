// SVG-Karte mit Zonen, Null-Emissions-Zone, eigenen Elementen und Reichweiten-Vorschau.
import { s, clear } from './dom.js';
import { buildMap, fieldsInRange } from '../map.js';
import { t } from '../i18n.js';

const SIZE = 30;
const SQ3 = Math.sqrt(3);
const ZONE_FILL = { stadt: '#ddd6c8', agglo: '#e2ecd3', land: '#bcd9a4', see: '#b9d7ec', berg: '#d3ccc1' };
const HUE = '#0f5e63';
const INK = '#141414';
const NEG = '#c4242a';

export function center(f) {
  return { x: SIZE * SQ3 * (f.q + f.r / 2), y: SIZE * 1.5 * f.r };
}
function corners(c, size = SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(c.x + size * Math.cos(a)).toFixed(1)},${(c.y + size * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function defs() {
  return s('defs', {},
    s('symbol', { id: 'i-van', viewBox: '0 0 24 16' },
      s('rect', { x: 1, y: 3, width: 14, height: 9, rx: 1.5 }),
      s('path', { d: 'M15 6h4l3 3v3h-7z' }),
      s('circle', { cx: 6, cy: 13.5, r: 2.2, fill: '#fff' }), s('circle', { cx: 18, cy: 13.5, r: 2.2, fill: '#fff' })),
    s('symbol', { id: 'i-bike', viewBox: '0 0 24 16' },
      s('circle', { cx: 5, cy: 11, r: 4, fill: 'none', 'stroke-width': 2, stroke: 'currentColor' }),
      s('circle', { cx: 19, cy: 11, r: 4, fill: 'none', 'stroke-width': 2, stroke: 'currentColor' }),
      s('path', { d: 'M5 11 L10 4 H15 L19 11 M10 4 L13 11', fill: 'none', 'stroke-width': 2, stroke: 'currentColor' }),
      s('rect', { x: 8, y: 1, width: 8, height: 4, rx: 1 })),
    s('symbol', { id: 'i-box', viewBox: '0 0 16 16' },
      s('rect', { x: 1, y: 1, width: 14, height: 14, rx: 2 }),
      s('path', { d: 'M1 6h14M1 11h14M8 1v14', stroke: '#fff', 'stroke-width': 1.2 })),
    s('symbol', { id: 'i-crowd', viewBox: '0 0 16 16' },
      s('circle', { cx: 5, cy: 4, r: 2.6 }), s('circle', { cx: 11, cy: 4, r: 2.6 }),
      s('path', { d: 'M0.5 15c0-4 2-6 4.5-6s4.5 2 4.5 6zM6.5 15c0-4 2-6 4.5-6s4.5 2 4.5 6z' })),
    s('symbol', { id: 'i-post', viewBox: '0 0 16 16' },
      s('rect', { x: 1, y: 3, width: 14, height: 10, rx: 2 }),
      s('path', { d: 'M1.5 4l6.5 5 6.5-5', fill: 'none', stroke: '#fff', 'stroke-width': 1.4 }))
  );
}

// opts: { teamIdx, elements, crowd(this round), post, zezState: 'none'|'announced'|'active',
//   selectable: fieldId => bool, selectedField, rangePreview: {range, zones}|null, onSelect,
//   emergency: {fieldId: Anteil Notfall-Pakete} (Prognose), onInspect: fieldId => void, inspected,
//   metric: { fill: {fieldId: Farbe}, text: {fieldId: kurzer Wert}, tip: {fieldId: Text} } – Kennzahl-Ansicht }
export function renderMap(container, opts) {
  clear(container);
  const map = buildMap();
  const pts = map.fields.map(center);
  const minX = Math.min(...pts.map((p) => p.x)) - SIZE - 6;
  const maxX = Math.max(...pts.map((p) => p.x)) + SIZE + 6;
  const minY = Math.min(...pts.map((p) => p.y)) - SIZE - 6;
  const maxY = Math.max(...pts.map((p) => p.y)) + SIZE + 6;
  const svg = s('svg', { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, role: 'img', 'aria-label': 'Karte' }, defs());
  const color = HUE;
  const gHex = s('g');
  const gOver = s('g');
  const gIcons = s('g');
  svg.append(gHex, gOver, gIcons);
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';

  const drawRange = (fieldId) => {
    clear(gOver);
    drawZez();
    if (!opts.rangePreview || !fieldId) return;
    const inRange = fieldsInRange(fieldId, opts.rangePreview.range).filter((f) => !opts.rangePreview.zones || opts.rangePreview.zones.includes(f.zone));
    for (const f of inRange) gOver.append(s('polygon', { points: corners(center(f), SIZE - 3), fill: color, 'fill-opacity': 0.28, class: 'range' }));
  };
  const drawZez = () => {
    if (!opts.zezState || opts.zezState === 'none') return;
    for (const f of map.active.filter((x) => x.zone === 'stadt')) {
      gOver.append(s('polygon', { points: corners(center(f), SIZE - 1.5), class: `zez ${opts.zezState === 'announced' ? 'announced' : ''}` }));
    }
  };

  // gestrichelte Umrisse nur, wenn nicht alle Felder wählbar sind
  const restricted = !!opts.selectable && map.active.some((f) => !opts.selectable(f.id));
  for (const f of map.fields) {
    const c = center(f);
    const isActive = ['stadt', 'agglo', 'land'].includes(f.zone);
    const selectable = isActive && opts.selectable ? opts.selectable(f.id) : false;
    const cls = ['hex'];
    if (selectable) cls.push('clickable');
    if (opts.selectable && !selectable && isActive) cls.push('dim');
    if (opts.selectedField === f.id || opts.inspected === f.id) cls.push('sel');
    else if (selectable && restricted) cls.push('pick');
    const metric = opts.metric && isActive ? opts.metric : null;
    let fill = metric ? metric.fill[f.id] : ZONE_FILL[f.zone];
    const poly = s('polygon', {
      points: corners(c), fill, class: cls.join(' '),
      onclick: selectable ? () => opts.onSelect && opts.onSelect(f.id) : (isActive && !opts.selectable && opts.onInspect ? () => opts.onInspect(f.id) : null),
      onmouseenter: (ev) => {
        if (opts.rangePreview && (selectable || !opts.selectable)) drawRange(f.id);
        if (!isActive) return;
        tooltip.style.display = 'block';
        tooltip.textContent = `${f.id} · ${t('zone_' + f.zone)}${f.region ? ' · ' + t('region_' + f.region) : ''}${metric && metric.tip[f.id] ? ' · ' + metric.tip[f.id] : ''}`;
        moveTip(ev);
      },
      onmousemove: (ev) => moveTip(ev),
      onmouseleave: () => { tooltip.style.display = 'none'; if (opts.rangePreview) drawRange(opts.selectedField); }
    });
    gHex.append(poly);
    if (f.zone === 'berg') gHex.append(s('path', { d: `M${c.x - 12} ${c.y + 8} L${c.x - 3} ${c.y - 8} L${c.x + 2} ${c.y} L${c.x + 6} ${c.y - 5} L${c.x + 13} ${c.y + 8} Z`, fill: '#b3aa9d', class: 'icon' }));
    if (f.zone === 'see') gHex.append(s('path', { d: `M${c.x - 12} ${c.y} q6 -5 12 0 t12 0`, stroke: '#7fb3d9', 'stroke-width': 2, fill: 'none', class: 'icon' }));
    if (isActive) gHex.append(s('text', { x: c.x, y: c.y - SIZE * 0.55, 'text-anchor': 'middle', class: 'flabel' }, f.id));
    if (metric) gHex.append(s('text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', class: 'mval' }, metric.text[f.id]));
    if (!opts.metric && opts.emergency && opts.emergency[f.id] > 0.05) {
      const share = opts.emergency[f.id];
      gHex.append(s('polygon', { points: corners(c, SIZE - 4), fill: NEG, 'fill-opacity': Math.min(0.35, 0.1 + share * 0.3), stroke: NEG, 'stroke-width': share > 0.5 ? 3 : 2, class: 'icon' }));
    }
  }
  drawZez();
  if (opts.selectedField) drawRange(opts.selectedField);

  // Elemente des Teams
  const perField = {};
  const add = (field, key) => { perField[field] = perField[field] || {}; perField[field][key] = (perField[field][key] || 0) + 1; };
  for (const el of opts.elements || []) {
    if (el.kind === 'van') add(el.field, el.drive === 'diesel' ? 'vanDiesel' : 'vanE');
    else add(el.field, el.kind + (el.pending ? 'Pending' : ''));
  }
  for (const c of opts.crowd || []) add(c.field, 'crowd');
  for (const [fieldId, items] of Object.entries(opts.metric ? {} : perField)) {
    const c = center(map.byId[fieldId]);
    const list = Object.entries(items);
    let x = c.x - (list.length * 15) / 2 + 1;
    for (const [key, n] of list) {
      const sym = key.startsWith('van') ? 'i-van' : key.startsWith('hub') ? 'i-bike' : key.startsWith('box') ? 'i-box' : 'i-crowd';
      const fillC = key === 'vanE' ? '#2e7d32' : key.endsWith('Pending') ? '#9a9a9a' : INK;
      gIcons.append(s('use', { href: `#${sym}`, x, y: c.y - 4, width: 14, height: 11, fill: fillC, color: fillC, class: 'icon', opacity: key.endsWith('Pending') ? 0.7 : 1 }));
      if (n > 1) gIcons.append(s('text', { x: x + 7, y: c.y + 15, 'text-anchor': 'middle', class: 'flabel', style: 'fill:#141414;font-size:9px' }, `×${n}`));
      x += 15;
    }
  }
  if (opts.post && !opts.metric) {
    for (const reg of ['nord', 'ost', 'west']) {
      const f = map.active.find((x) => x.region === reg && x.id.endsWith('1'));
      const c = center(f);
      gIcons.append(s('use', { href: '#i-post', x: c.x + 8, y: c.y + 6, width: 13, height: 13, fill: opts.post === 'pending' ? '#9a9a9a' : INK, class: 'icon' }));
    }
  }

  function moveTip(ev) {
    const r = container.getBoundingClientRect();
    tooltip.style.left = `${ev.clientX - r.left + 12}px`;
    tooltip.style.top = `${ev.clientY - r.top + 12}px`;
  }
  container.append(svg, tooltip);
  return svg;
}
