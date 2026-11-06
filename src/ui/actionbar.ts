import { ITEMS, STATUSES, weaponOfItem, type Gear, type Skill, type Unit, type Weapon } from '../engine';

/** Pure view helpers for the bottom action bar: the hands display and the hover text. No DOM access here. */

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// ---------- icons (64x64, drawn upright; the weapon ones are tilted to sit in a hand slot) ----------

const SKIN = '#e9c6a0';
const SKIN_EDGE = '#7a5a3c';
const WOOD = '#b98b58';
const WOOD_EDGE = '#6b4a2a';
const STEEL = '#c9d3dc';
const STEEL_EDGE = '#5d6b78';

const ICONS: Record<string, string> = {
  /** An open, empty hand. */
  hand:
    `<g fill="${SKIN}" stroke="${SKIN_EDGE}" stroke-width="2" stroke-linejoin="round">` +
    `<rect x="21" y="13" width="7" height="24" rx="3.5"/>` +
    `<rect x="29" y="8" width="7" height="29" rx="3.5"/>` +
    `<rect x="37" y="12" width="7" height="25" rx="3.5"/>` +
    `<rect x="45" y="19" width="6.5" height="18" rx="3.25"/>` +
    `<path d="M21 33h30v9c0 10-8 17-15 17s-15-5-15-13z"/>` +
    `<path d="M22 40c-6-3-11-7-9-11s7-1 11 3z"/>` +
    `</g>`,
  /** A Y-shaped fork with the band drawn back and a stone in the pouch. */
  slingshot:
    `<path d="M32 58V38M32 38L19 12M32 38L45 12" fill="none" stroke="${WOOD_EDGE}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M32 58V38M32 38L19 12M32 38L45 12" fill="none" stroke="${WOOD}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M19 12Q32 34 45 12" fill="none" stroke="#7d2d2d" stroke-width="2.4" stroke-linecap="round"/>` +
    `<ellipse cx="32" cy="27" rx="4.2" ry="3.4" fill="#8a8f94" stroke="#444b52" stroke-width="1.5"/>`,
  /** Steel leaf head, long wooden shaft, two feathers. */
  javelin:
    `<g transform="rotate(38 32 32)">` +
    `<rect x="30" y="14" width="4" height="44" rx="2" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.5"/>` +
    `<path d="M32 1L38.5 16 32 13.5 25.5 16z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M32 49L24 60 32 56 40 60z" fill="#d9534f" stroke="#7d2d2d" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M30 20h4M30 23h4" stroke="${WOOD_EDGE}" stroke-width="1.4"/>` +
    `</g>`,
  /** A chunky pistol with a flare in the muzzle. */
  flaregun:
    `<g stroke-linejoin="round">` +
    `<path d="M20 36l-5 20c-.4 1.6.6 2.6 2 2.6h9c1.4 0 2.4-.8 2.8-2.2L34 36z" fill="#3b2f2a" stroke="#1d1613" stroke-width="2"/>` +
    `<rect x="12" y="18" width="42" height="20" rx="5" fill="#d8442e" stroke="#7d2415" stroke-width="2"/>` +
    `<rect x="44" y="21" width="9" height="14" rx="2" fill="#a52f1d"/>` +
    `<rect x="6" y="22" width="9" height="12" rx="3" fill="#2d3a45" stroke="#12181d" stroke-width="1.6"/>` +
    `<path d="M34 38q-1 8 5 8" fill="none" stroke="#1d1613" stroke-width="2.4" stroke-linecap="round"/>` +
    `<circle cx="7" cy="28" r="5" fill="#ffd34d" stroke="#d98a14" stroke-width="1.6"/>` +
    `</g>`,
  /** A pole whittled to a point and lashed with twine. */
  pole:
    `<g transform="rotate(38 32 32)">` +
    `<path d="M32 2L37 22H27z" fill="#e7cfa6" stroke="${WOOD_EDGE}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<rect x="28.5" y="20" width="7" height="42" rx="2.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.6"/>` +
    `<path d="M28 27h8M28 30h8M28 33h8" stroke="#5a3d22" stroke-width="1.6"/>` +
    `<path d="M32 4l1.6 7h-3.2z" fill="#4a3320"/>` +
    `</g>`,
  // ---- melee placeholders: simple silhouettes, one per family. Real art drops in via src/assets/items/<itemId>.png ----
  stick: `<g transform="rotate(40 32 32)"><rect x="28.5" y="4" width="7" height="56" rx="3.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.8"/><path d="M32 22l8-6M32 38l-8-5" stroke="${WOOD_EDGE}" stroke-width="2.2" stroke-linecap="round"/></g>`,
  rollingpin: `<g transform="rotate(40 32 32)"><rect x="25" y="12" width="14" height="34" rx="6" fill="#e3d2ad" stroke="#8a7650" stroke-width="1.8"/><rect x="29.5" y="2" width="5" height="12" rx="2.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.5"/><rect x="29.5" y="44" width="5" height="14" rx="2.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.5"/></g>`,
  pan: `<g transform="rotate(40 32 32)"><circle cx="32" cy="20" r="15" fill="#4b4f55" stroke="#1d2024" stroke-width="2"/><circle cx="32" cy="20" r="10" fill="#5d636a"/><rect x="29" y="33" width="6" height="27" rx="3" fill="#2d3035" stroke="#1d2024" stroke-width="1.5"/></g>`,
  pipe: `<g transform="rotate(40 32 32)"><rect x="27" y="3" width="10" height="56" rx="3" fill="#8f9aa3" stroke="${STEEL_EDGE}" stroke-width="2"/><path d="M27 12h10M27 52h10" stroke="${STEEL_EDGE}" stroke-width="2"/></g>`,
  bone: `<g transform="rotate(40 32 32)"><rect x="29" y="10" width="6" height="44" rx="3" fill="#ece3cd" stroke="#8a7f66" stroke-width="1.6"/><circle cx="27.5" cy="9" r="5" fill="#ece3cd" stroke="#8a7f66" stroke-width="1.6"/><circle cx="36.5" cy="9" r="5" fill="#ece3cd" stroke="#8a7f66" stroke-width="1.6"/><circle cx="27.5" cy="55" r="5" fill="#ece3cd" stroke="#8a7f66" stroke-width="1.6"/><circle cx="36.5" cy="55" r="5" fill="#ece3cd" stroke="#8a7f66" stroke-width="1.6"/></g>`,
  blade: `<g transform="rotate(40 32 32)"><path d="M32 2l6 8v28H26V10z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.8" stroke-linejoin="round"/><rect x="22" y="38" width="20" height="4" rx="2" fill="#6b5a48" stroke="#3b3228" stroke-width="1.4"/><rect x="29" y="42" width="6" height="16" rx="3" fill="#6b4a2a" stroke="#3b2a18" stroke-width="1.4"/></g>`,
  sword: `<g transform="rotate(40 32 32)"><path d="M32 0l7 8v32H25V8z" fill="#b8c2cc" stroke="${STEEL_EDGE}" stroke-width="1.8" stroke-linejoin="round"/><path d="M32 4v34" stroke="#8793a0" stroke-width="1.4"/><rect x="19" y="40" width="26" height="5" rx="2.5" fill="#6b5a48" stroke="#3b3228" stroke-width="1.4"/><rect x="29" y="45" width="6" height="15" rx="3" fill="#6b4a2a" stroke="#3b2a18" stroke-width="1.4"/></g>`,
  club: `<g transform="rotate(40 32 32)"><path d="M26 2h12l2 30-4 4h-8l-4-4z" fill="#6b5a48" stroke="#3b3228" stroke-width="1.8" stroke-linejoin="round"/><rect x="29.5" y="34" width="5" height="26" rx="2.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.5"/><path d="M26 14h12M26 22h12" stroke="#3b3228" stroke-width="1.6"/></g>`,
  bat: `<g transform="rotate(40 32 32)"><path d="M27 2h10l2 36h-14z" fill="#a67c52" stroke="${WOOD_EDGE}" stroke-width="1.8" stroke-linejoin="round"/><rect x="29.5" y="38" width="5" height="22" rx="2.5" fill="#a67c52" stroke="${WOOD_EDGE}" stroke-width="1.5"/><path d="M24 10l3 1M40 14l-3 1M24 22l3 1M40 26l-3 1" stroke="${STEEL}" stroke-width="2.4" stroke-linecap="round"/></g>`,
  axe: `<g transform="rotate(40 32 32)"><rect x="29.5" y="4" width="5" height="56" rx="2.5" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.6"/><path d="M34 6c12 0 14 6 14 12s-2 12-14 12z" fill="#d8442e" stroke="#7d2415" stroke-width="1.8" stroke-linejoin="round"/></g>`,
  torch: `<g transform="rotate(40 32 32)"><rect x="29" y="20" width="6" height="40" rx="3" fill="${WOOD}" stroke="${WOOD_EDGE}" stroke-width="1.6"/><path d="M32 2c8 8 9 12 9 17a9 9 0 0 1-18 0c0-5 3-7 5-11 1 3 3 3 4-6z" fill="#f08a2a" stroke="#a24a0c" stroke-width="1.6" stroke-linejoin="round"/><path d="M32 12c4 4 4 6 4 8a4 4 0 0 1-8 0c0-2 2-3 4-8z" fill="#ffd34d"/></g>`,
  sock: `<g transform="rotate(40 32 32)"><path d="M26 4h12v26c0 6 6 9 6 15a12 12 0 0 1-24 0c0-6 6-9 6-15z" fill="#cdbb8e" stroke="#8a7a55" stroke-width="1.8" stroke-linejoin="round"/><path d="M26 10h12" stroke="#8a7a55" stroke-width="1.6"/></g>`,
  /** Stand-in for anything without art yet. */
  generic: `<path d="M16 50L50 14" stroke="${WOOD_EDGE}" stroke-width="7" stroke-linecap="round"/><path d="M16 50L50 14" stroke="${WOOD}" stroke-width="3.5" stroke-linecap="round"/>`,
};

