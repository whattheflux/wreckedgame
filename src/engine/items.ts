import { WEAPONS } from './scenarios';
import { rand, type RngHolder } from './rng';
import type { StatBlock } from './roster';
import type { Weapon } from './types';

/**
 * Items and what a unit wears and carries. Pure data and rules: no DOM, no battle state.
 *
 * A unit's gear is a flat record from slot id to item id (an absent key is an empty slot), so it is plain JSON
 * and saves with the roster. Slots: head, chest, legs, shoes, two belt slots, right and left hand, back, and
 * `pack0..packN` which only exist while a pack is worn on the back.
 */

export type ItemId = string;
export type Gear = Record<string, ItemId>;

export const GEAR_SLOTS = ['head', 'chest', 'legs', 'shoes', 'belt1', 'belt2', 'rightHand', 'leftHand', 'back'] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

export const SLOT_LABEL: Record<GearSlot, string> = {
  head: 'Head',
  chest: 'Chest',
  legs: 'Legs',
  shoes: 'Shoes',
  belt1: 'Belt',
  belt2: 'Belt',
  rightHand: 'Right hand',
  leftHand: 'Left hand',
  back: 'Back',
};

export const isHandSlot = (s: string): boolean => s === 'rightHand' || s === 'leftHand';
export const isPackSlot = (s: string): boolean => /^pack\d+$/.test(s);
export const packIndex = (s: string): number => Number(s.slice(4));

export type ItemKind = 'weapon' | 'armor' | 'small' | 'pack' | 'remains';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  /** where it is worn; small items go on the belt or in a pack, remains only in a pack */
  slot?: 'head' | 'chest' | 'legs' | 'shoes' | 'hand' | 'back';
  /** weapons: the entry in WEAPONS this item is (the item id is the same key) */
  weapon?: keyof typeof WEAPONS;
  /** worn items: stat changes while it is on */
  mods?: Partial<StatBlock>;
  /** packs: how many pack slots it adds */
  capacity?: number;
  /** chance (0-1) that it survives its wearer's death and can be looted; unconscious rivals keep everything */
  loot: number;
  /** tint for the icon */
  color: string;
  desc: string;
}

const def = (d: ItemDef): [ItemId, ItemDef] => [d.id, d];

