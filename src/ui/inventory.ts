import { MOD_LABEL } from '../engine/attributes';
import { GEAR_SLOTS, ITEMS, SLOT_LABEL, STATUSES, weaponOfItem, isPackSlot, packCapacity, slotsOf, type Gear, type GearLoc, type ItemDef, type ItemId } from '../engine';
import type { Disposition, Prisoner, Spoils, SpoilsChoice } from '../world/spoils';
import { previewUrl } from '../render/sprites';
import { bareHandArt, itemArt } from './actionbar';
import { esc, hideOverlayCard, showCard } from './screens';

/**
 * The inventory screen: a paper doll with a box for every slot, the pack under it, and whatever is lying around
 * (the ground in a fight, the party stash back on the map) beside it. Click an item, then click where it goes;
 * double-click to equip or stow it in one go. The screen owns no game state: every change goes through `move`/`quick`.
 */

export interface InvPerson {
  id: string;
  name: string;
}

export interface InvView {
  name: string;
  role: string;
  /** art key for the paper doll; the forward-facing sprite is used */
  sprite: string;
  gear: Gear;
  /** one line of stats, already formatted */
  stats: string;
  /** one line about what is in hand */
  weapon: string;
}

export interface InvContext {
  title: string;
  /** extra line under the title (AP left, where you are standing...) */
  note: () => string;
  people: InvPerson[];
  current: string;
  view: (id: string) => InvView;
  listTitle: string;
  /** what is lying around for this person (the ground under them, or the party stash) */
  list: (id: string) => ItemId[];
  /** short lines about the bodies on this tile, if any */
  bodies?: (id: string) => string[];
  move: (id: string, from: GearLoc, to: GearLoc) => { ok: boolean; error?: string; ap?: number };
  quick: (id: string, from: GearLoc) => { ok: boolean; error?: string; ap?: number };
  onClose: () => void;
}

// ---------- item art ----------

const GLYPHS: Record<string, string> = {
  head: '<path d="M14 40a18 18 0 0136 0z"/><rect x="10" y="40" width="44" height="7" rx="3"/>',
  chest: '<path d="M22 10l-14 11 7 9 7-5v29h24V25l7 5 7-9-14-11-6 6h-8z"/>',
  legs: '<path d="M18 8h28l3 48H35l-3-28-3 28H15z"/>',
  shoes: '<path d="M10 18h16v18l22 6c4 1 6 3 6 8v4H10z"/>',
  pack: '<rect x="14" y="12" width="36" height="46" rx="9"/><rect x="22" y="34" width="20" height="14" rx="3" fill="rgba(0,0,0,.28)"/>',
  small: '<rect x="25" y="8" width="14" height="9" rx="2"/><rect x="18" y="17" width="28" height="41" rx="7"/>',
  remains: '<circle cx="32" cy="28" r="19"/><rect x="22" y="42" width="20" height="13" rx="3"/><circle cx="25" cy="28" r="4.5" fill="rgba(0,0,0,.6)"/><circle cx="39" cy="28" r="4.5" fill="rgba(0,0,0,.6)"/>',
};

export function itemSvg(d: ItemDef): string {
  const art = itemArt(d.id);
  if (art) return art;
  const key = d.kind === 'armor' ? (d.slot ?? 'chest') : d.kind === 'pack' ? 'pack' : d.kind === 'remains' ? 'remains' : 'small';
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true"><g fill="${d.color}" stroke="rgba(0,0,0,.55)" stroke-width="2" stroke-linejoin="round">${GLYPHS[key]}</g></svg>`;
}



