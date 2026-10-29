// Teststrategien für das Balancing. Jede Strategie liefert pro Runde bis zu 2 Aktionen.
import { knownSituation, validateAction } from '../js/engine.js';

const ann = (s, type) => knownSituation(s).announcements.find((a) => a.type === type);
const zezSoon = (s) => { const a = ann(s, 'zez'); return a && a.effectRound <= s.round + 1; };
const peakNow = (s) => { const a = ann(s, 'peak'); return a && a.effectRound === s.round; };
const present = (s, e) => e.removeFrom == null || e.removeFrom > s.round;
const T = (s, i) => s.teams[i];
const vanIds = (s, i, pred) => T(s, i).elements.filter((e) => e.kind === 'van' && present(s, e) && pred(e)).map((e) => e.id);
const ruralVanIds = (s, i) => vanIds(s, i, (e) => /^[NOW]/.test(e.field));
const hasPost = (s, i) => !!T(s, i).post;

function pick(s, i, candidates, max = 2) {
  const chosen = [];
  for (const a of candidates) {
    if (!a || chosen.length >= max) continue;
    if (validateAction(s, i, a, chosen).ok) chosen.push(a);
  }
  return chosen;
}

export const STRATEGIES = {
  nichts: { label: 'Nichts ändern (nur Diesel)', play: () => [] },

  hubsStadt: {
    label: 'Früh grün: Hubs in der Stadt, Post auf dem Land',
    play: (s, i) => pick(s, i, [
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      { type: 'hub', field: 'S2' },
      { type: 'hub', field: 'S5' },
      s.round >= 2 && vanIds(s, i, (e) => e.field === 'A2' || e.field === 'A8').length
        ? { type: 'remove', ids: vanIds(s, i, (e) => e.field === 'A2' || e.field === 'A8') } : null,
      { type: 'post' },
      hasPost(s, i) && ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      peakNow(s) ? { type: 'crowd', field: 'A5' } : null
    ])
  },

  hubsGeschickt: {
    label: 'Hubs in der Stadt mit Zeitfenstern, Post auf dem Land',
    play: (s, i) => pick(s, i, [
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      { type: 'hub', field: 'S2' },
      { type: 'hub', field: 'S5' },
      // Hubs übernehmen die Stadt: die vier Vans im Zentrum werden überflüssig
      s.round >= 2 && vanIds(s, i, (e) => e.field === 'S1').length ? { type: 'remove', ids: vanIds(s, i, (e) => e.field === 'S1') } : null,
      { type: 'post' },
      hasPost(s, i) && ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      peakNow(s) ? { type: 'crowd', field: 'A5' } : null,
      s.round >= 3 ? { type: 'service', zone: 'stadt', policy: 'window' } : null
    ])
  },

  boxenHubs: {
    label: 'Boxen und Hubs in der Stadt, Post auf dem Land',
    play: (s, i) => pick(s, i, [
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      { type: 'boxes', area: 'stadt' },
      { type: 'hub', field: 'S2' },
      { type: 'post' },
      s.round >= 2 && vanIds(s, i, (e) => e.field === 'S1').length > 1 ? { type: 'remove', ids: vanIds(s, i, (e) => e.field === 'S1').slice(0, 3) } : null,
      hasPost(s, i) && ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      peakNow(s) ? { type: 'crowd', field: 'A5' } : null
    ])
  },

  mixZonen: {
    label: 'Mix nach Zonen: Boxen Stadt, Post Land, E-Vans',
    play: (s, i) => pick(s, i, [
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      { type: 'boxes', area: 'stadt' },
      { type: 'post' },
      hasPost(s, i) && ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      { type: 'service', zone: 'stadt', policy: 'window' },
      peakNow(s) ? { type: 'crowd', field: 'A5' } : null
    ])
  },

  stadtMax: {
    label: 'Stadt maximieren, Land vernachlässigen',
    play: (s, i) => pick(s, i, [
      ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      { type: 'boxes', area: 'stadt' },
      { type: 'service', zone: 'stadt', policy: 'window' }
    ])
  },

  boxPost: {
    label: 'Boxen überall, Post auf dem Land',
    play: (s, i) => pick(s, i, [
      { type: 'boxes', area: 'stadt' },
      { type: 'post' },
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      hasPost(s, i) && ruralVanIds(s, i).length ? { type: 'remove', ids: ruralVanIds(s, i) } : null,
      { type: 'boxes', area: 'agglo' },
      { type: 'boxes', area: 'nord' }
    ])
  },

  zeitfenster: {
    label: 'Zeitfenster in allen Zonen',
    play: (s, i) => pick(s, i, [
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null,
      { type: 'service', zone: 'stadt', policy: 'window' },
      { type: 'service', zone: 'agglo', policy: 'window' },
      { type: 'service', zone: 'land', policy: 'window' }
    ])
  },

  vieleVans: {
    label: 'Viele zusätzliche Vans',
    play: (s, i) => pick(s, i, [
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      { type: 'vans', field: 'S1', count: 3, drive: 'e' },
      { type: 'vans', field: 'A5', count: 3, drive: 'diesel' }
    ])
  },

  postUndFlotte: {
    label: 'Post-Vertrag, aber eigene Land-Vans behalten',
    play: (s, i) => pick(s, i, [
      { type: 'post' },
      zezSoon(s) ? { type: 'convert', field: 'S1' } : null,
      peakNow(s) ? { type: 'crowd', field: 'S1' } : null
    ])
  },

  spaetBauen: {
    label: 'Hub und Box erst spät',
    play: (s, i) => pick(s, i, s.round >= s.rounds - 1
      ? [zezSoon(s) ? { type: 'convert', field: 'S1' } : null, { type: 'hub', field: 'S1' }, { type: 'boxes', area: 'stadt' }]
      : [zezSoon(s) ? { type: 'convert', field: 'S1' } : null, peakNow(s) ? { type: 'crowd', field: 'S1' } : null])
  },

  ungenutzterVan: {
    label: 'Ungenutzter Van an der Zonengrenze',
    play: (s, i) => pick(s, i, s.round === 1
      ? [{ type: 'vans', field: 'A1', count: 1, drive: 'diesel' }]
      : [zezSoon(s) ? { type: 'convert', field: 'S1' } : null, peakNow(s) ? { type: 'crowd', field: 'S1' } : null])
  }
};
