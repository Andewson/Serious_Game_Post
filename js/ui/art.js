// Illustrationen der Spielelemente als flache SVG-Grafiken (eigene Zeichnungen, keine Marken).
// art(kind) liefert SVG-Markup mit viewBox 0 0 120 80.
const C = {
  ink: '#2b3138', grey: '#d7dde3', greyD: '#b9c0c8', light: '#eef1f4', win: '#a9cbe8',
  green: '#3f9b5a', greenL: '#cfe8d6', teal: '#1f6f73', tealL: '#3d8a8e', amber: '#e3ae3c',
  parcel: '#c99357', parcelL: '#e3bb88', red: '#c84040', skin1: '#e0b48a', skin2: '#9a6a46', blue: '#4a7bd0', orange: '#e07a3a'
};

const shadow = (cx = 60, w = 46) => `<ellipse cx="${cx}" cy="68" rx="${w}" ry="3.2" fill="#000" opacity=".08"/>`;

function van(body, { stroke = 'none', stripe = null, badge = '', side = '' } = {}) {
  const st = stroke !== 'none' ? ` stroke="${stroke}" stroke-width="1.5"` : '';
  return `
  <rect x="14" y="24" width="60" height="34" rx="4" fill="${body}"${st}/>
  <path d="M74 33h13l12 12v10a3 3 0 0 1-3 3H74z" fill="${body}"${st}/>
  <path d="M77 36h9l9 9H77z" fill="${C.win}"/>
  ${stripe ? `<rect x="14" y="46" width="60" height="5" fill="${stripe}"/><rect x="74" y="46" width="25" height="5" fill="${stripe}"/>` : ''}
  ${side}
  <rect x="97" y="49" width="3" height="4" rx="1" fill="${C.amber}"/>
  <circle cx="31" cy="59" r="7.5" fill="${C.ink}"/><circle cx="31" cy="59" r="3" fill="${C.light}"/>
  <circle cx="85" cy="59" r="7.5" fill="${C.ink}"/><circle cx="85" cy="59" r="3" fill="${C.light}"/>
  ${badge}`;
}

const bolt = (cx, cy, r = 8, bg = C.green) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"/><path d="M${cx + 1.5} ${cy - r * 0.62}l-${r * 0.62} ${r * 0.75}h${r * 0.45}l-${r * 0.25} ${r * 0.55}l${r * 0.65}-${r * 0.8}h-${r * 0.45}z" fill="#fff"/>`;