/** Hover text for an item: name, what it does, what it changes while worn. */
export function itemTip(id: ItemId): string {
  const d = ITEMS[id];
  if (!d) return id;
  const mods = Object.entries(d.mods ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${MOD_LABEL[k] ?? k} ${(v as number) > 0 ? '+' : ''}${v}`);
  const cap = d.capacity ? ` Holds ${d.capacity}.` : '';
  const w = d.weapon ? weaponOfItem(id) : null;
  if (w?.melee) {
    const fx = (w.inflicts ?? []).map((i) => `${Math.round(i.chance * 100)}% ${STATUSES[i.effect].name.toLowerCase()}`);
    const tier = ['scrap', 'hand-made', 'crude but deadly'][w.tier ?? 0];
    return `${d.name} (${tier}; ${w.damage[0]}-${w.damage[1]} dmg${fx.length ? `; ${fx.join(', ')}` : ''}${w.breakChance ? `; ${Math.round(w.breakChance * 1000) / 10}% to break per swing` : ''}). ${d.desc}`;
  }
  return `${d.name}${mods.length ? ` (${mods.join(', ')})` : ''}. ${d.desc}${cap}`;
}

// ---------- the screen ----------

const DOLL: Array<{ slot: string; col: number; row: number }> = [
  { slot: 'head', col: 2, row: 1 },
  { slot: 'leftHand', col: 1, row: 2 },
  { slot: 'chest', col: 2, row: 2 },
  { slot: 'rightHand', col: 3, row: 2 },
  { slot: 'belt1', col: 1, row: 3 },
  { slot: 'legs', col: 2, row: 3 },
  { slot: 'belt2', col: 3, row: 3 },
  { slot: 'back', col: 1, row: 4 },
  { slot: 'shoes', col: 2, row: 4 },
];

export function showInventory(ctx: InvContext): void {
  let who = ctx.current;
  let sel: GearLoc | null = null;
  let msg = '';
  let lastClick: { key: string; at: number } | null = null;
  let card: HTMLDivElement;

  const itemAt = (loc: GearLoc, v: InvView, list: ItemId[]): ItemId | undefined => ('slot' in loc ? v.gear[loc.slot] : list[loc.ground]);
  const same = (a: GearLoc | null, b: GearLoc): boolean => !!a && ('slot' in a ? 'slot' in b && a.slot === b.slot : 'ground' in b && a.ground === b.ground);

  const cell = (loc: GearLoc, id: ItemId | undefined, label: string, v: InvView): string => {
    const attr = 'slot' in loc ? `data-slot="${loc.slot}"` : `data-g="${loc.ground}"`;
    const d = id ? ITEMS[id] : undefined;
    const art = d ? itemSvg(d) : 'slot' in loc && (loc.slot === 'leftHand' || loc.slot === 'rightHand') ? `<span class="ghosthand">${bareHandArt()}</span>` : '';
    // a two-hander in the right hand also fills the left, faded
    const ghost = 'slot' in loc && loc.slot === 'leftHand' && !id && v.gear.rightHand && (ITEMS[v.gear.rightHand]?.weapon ? true : false);
    const twoHanded = ghost ? itemArt(v.gear.rightHand) : null;
    const isTwo = ghost && twoHanded && /2-handed/.test(v.weapon);
    const cls = ['islot', id ? 'full' : 'empty', same(sel, loc) ? 'sel' : '', isTwo ? 'ghost' : ''].filter(Boolean).join(' ');
    const content = isTwo ? `<span class="ghosthand" style="opacity:.35">${twoHanded}</span>` : art;
    return `<button class="${cls}" ${attr} title="${esc(id ? itemTip(id) : label)}">${content}<i>${esc(label)}</i></button>`;
  };

  const render = (): void => {
    const v = ctx.view(who);
    const list = ctx.list(who);
    const bodies = ctx.bodies?.(who) ?? [];
    const cap = packCapacity(v.gear);
    const tabs =
      ctx.people.length > 1
        ? `<div class="tabs">${ctx.people.map((p) => `<button class="tab${p.id === who ? ' on' : ''}" data-who="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>`
        : '';
    const doll = DOLL.map((d) => `<div style="grid-column:${d.col};grid-row:${d.row}">${cell({ slot: d.slot }, v.gear[d.slot], SLOT_LABEL[d.slot as (typeof GEAR_SLOTS)[number]], v)}</div>`).join('');
    const pack =
      cap > 0
        ? `<h3>Pack (${cap})</h3><div class="igrid">${Array.from({ length: cap }, (_, i) => cell({ slot: `pack${i}` }, v.gear[`pack${i}`], 'Pack', v)).join('')}</div>`
        : `<h3>Pack</h3><p class="sub">Wear a bag on your back for somewhere to carry things.</p>`;
    const ground = list.length
      ? `<div class="igrid">${list.map((id, i) => cell({ ground: i }, id, ITEMS[id]?.name ?? id, v)).join('')}</div>`
      : `<p class="sub">Nothing here.</p>`;
    card.innerHTML =
      `<h1>${esc(ctx.title)}</h1><p class="sub">${ctx.note()}</p>${tabs}` +
      `<div class="inv"><div class="invl"><h3>${esc(v.name)} <small>${esc(v.role)}</small></h3>` +
      `<div class="doll"><img class="dollimg" src="${previewUrl(v.sprite)}" alt="" onerror="this.style.display='none'">${doll}</div>` +
      `<div class="preview">${v.stats}<br>${esc(v.weapon)}</div>${pack}</div>` +
      `<div class="invr"><h3>${esc(ctx.listTitle)}</h3>${bodies.map((b) => `<p class="body">${esc(b)}</p>`).join('')}` +
      `<div class="idrop" data-drop="1">${ground}<p class="hint">${list.length ? 'Drop here to put something down.' : 'Drop here to put something down.'}</p></div></div></div>` +
      `<p class="invmsg">${esc(msg)}</p><div class="row"><button id="inv-close" class="primary">Done (I / Esc)</button></div>`;
    card.querySelector('.dollimg')?.addEventListener('error', () => undefined);
  };

  const apply = (r: { ok: boolean; error?: string; ap?: number }): void => {
    msg = r.ok ? (r.ap ? `Done (${r.ap} AP).` : '') : (r.error ?? 'Cannot do that.');
    sel = null;
    render();
  };

  const locOf = (el: HTMLElement): GearLoc | null => {
    const c = el.closest<HTMLElement>('[data-slot],[data-g]');
    if (c?.dataset.slot) return { slot: c.dataset.slot };
    if (c?.dataset.g !== undefined) return { ground: Number(c.dataset.g) };
    return null;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'i') {
      e.preventDefault();
      close();
    }
  };
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    hideOverlayCard();
    ctx.onClose();
  };

  card = showCard('');
  window.addEventListener('keydown', onKey, true);
  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#inv-close')) return close();
    const tab = t.closest<HTMLElement>('[data-who]');
    if (tab) {
      who = tab.dataset.who as string;
      sel = null;
      msg = '';
      return render();
    }
    const loc = locOf(t);
    const v = ctx.view(who);
    const list = ctx.list(who);
    if (loc) {
      const here = itemAt(loc, v, list);
      // Two quick clicks on the same item: equip or stow it. Tracked by hand, because each click redraws the screen
      // and the browser's own double-click event does not survive that.
      const now = e.timeStamp;
      const twice = !!lastClick && lastClick.key === JSON.stringify(loc) && now - lastClick.at < 400;
      lastClick = here ? { key: JSON.stringify(loc), at: now } : null;
      if (twice && here) {
        lastClick = null;
        return apply(ctx.quick(who, loc));
      }
      if (!sel) {
        if (here) {
          sel = loc;
          msg = '';
        }
        return render();
      }
      if (same(sel, loc)) {
        sel = null;
        return render();
      }
      // onto another ground item counts as dropping it on the ground
      const dest: GearLoc = 'ground' in loc ? { ground: 0 } : loc;
      return apply(ctx.move(who, sel, dest));
    }
    if (sel && t.closest('[data-drop]')) return apply(ctx.move(who, sel, { ground: 0 }));
  });
  render();
}

