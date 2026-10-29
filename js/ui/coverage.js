// «Wer stellt zu?» – pro Zone ein Balken über die Nachfrage, aufgeteilt nach Quelle.
// Eine Farbfamilie (eigene Fahrzeuge in der Datenfarbe, Boxen und Post heller), Notfall in Rot.
import { h } from './dom.js';
import { t, fmtInt } from '../i18n.js';
import { ZONES } from '../engine.js';
import { coverageOf } from '../forecast.js';

const SOURCES = ['own', 'box', 'post', 'crowd', 'emergency'];

export function coverageBlock(report) {
  const rows = ZONES.map((z) => {
    const c = coverageOf(report, z);
    const D = c.demand || 1;
    const parts = SOURCES.filter((k) => c[k] > 0.5).map((k) => h('span', { class: `c-${k}`, style: { width: `${(c[k] / D) * 100}%` }, title: `${t('src_' + k)}: ${fmtInt(c[k])}` }));
    return h('div', { class: 'zr' },
      h('div', { class: 'top' }, h('span', {}, t('zone_' + z)), h('span', { class: 'fig' }, t('coverFig', { n: fmtInt(c.demand) }))),
      h('div', { class: 'bar', role: 'img', 'aria-label': SOURCES.filter((k) => c[k] > 0.5).map((k) => `${t('src_' + k)} ${fmtInt(c[k])}`).join(', ') }, parts),
      c.emergency > 0.5 ? h('div', { class: 'em' }, t('emergencyShare', { n: fmtInt(c.emergency) })) : null);
  });
  const used = new Set();
  for (const z of ZONES) { const c = coverageOf(report, z); for (const k of SOURCES) if (c[k] > 0.5) used.add(k); }
  return h('div', {},
    h('div', { class: 'cover' }, rows),
    h('div', { class: 'keyrow' }, SOURCES.filter((k) => used.has(k)).map((k) => h('span', {}, h('i', { class: `c-${k}` }), t('src_' + k)))));
}
