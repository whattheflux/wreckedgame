import { ITEMS, weaponOfItem, type Gear, type Skill, type Unit, type Weapon } from '../engine';

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
  /** Stand-in for anything without art yet. */
  generic: `<path d="M16 50L50 14" stroke="${WOOD_EDGE}" stroke-width="7" stroke-linecap="round"/><path d="M16 50L50 14" stroke="${WOOD}" stroke-width="3.5" stroke-linecap="round"/>`,
};

/** Key a weapon's art by its name ("Flare Gun" -> flaregun); anything unknown gets the generic stick. */
export function iconKey(weaponName: string): string {
  const k = weaponName.toLowerCase().replace(/[^a-z]/g, '');
  if (k in ICONS && k !== 'hand' && k !== 'generic') return k;
  if (k.includes('pole')) return 'pole';
  return 'generic';
}

/** Art for an item that has some (weapons); null for anything drawn as a plain coloured tile. */
export function itemArt(id: string): string | null {
  const w = ITEMS[id]?.weapon ? weaponOfItem(id) : null;
  return w ? svg(ICONS[iconKey(w.name)]) : null;
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
    return wp ? `<div class="slot" title="${side} hand: ${esc(wp.name)}">${svg(ICONS[iconKey(wp.name)])}</div>` : bare(side);
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
  const traits = [w.hands === 2 ? '2-handed' : '1-handed', w.heavy ? 'heavy' : 'light'];
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
  const stats = `${w.damage[0]}-${w.damage[1]} damage, range ${w.range} (full accuracy to ${w.optimal})`;
  const lines = [`${esc(w.name)}: ${stats}`];
  if (w.heavy) {
    lines.push('Heavy weapon: the attack uses your whole turn. Move first if you need to; you cannot move or attack again after it.');
  } else {
    lines.push('Light weapon: you can still move after attacking, or attack twice if you do not move.');
  }
  if (u.ammo <= 0) lines.push('Out of ammo: reload first.');
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