export const ITEMS: Record<ItemId, ItemDef> = Object.fromEntries([
  // weapons: the item id is the WEAPONS key
  def({ id: 'slingshot', name: 'Slingshot', kind: 'weapon', slot: 'hand', weapon: 'slingshot', loot: 0.8, color: '#b98b58', desc: 'Light, one-handed. Cheap and everywhere.' }),
  def({ id: 'javelin', name: 'Javelin', kind: 'weapon', slot: 'hand', weapon: 'javelin', loot: 0.7, color: '#c9d3dc', desc: 'Two-handed and heavy: a throw takes your whole turn.' }),
  def({ id: 'flareGun', name: 'Flare Gun', kind: 'weapon', slot: 'hand', weapon: 'flareGun', loot: 0.6, color: '#d8442e', desc: 'Light and loud. Two flares in the clip.' }),
  def({ id: 'pole', name: 'Sharpened Pole', kind: 'weapon', slot: 'hand', weapon: 'pole', loot: 0.7, color: '#a67c52', desc: 'Two-handed and heavy. Short reach, good aim.' }),
  def({ id: 'stick', name: 'Stick', kind: 'weapon', slot: 'hand', weapon: 'stick', loot: 0.6, color: '#8a6a45', desc: 'A branch. Splinters after a few swings.' }),
  def({ id: 'rollingPin', name: 'Rolling Pin', kind: 'weapon', slot: 'hand', weapon: 'rollingPin', loot: 0.6, color: '#d9c7a0', desc: 'Kitchen weapon. Sometimes leaves them seeing stars.' }),
  def({ id: 'fryingPan', name: 'Frying Pan', kind: 'weapon', slot: 'hand', weapon: 'fryingPan', loot: 0.6, color: '#4b4f55', desc: 'Sturdy and loud. Good odds of a stun.' }),
  def({ id: 'pipe', name: 'Steel Pipe', kind: 'weapon', slot: 'hand', weapon: 'pipe', loot: 0.6, color: '#8f9aa3', desc: 'Heavy for one hand. Can stun.' }),
  def({ id: 'humanBone', name: 'Human Bone', kind: 'weapon', slot: 'hand', weapon: 'humanBone', loot: 0.6, color: '#e6dcc4', desc: 'Grim. Frightens people.' }),
  def({ id: 'knife', name: 'Knife', kind: 'weapon', slot: 'hand', weapon: 'knife', loot: 0.7, color: '#c9d3dc', desc: 'Small, sharp, rarely breaks. Can open a wound.' }),
  def({ id: 'sharpStick', name: 'Sharpened Stick', kind: 'weapon', slot: 'hand', weapon: 'sharpStick', loot: 0.6, color: '#a67c52', desc: 'A pointed stick. Can open a wound.' }),
  def({ id: 'weightedClub', name: 'Weighted Club', kind: 'weapon', slot: 'hand', weapon: 'weightedClub', loot: 0.7, color: '#6b5a48', desc: 'Two-handed and heavy. Stuns and shakes.' }),
  def({ id: 'torch', name: 'Torch', kind: 'weapon', slot: 'hand', weapon: 'torch', loot: 0.5, color: '#e0852e', desc: 'Sets people alight and scares them.' }),
  def({ id: 'sandSock', name: 'Sand Sock', kind: 'weapon', slot: 'hand', weapon: 'sandSock', loot: 0.6, color: '#cdbb8e', desc: 'Gritty. Can blind.' }),
  def({ id: 'crudeSword', name: 'Crude Sword', kind: 'weapon', slot: 'hand', weapon: 'crudeSword', loot: 0.7, color: '#b8c2cc', desc: 'Hammered from scrap. Cuts deep.' }),
  def({ id: 'nailBat', name: 'Nail Bat', kind: 'weapon', slot: 'hand', weapon: 'nailBat', loot: 0.7, color: '#8a6a45', desc: 'Two-handed and heavy. Bleeds and stuns.' }),
  def({ id: 'machete', name: 'Machete', kind: 'weapon', slot: 'hand', weapon: 'machete', loot: 0.7, color: '#aab4bd', desc: 'A real blade. Likely to bleed them.' }),
  def({ id: 'poisonDagger', name: 'Poison Dagger', kind: 'weapon', slot: 'hand', weapon: 'poisonDagger', loot: 0.7, color: '#7fcf5a', desc: 'A coated blade. Often poisons.' }),
  def({ id: 'fireAxe', name: 'Fire Axe', kind: 'weapon', slot: 'hand', weapon: 'fireAxe', loot: 0.7, color: '#d8442e', desc: 'Two-handed and heavy. Hits very hard.' }),
  // head
  def({ id: 'cap', name: 'Baseball Cap', kind: 'armor', slot: 'head', mods: { defense: 1 }, loot: 0.5, color: '#3d6fa8', desc: 'Keeps the sun off. Barely stops a stone.' }),
  def({ id: 'helmet', name: 'Bike Helmet', kind: 'armor', slot: 'head', mods: { defense: 3 }, loot: 0.4, color: '#d0b030', desc: 'Foam and plastic, but it helps.' }),
  // chest
  def({ id: 'uniform', name: 'School Uniform', kind: 'armor', slot: 'chest', loot: 0.25, color: '#7a2c3c', desc: 'Blazer and tie. Torn already.' }),
  def({ id: 'hoodie', name: 'Hoodie', kind: 'armor', slot: 'chest', mods: { defense: 1 }, loot: 0.4, color: '#4a5560', desc: 'Thick cotton.' }),
  def({ id: 'letterman', name: 'Letterman Jacket', kind: 'armor', slot: 'chest', mods: { defense: 1, hp: 2 }, loot: 0.35, color: '#3a4f8a', desc: 'Padded sleeves, a lot of pride.' }),
  def({ id: 'lifejacket', name: 'Life Jacket', kind: 'armor', slot: 'chest', mods: { defense: 4, mobility: -1 }, loot: 0.4, color: '#e0702a', desc: 'Stops a lot, but it is bulky.' }),
  // legs
  def({ id: 'trousers', name: 'School Trousers', kind: 'armor', slot: 'legs', loot: 0.25, color: '#3a3f4a', desc: 'Grey and scratchy.' }),
  def({ id: 'shinguards', name: 'Shin Guards', kind: 'armor', slot: 'legs', mods: { defense: 2 }, loot: 0.4, color: '#c9d3dc', desc: 'Sports kit.' }),
  // shoes
  def({ id: 'sneakers', name: 'Sneakers', kind: 'armor', slot: 'shoes', loot: 0.25, color: '#d7e0e8', desc: 'Worn flat.' }),
  def({ id: 'runners', name: 'Running Shoes', kind: 'armor', slot: 'shoes', mods: { mobility: 1 }, loot: 0.4, color: '#37b36a', desc: 'Light and grippy.' }),
  def({ id: 'boots', name: 'Work Boots', kind: 'armor', slot: 'shoes', mods: { defense: 1 }, loot: 0.4, color: '#6b4a2a', desc: 'Steel toes from the shop room.' }),
  // back
  def({ id: 'schoolbag', name: 'School Bag', kind: 'pack', slot: 'back', capacity: 4, loot: 0.3, color: '#a83a3a', desc: 'Four extra slots.' }),
  def({ id: 'hikingpack', name: 'Hiking Pack', kind: 'pack', slot: 'back', capacity: 8, loot: 0.2, color: '#4a7a4a', desc: 'Eight extra slots.' }),
  // small items: belt or pack
  def({ id: 'bandage', name: 'Bandage', kind: 'small', loot: 0.9, color: '#f0e0d0', desc: 'Stops the bleeding. (Using items in a fight is not in yet.)' }),
  def({ id: 'energybar', name: 'Energy Bar', kind: 'small', loot: 0.9, color: '#d08a2a', desc: 'Stale, but food.' }),
  def({ id: 'firecracker', name: 'Firecracker', kind: 'small', loot: 0.8, color: '#d83a2a', desc: 'Loud. Throwable once throwing is in.' }),
  def({ id: 'waterbottle', name: 'Water Bottle', kind: 'small', loot: 0.9, color: '#6ab0e0', desc: 'Half full.' }),
  // what is left of someone
  def({ id: 'remains', name: 'Remains', kind: 'remains', loot: 1, color: '#7a2c2c', desc: 'For cooking, rituals, or worse. Back at camp, later.' }),
]);

