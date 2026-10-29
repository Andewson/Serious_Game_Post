// Bewertung mit 1–5 Symbolen: Münzen (Kosten), Blätter (CO₂), Uhren (Pünktlichkeit),
// Haustüren (Zustellung beim ersten Versuch), Sterne (Zuverlässigkeit einer Option).
import { h, s } from './dom.js';
import { t } from '../i18n.js';

export const KPI_SYMBOL = { costPerParcel: 'coin', onTime: 'clock', co2PerParcel: 'leaf', failRate: 'door' };
export const OPTION_SYMBOL = { cost: 'coin', co2: 'leaf', reliability: 'star' };
export const RATING_FILL = { 1: '#d64545', 2: '#ef8a3c', 3: '#f2c94c', 4: '#9ccc65', 5: '#3f9b5a' };
const COLOR = { coin: '#d9a21b', leaf: '#3f9b5a', clock: '#2f6fd0', door: '#1f7a80', star: '#2f6fd0' };
const EMPTY = '#e2ddd3';

function shape(kind, fill) {
  switch (kind) {
    case 'coin': return [s('circle', { cx: 10, cy: 10, r: 8.5, fill }), s('circle', { cx: 10, cy: 10, r: 5.2, fill: 'none', stroke: '#fff', 'stroke-width': 1.6, opacity: 0.75 })];
    case 'leaf': return [s('path', { d: 'M16.5 3.5C8 3.5 3.5 8 3.5 14.5c0 1 .2 1.6.5 2.1C5 10.5 9 8 12.5 7c-3.3 1.8-6.2 4.6-7.8 9.4.7.2 1.4.3 2.2.3 6.4 0 9.6-5.4 9.6-13.2z', fill })];
    case 'clock': return [s('circle', { cx: 10, cy: 10, r: 8.5, fill }), s('path', { d: 'M10 5v5l3.2 2.2', stroke: '#fff', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' })];
    case 'door': return [s('path', { d: 'M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', fill }), s('rect', { x: 8, y: 11, width: 4, height: 7, rx: 0.6, fill: '#fff', opacity: 0.85 })];
    default: return [s('path', { d: 'M10 2.2l2.4 5 5.4.6-4 3.7 1.1 5.4L10 14.2l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z', fill })];
  }
}

export function symbol(kind, filled = true, size = 16) {
  return s('svg', { viewBox: '0 0 20 20', width: size, height: size, class: 'sym', 'aria-hidden': 'true' }, shape(kind, filled ? COLOR[kind] : EMPTY));
}

// Reihe aus 5 Symbolen; value 1–5
export function rating(kind, value, size = 16, label = null) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  return h('span', { class: 'rating', role: 'img', 'aria-label': `${label ? label + ': ' : ''}${v} ${t('of')} 5` },
    Array.from({ length: 5 }, (_, i) => symbol(kind, i < v, size)));
}

export function ratingWord(v) { return t('rate_' + Math.max(1, Math.min(5, v))); }