const ART = {
  vanDiesel: () => `${shadow()}
  <circle cx="9" cy="52" r="4.5" fill="${C.greyD}" opacity=".9"/><circle cx="5" cy="43" r="3.2" fill="${C.greyD}" opacity=".7"/><circle cx="10" cy="36" r="2.2" fill="${C.greyD}" opacity=".5"/>
  ${van(C.grey, { side: `<rect x="22" y="30" width="22" height="10" rx="2" fill="${C.greyD}"/>` })}`,

  vanE: () => `${shadow()}
  ${van('#fbfcfd', { stroke: C.greyD, stripe: C.green, badge: bolt(44, 36, 8) })}
  <path d="M14 52c-6 0-6 8-12 8" stroke="${C.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>`,

  convert: () => `<g transform="translate(2 18) scale(.5)">${van(C.grey)}</g>
  <path d="M56 46h12m-5-5 5 5-5 5" stroke="${C.ink}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <g transform="translate(60 18) scale(.5)">${van('#fbfcfd', { stroke: C.greyD, stripe: C.green })}</g>
  ${bolt(104, 22, 8)}
  <ellipse cx="31" cy="68" rx="24" ry="2.6" fill="#000" opacity=".07"/><ellipse cx="89" cy="68" rx="24" ry="2.6" fill="#000" opacity=".07"/>`,

  hub: () => `${shadow(62, 50)}
  <rect x="54" y="22" width="54" height="40" rx="2" fill="${C.light}" stroke="${C.greyD}" stroke-width="1.5"/>
  <rect x="50" y="14" width="62" height="10" rx="2" fill="${C.teal}"/>
  <rect x="62" y="36" width="16" height="26" fill="${C.tealL}"/><rect x="84" y="32" width="16" height="12" rx="1" fill="${C.win}"/>
  <rect x="4" y="38" width="24" height="16" rx="2" fill="${C.parcel}"/><path d="M4 43h24" stroke="${C.parcelL}" stroke-width="2"/>
  <circle cx="14" cy="61" r="7" fill="none" stroke="${C.ink}" stroke-width="3"/><circle cx="46" cy="61" r="7" fill="none" stroke="${C.ink}" stroke-width="3"/>
  <path d="M14 61 26 56h12l8 5M30 56l6-12m-4 0h8M38 56l-4-14" stroke="${C.ink}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M28 44h8" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`,

  box: () => `${shadow(60, 40)}
  <rect x="28" y="10" width="64" height="54" rx="4" fill="${C.teal}"/>
  ${[0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === 1 && c === 2) ? '' : `<rect x="${33 + c * 19}" y="${15 + r * 15.5}" width="16" height="12.5" rx="1.5" fill="${C.tealL}"/><rect x="${45 + c * 19}" y="${20 + r * 15.5}" width="2" height="3" rx="1" fill="${C.light}"/>`).join('')).join('')}
  <rect x="71" y="30.5" width="16" height="12.5" rx="1.5" fill="${C.light}"/>
  <rect x="74" y="34" width="10" height="9" rx="1" fill="${C.parcel}"/><path d="M74 37h10" stroke="${C.parcelL}" stroke-width="1.5"/>
  <path d="M87 30.5l8 3v12l-8-2.5z" fill="${C.tealL}"/>
  <rect x="36" y="64" width="6" height="4" fill="${C.ink}"/><rect x="78" y="64" width="6" height="4" fill="${C.ink}"/>`,

  post: () => `${shadow()}
  ${van(C.amber, { side: `<rect x="28" y="30" width="26" height="17" rx="2" fill="#fff"/><path d="M28.5 31l12.5 9 12.5-9" stroke="${C.amber}" stroke-width="2" fill="none" stroke-linejoin="round"/>` })}`,

  crowd: () => `${shadow(60, 40)}
  <circle cx="42" cy="18" r="8" fill="${C.skin1}"/><path d="M28 64V40a14 14 0 0 1 28 0v24z" fill="${C.blue}"/>
  <rect x="31" y="38" width="22" height="16" rx="2" fill="${C.parcel}"/><path d="M31 44h22" stroke="${C.parcelL}" stroke-width="2"/>
  <circle cx="80" cy="20" r="8" fill="${C.skin2}"/><path d="M66 64V42a14 14 0 0 1 28 0v22z" fill="${C.orange}"/>
  <rect x="88" y="44" width="10" height="16" rx="2" fill="${C.ink}"/><rect x="90" y="46" width="6" height="10" rx="1" fill="${C.win}"/>`,

  service: () => `${shadow(60, 30)}
  <circle cx="60" cy="38" r="27" fill="#fff" stroke="${C.ink}" stroke-width="3"/>
  <path d="M60 38 L60 13 A25 25 0 0 1 81.6 25.5 Z" fill="${C.greenL}"/>
  ${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<circle cx="${(60 + 21 * Math.sin(a)).toFixed(1)}" cy="${(38 - 21 * Math.cos(a)).toFixed(1)}" r="1.4" fill="${C.ink}"/>`; }).join('')}
  <path d="M60 38V22M60 38l10 6" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="60" cy="38" r="2.5" fill="${C.ink}"/>
  <rect x="88" y="44" width="18" height="22" rx="1" fill="${C.parcel}"/><circle cx="102" cy="56" r="1.5" fill="${C.ink}"/>`,

  emergency: () => `${shadow()}
  <path d="M2 34h8M0 42h10M4 50h7" stroke="${C.greyD}" stroke-width="2.5" stroke-linecap="round"/>
  ${van(C.red, { side: `<path d="M38 28l11 19H27z" fill="${C.amber}"/><rect x="37" y="34" width="2.4" height="7" rx="1" fill="${C.ink}"/><circle cx="38.2" cy="43.5" r="1.4" fill="${C.ink}"/>` })}`
};

export function art(kind) {
  const f = ART[kind];
  if (!f) return '';
  return `<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" class="art">${f()}</svg>`;
}
export const ART_KINDS = Object.keys(ART);