export const itemDef = (id: ItemId): ItemDef | undefined => ITEMS[id];

/** The weapon an item is, if it is one. */
export const weaponOfItem = (id: ItemId): Weapon | null => {
  const d = ITEMS[id];
  return d?.weapon ? WEAPONS[d.weapon] : null;
};

const isTwoHanded = (id: ItemId | undefined): boolean => !!id && (weaponOfItem(id)?.hands ?? 1) === 2;

// ---------- reading gear ----------

/** How many pack slots the worn back item gives. */
export const packCapacity = (gear: Gear): number => (gear.back ? (ITEMS[gear.back]?.capacity ?? 0) : 0);

/** Every slot this gear has, in display order: the fixed ones, then pack0..packN. */
export function slotsOf(gear: Gear): string[] {
  const out: string[] = [...GEAR_SLOTS];
  for (let i = 0; i < packCapacity(gear); i++) out.push(`pack${i}`);
  return out;
}

/** Bare hands: what you hit with when nothing is held. Not an item and not in WEAPONS, so nobody can drop or loot it. */
export const FISTS: Weapon = { name: 'Fists', damage: [1, 2], range: 1.5, optimal: 1, aimMod: 0, critMod: 0, clip: 99, hands: 1, heavy: false, melee: true, tier: 0 };

/** What a unit hits with: the right hand, else the left, else bare fists. */
export function weaponOfGear(gear: Gear): Weapon {
  return weaponOfItem(gear.rightHand ?? '') ?? weaponOfItem(gear.leftHand ?? '') ?? FISTS;
}

const WORN: GearSlot[] = ['head', 'chest', 'legs', 'shoes'];

/** Stat changes from what is worn. */
export function gearMods(gear: Gear): StatBlock {
  const sum: StatBlock = { hp: 0, mobility: 0, aim: 0, defense: 0, crit: 0 };
  for (const s of WORN) {
    const mods = ITEMS[gear[s] ?? '']?.mods;
    if (!mods) continue;
    for (const k of Object.keys(mods) as Array<keyof StatBlock>) sum[k] += mods[k] ?? 0;
  }
  return sum;
}