/** Which placeholder family each melee weapon is drawn with (by squashed name). */
const MELEE_ART: Record<string, string> = {
  fists: 'hand', stick: 'stick', rollingpin: 'rollingpin', frypingpan: 'pan', fryingpan: 'pan', steelpipe: 'pipe', humanbone: 'bone',
  knife: 'blade', sharpenedstick: 'stick', weightedclub: 'club', torch: 'torch', sandsock: 'sock',
  crudesword: 'sword', nailbat: 'bat', machete: 'sword', poisondagger: 'blade', fireaxe: 'axe',
};

/** Key a weapon's art by its name ("Flare Gun" -> flaregun); anything unknown gets the generic stick. */
export function iconKey(weaponName: string): string {
  const k = weaponName.toLowerCase().replace(/[^a-z]/g, '');
  if (k in MELEE_ART) return MELEE_ART[k];
  if (k in ICONS && k !== 'hand' && k !== 'generic') return k;
  if (k.includes('pole')) return 'pole';
  return 'generic';
}

/**
 * Proper art dropped into src/assets/items/<itemId>.png wins over the placeholder (e.g. knife.png, nailBat.png).
 * Nothing needs registering: the file name is the item id.
 */
const IMAGE_ART = import.meta.glob('../assets/items/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const imageFor = (itemId: string): string | null => IMAGE_ART[`../assets/items/${itemId}.png`] ?? null;
const img = (url: string): string => `<img src="${url}" alt="" draggable="false" style="width:100%;height:100%;object-fit:contain;image-rendering:auto"/>`;

/** Art for an item that has some (weapons); null for anything drawn as a plain coloured tile. */
export function itemArt(id: string): string | null {
  const w = ITEMS[id]?.weapon ? weaponOfItem(id) : null;
  if (!w) return null;
  const url = imageFor(id);
  return url ? img(url) : svg(ICONS[iconKey(w.name)]);
}

export const bareHandArt = (): string => svg(ICONS.hand);

const svg = (inner: string): string => `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${inner}</svg>`;

/**
 * The two hand slots under the action bar. The weapon sits in the right hand; a one-hander leaves the left hand
 * bare, a two-hander shows the same weapon again, faded, in the left.
 */
export function handsHtml(w: Weapon, gear?: Gear): string {
  const art = svg(ICONS[iconKey(w.name)]);
  const bare = (side: string): string => `<div class="slot bare" title="${side} hand (free)">${svg(ICONS.hand)}</div>`;
  const held = (id: string | undefined, side: string): string => {
    const wp = id ? weaponOfItem(id) : null;
    return wp ? `<div class="slot" title="${side} hand: ${esc(wp.name)}">${itemArt(id as string) ?? svg(ICONS[iconKey(wp.name)])}</div>` : bare(side);
  };
  let left: string;
  let right: string;
  if (gear) {
    // what is actually in the hands; a two-hander shows faded in the left too
    right = held(gear.rightHand, 'Right');
    const twoHander = !!gear.rightHand && (weaponOfItem(gear.rightHand)?.hands ?? 1) === 2;
    left = twoHander ? `<div class="slot ghost" title="Left hand">${art}</div>` : held(gear.leftHand, 'Left');
    if (!gear.rightHand && !gear.leftHand) right = bare('Right');
  } else {
    left = w.hands === 2 ? `<div class="slot ghost" title="Left hand">${art}</div>` : bare('Left');
    right = `<div class="slot" title="Right hand">${art}</div>`;
  }
  const traits = [w.hands === 2 ? '2-handed' : '1-handed', w.heavy ? 'heavy' : 'light', ...(w.melee ? ['melee'] : [])];
  return (
    `<div class="slots">${left}${right}</div>` +
    `<div class="wname"><b>${esc(w.name)}</b><span>${traits.join(' &middot; ')}</span></div>`
  );
}

// ---------- hover text ----------

export interface Tip {
  title: string;
  /** shown in the accent colour under the title, e.g. "1 AP (ends turn)" */
  cost: string;
  lines: string[];
}

/** What a basic attack costs and what it leaves you with: the whole point of the heavy/light split. */
export function attackTip(u: Unit | undefined): Tip {
  if (!u) return { title: 'Basic Attack', cost: '1 AP', lines: [] };
  const w = u.weapon;
  const stats = w.melee
    ? `${w.damage[0]}-${w.damage[1]} damage, adjacent only, ignores cover`
    : `${w.damage[0]}-${w.damage[1]} damage, range ${w.range} (full accuracy to ${w.optimal})`;
  const lines = [`${esc(w.name)}: ${stats}`];
  if (w.heavy) {
    lines.push('Heavy weapon: the attack uses your whole turn. Move first if you need to; you cannot move or attack again after it.');
  } else {
    lines.push('Light weapon: you can still move after attacking, or attack twice if you do not move.');
  }
  if (w.melee) {
    for (const i of w.inflicts ?? []) lines.push(`${Math.round(i.chance * 100)}% to leave them ${STATUSES[i.effect].name.toLowerCase()}`);
    if (w.breakChance) lines.push(`Fragile: ${Math.round(w.breakChance * 1000) / 10}% chance to break on every swing.`);
    lines.push('Walking away from someone holding one lets them swing at you for free.');
  } else if (u.ammo <= 0) lines.push('Out of ammo: reload first.');
  else lines.push(`Ammo ${u.ammo}/${w.clip}`);
  return { title: 'Basic Attack', cost: w.heavy ? '1 AP (ends turn)' : '1 AP', lines };
}

export function moveTip(u: Unit | undefined): Tip {
  if (!u) return { title: 'Move', cost: '1-2 AP', lines: [] };
  return {
    title: 'Move',
    cost: '1 AP, or 2 AP to dash',
    lines: [`Up to ${u.mobility} tiles for 1 AP; up to ${u.mobility * 2} tiles (a dash) for 2 AP.`],
  };
}

export function skillTip(s: Skill): Tip {
  return { title: s.name, cost: s.cost, lines: [s.desc] };
}

export function tipHtml(t: Tip): string {
  return `<b>${esc(t.title)}</b><div class="cost">${esc(t.cost)}</div>${t.lines.map((l) => `<p>${l}</p>`).join('')}`;
}