/** For tests: which slot ids the doll shows (a regression guard that every fixed slot has a box). */
export const DOLL_SLOTS = DOLL.map((d) => d.slot);
export const allSlotsShown = (gear: Gear): boolean => slotsOf(gear).filter((s) => !isPackSlot(s)).every((s) => DOLL_SLOTS.includes(s));

// ---------- end-of-battle spoils ----------

export const DISPOSITION_LABEL: Record<Disposition, string> = { execute: 'Execute', capture: 'Capture', release: 'Let go' };
const DISPOSITION_TIP: Record<Disposition, string> = {
  execute: 'Kill them. They will not be back, and there will be remains. Their friends will not forget it.',
  capture: 'Keep them prisoner. They come back to camp with you.',
  release: 'Let them walk away. They may remember your mercy.',
};

export function showSpoils(spoils: Spoils, label: string, onDone: (choice: SpoilsChoice) => void): void {
  const take = new Set(spoils.loot.map((_, i) => i));
  const fates: Record<string, Disposition> = {};
  for (const p of spoils.prisoners) fates[p.id] = 'release';
  const card = showCard('');
  const render = (): void => {
    const loot = spoils.loot.length
      ? `<div class="igrid">${spoils.loot
          .map((id, i) => {
            const d = ITEMS[id];
            return `<button class="islot full${take.has(i) ? ' sel' : ''}" data-take="${i}" title="${esc(itemTip(id))}">${d ? itemSvg(d) : ''}<i>${esc(d?.name ?? id)}</i></button>`;
          })
          .join('')}</div><p class="sub">Click an item to leave it behind. ${take.size} of ${spoils.loot.length} taken.</p>`
      : '<p class="sub">Nothing worth picking up.</p>';
    const prisoners = spoils.prisoners.length
      ? spoils.prisoners
          .map(
            (p: Prisoner) =>
              `<div class="prisoner"><img src="${previewUrl(p.sprite ?? p.name.toLowerCase())}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(p.name)}</b> <small>${esc(p.role)}</small>` +
              `<div class="seg">${(['release', 'capture', 'execute'] as Disposition[])
                .map((f) => `<button data-fate="${esc(p.id)}" data-v="${f}" class="${fates[p.id] === f ? 'on' : ''}${f === 'execute' ? ' grim' : ''}" title="${esc(DISPOSITION_TIP[f])}">${DISPOSITION_LABEL[f]}</button>`)
                .join('')}</div></div></div>`,
          )
          .join('')
      : '<p class="sub">Nobody was left alive on the field.</p>';
    card.innerHTML =
      `<h1>${esc(label)}: spoils</h1><p class="sub">The field is yours.${spoils.killed ? ` ${spoils.killed} rival${spoils.killed === 1 ? '' : 's'} did not get up.` : ''}</p>` +
      `<h3>Loot</h3>${loot}<h3>Prisoners</h3>${prisoners}` +
      `<div class="row"><button id="sp-done" class="primary">Done</button></div>`;
  };
  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const item = t.closest<HTMLElement>('[data-take]');
    if (item) {
      const i = Number(item.dataset.take);
      if (take.has(i)) take.delete(i);
      else take.add(i);
      return render();
    }
    const f = t.closest<HTMLElement>('[data-fate]');
    if (f) {
      fates[f.dataset.fate as string] = f.dataset.v as Disposition;
      return render();
    }
    if (t.closest('#sp-done')) {
      hideOverlayCard();
      onDone({ take: [...take], fates });
    }
  });
  render();
}