/** Every item the unit has on or in it, in slot order. */
export const itemsIn = (gear: Gear): ItemId[] => slotsOf(gear).flatMap((s) => (gear[s] ? [gear[s]] : []));

// ---------- the rules of putting things places ----------

/** Can this item go in this slot at all (ignoring what is already there)? */
export function slotAccepts(gear: Gear, slot: string, id: ItemId): boolean {
  const d = ITEMS[id];
  if (!d) return false;
  if (slot === 'head' || slot === 'chest' || slot === 'legs' || slot === 'shoes') return d.slot === slot;
  if (isHandSlot(slot)) return d.kind === 'weapon';
  if (slot === 'back') return d.kind === 'pack';
  if (slot === 'belt1' || slot === 'belt2') return d.kind === 'small';
  if (isPackSlot(slot)) return d.kind !== 'pack' && packIndex(slot) < packCapacity(gear);
  return false;
}

/** The rules a whole loadout has to obey; returns what is wrong with it, or null. */
export function gearProblem(gear: Gear): string | null {
  if (isTwoHanded(gear.rightHand) && gear.leftHand) return 'A two-handed weapon needs the left hand free.';
  if (isTwoHanded(gear.leftHand)) return 'A two-handed weapon goes in the right hand.';
  const cap = packCapacity(gear);
  for (const s of Object.keys(gear)) if (isPackSlot(s) && packIndex(s) >= cap) return 'Empty the pack first.';
  return null;
}

export type GearLoc = { slot: string } | { ground: number };
export interface MoveResult {
  ok: boolean;
  error?: string;
}
const bad = (error: string): MoveResult => ({ ok: false, error });

/**
 * Move one item between a slot and a slot, or between a slot and a list lying around (the ground, a stash, a body).
 * A two-hander dropped on either hand goes to the right. If the destination is occupied the two swap, provided the
 * other item fits where this one came from. Nothing changes unless the whole move is legal.
 */
export function moveItem(gear: Gear, list: ItemId[], from: GearLoc, to: GearLoc): MoveResult {
  const g: Gear = { ...gear };
  const l = [...list];
  const id = 'slot' in from ? g[from.slot] : l[from.ground];
  if (!id) return bad('Nothing there.');
  const d = ITEMS[id];
  if (!d) return bad('Unknown item.');

  if ('ground' in to) {
    if ('ground' in from) return { ok: true };
    delete g[from.slot];
    l.push(id);
  } else {
    let dest = to.slot;
    if (isHandSlot(dest) && isTwoHanded(id)) dest = 'rightHand';
    if ('slot' in from && from.slot === dest) return { ok: true };
    if (!slotAccepts(g, dest, id)) return bad(`${d.name} does not go there.`);
    const displaced = g[dest];
    if ('slot' in from) delete g[from.slot];
    else l.splice(from.ground, 1);
    if (displaced) {
      if ('slot' in from) {
        if (!slotAccepts(g, from.slot, displaced)) return bad('Those two cannot swap places.');
        g[from.slot] = displaced;
      } else {
        l.push(displaced);
      }
    }
    g[dest] = id;
  }

  const problem = gearProblem(g);
  if (problem) return bad(problem);
  for (const k of Object.keys(gear)) delete gear[k];
  Object.assign(gear, g);
  list.length = 0;
  list.push(...l);
  return { ok: true };
}

/** Slots an item would naturally go to, best first. */
function naturalSlots(gear: Gear, id: ItemId): string[] {
  const d = ITEMS[id];
  if (!d) return [];
  if (d.kind === 'weapon') {
    if (isTwoHanded(id)) return ['rightHand'];
    return gear.rightHand ? (gear.leftHand ? ['rightHand'] : ['leftHand']) : ['rightHand', 'leftHand'];
  }
  if (d.kind === 'small') return ['belt1', 'belt2'];
  if (d.kind === 'armor' || d.kind === 'pack') return d.slot ? [d.slot] : [];
  return [];
}

/**
 * Double-click: an item lying around or in the pack goes where it is worn (swapping out what is there);
 * a worn item goes to the first free pack slot, or onto the ground.
 */
export function quickMove(gear: Gear, list: ItemId[], from: GearLoc): MoveResult {
  const id = 'slot' in from ? gear[from.slot] : list[from.ground];
  if (!id) return bad('Nothing there.');
  const equipped = 'slot' in from && !isPackSlot(from.slot);
  if (equipped) {
    for (let i = 0; i < packCapacity(gear); i++) {
      const slot = `pack${i}`;
      if (!gear[slot] && slotAccepts(gear, slot, id)) {
        const r = moveItem(gear, list, from, { slot });
        if (r.ok) return r;
      }
    }
    return moveItem(gear, list, from, { ground: 0 });
  }
  let last = bad('Nowhere to put that.');
  const slots = naturalSlots(gear, id);
  // an empty slot first, then swapping with what is there
  for (const empty of [true, false]) {
    for (const slot of slots) {
      if (empty !== !gear[slot]) continue;
      const r = moveItem(gear, list, from, { slot });
      if (r.ok) return r;
      last = r;
    }
  }
  // small items and remains with no home slot: into the pack
  if (!('slot' in from && isPackSlot(from.slot))) {
    for (let i = 0; i < packCapacity(gear); i++) {
      const slot = `pack${i}`;
      if (!gear[slot]) {
        const r = moveItem(gear, list, from, { slot });
        if (r.ok) return r;
      }
    }
  }
  return last;
}

/** The slot an item is in, if it is in any of this gear's slots. */
export const slotHolding = (gear: Gear, id: ItemId): string | null => slotsOf(gear).find((s) => gear[s] === id) ?? null;

// ---------- who starts with what ----------

/** A new party member's kit: their class weapon, school clothes (no stat effect), a bandage; the leader has a school bag too. */
export function startingGear(weaponId: string, protagonist: boolean): Gear {
  const g: Gear = { rightHand: weaponId in ITEMS ? weaponId : 'slingshot', chest: 'uniform', legs: 'trousers', shoes: 'sneakers', belt1: 'bandage' };
  if (protagonist) g.back = 'schoolbag';
  return g;
}

const RIVAL_POOLS: Record<'head' | 'chest' | 'legs' | 'shoes', ItemId[]> = {
  head: ['cap', 'helmet'],
  chest: ['uniform', 'hoodie', 'letterman', 'lifejacket'],
  legs: ['trousers', 'shinguards'],
  shoes: ['sneakers', 'boots', 'runners'],
};
const RIVAL_SMALL: ItemId[] = ['bandage', 'energybar', 'waterbottle', 'firecracker'];

/** A rival's gear: their weapon always, other pieces by chance, better pieces more likely at higher difficulty. Seeded. */
export function rivalGear(weaponId: string, difficulty: number, rng: RngHolder): Gear {
  const g: Gear = { rightHand: weaponId in ITEMS ? weaponId : 'slingshot' };
  const diff = Math.max(1, Math.min(4, difficulty));
  const pick = <T>(xs: readonly T[], reach: number): T => xs[Math.min(xs.length - 1, Math.floor(rand(rng) * Math.max(1, Math.min(xs.length, reach))))];
  for (const slot of ['head', 'chest', 'legs', 'shoes'] as const) {
    if (rand(rng) < 0.3 + diff * 0.1) g[slot] = pick(RIVAL_POOLS[slot], 1 + diff);
  }
  if (rand(rng) < 0.55) g.belt1 = pick(RIVAL_SMALL, RIVAL_SMALL.length);
  if (rand(rng) < 0.25) g.belt2 = pick(RIVAL_SMALL, RIVAL_SMALL.length);
  if (rand(rng) < 0.12 + diff * 0.04) {
    g.back = 'schoolbag';
    if (rand(rng) < 0.6) g.pack0 = pick(RIVAL_SMALL, RIVAL_SMALL.length);
  }
  const bad = gearProblem(g);
  if (bad) delete g.leftHand;
  return g;
}

/** The item a stock weapon corresponds to (the item id is the WEAPONS key), if the weapon has one. */
export function itemForWeapon(w: Weapon): ItemId | null {
  const key = (Object.keys(WEAPONS) as Array<keyof typeof WEAPONS>).find((k) => WEAPONS[k].name === w.name);
  return key && key in ITEMS ? key : null;
}

/** Gear for a unit that only has a weapon (the sandbox squad, tests): that weapon in the right hand, if it has an item. */
export function gearForWeapon(w: Weapon): Gear {
  const id = itemForWeapon(w);
  return id ? { rightHand: id } : {};
}
