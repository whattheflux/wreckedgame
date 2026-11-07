import {
  CLASSES,
  CLIQUES,
  FIELD_SIZE,
  INJURIES,
  SCENARIOS,
  TRAITS,
  applyBattleResult,
  bodiesAt,
  gearOf,
  lootAt,
  moveGear,
  moveItem,
  wieldProblem,
  quickMove,
  quickMoveGear,
  spriteKey,
  weaponOf,
  computeShot,
  createBattle,
  deployRoster,
  effectiveStats,
  gameOverReason,
  xpToNext,
  encounterScenario,
  endTurn,
  enemyStep,
  getHint,
  getUnit,
  living,
  moveUnit,
  playerTurnOver,
  reachableFor,
  reload,
  revivableBy,
  reviveUnit,
  setOverwatch,
  shoot,
  skillsOf,
  unitAt,
  visibleTiles,
  type ActionResult,
  type BattleEvent,
  type GameOver,
  type Outcome,
  type GameState,
  type PlayerChoice,
  type Pos,
  type RosterMember,
  STATUSES,
  canUseSkills,
  statusLine,
  type Scenario,
  type Unit,
  pendingCount,
  ATTRS,
  ATTR_IDS,
  COMBAT_SKILLS,
  COMBAT_SKILL_IDS,
  combatSpent,
  migrateRoster,
  grantXp,
  XP_SITE_BASE,
  XP_SITE_PER_DIFFICULTY,
  XP_DISCOVERY,
  PERKS,
  skillBlock,
  useSkill,
  usesLeft,
  EXTRA_SKILLS,
  type Skill,
} from './engine';
import { rand } from './engine/rng';
import { esc, hideOverlay, overlayOpen, showCreate, showPrep, showTitle } from './ui/screens';
import { attackTip, handsHtml, moveTip, skillTip, tipHtml, type Tip } from './ui/actionbar';
import { showInventory, showSpoils, type InvView } from './ui/inventory';
import { collectSpoils, ensureStores, resolveSpoils } from './world/spoils';
import { morning, rollAmbush } from './world/camp';
import { showCamp } from './ui/camp';
import { showLevelUp } from './ui/levelup';
import { showSettlement, settlementSummary } from './ui/settlement';
import {
  SETTLEMENTS,
  SITE_CLEAR_STANDING,
  addStanding,
  ensureSettlement,
  isSettlement,
  refreshSettlement,
  restBonusOf,
  visitedSettlements,
  type SettlementState,
} from './world/settlement';
import { recordClear, recordKills, recordWin, type Mission } from './world/missions';
import { clearSave, loadGame, saveGame } from './world/save';
import { BoardRenderer, type ViewState } from './render/board';
import { koUrl, preloadArt, spriteUrl } from './render/sprites';
import { preloadTerrain } from './render/terrain';
import { WorldRenderer, type WorldView } from './world/render';
import {
  WORLD,
  createWorld,
  regionAt,
  siteById,
  siteNear,
  stepWorld,
  walkTo,
  type Region,
  type Site,
} from './world/world';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const worldCanvas = document.getElementById('world') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const actions = document.getElementById('actions') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;
const camctl = document.getElementById('camctl') as HTMLDivElement;
const barEl = document.getElementById('bar') as HTMLDivElement;
const handsEl = document.getElementById('hands') as HTMLDivElement;
const barBtnsEl = document.getElementById('barbtns') as HTMLDivElement;
const tipEl = document.getElementById('tip') as HTMLDivElement;
const rosterEl = document.getElementById('roster') as HTMLDivElement;
const renderer = new BoardRenderer(canvas);
// The squad's art is tiny next to a battle's worth of rivals: have it ready before the first fight.
void preloadArt(['pc-male', 'pc-female', 'amy', 'scott', 'tyson', 'anna']);
const worldRenderer = new WorldRenderer(worldCanvas);

const params = new URLSearchParams(location.search);
const worldSeed = Number(params.get('seed')) || Date.now() & 0x7fffffff;

// ---------- top-level game state ----------

type Mode = 'world' | 'battle';
let mode: Mode = 'world';
const world = createWorld(worldSeed);

/** Replace the world's contents in place (the rest of the file holds one reference to it). */
function resetWorld(next: typeof world): void {
  for (const k of Object.keys(world)) delete (world as unknown as Record<string, unknown>)[k];
  Object.assign(world, next);
}
const worldView: WorldView = { hover: null, debug: false };

/** What the current battle is for, and what happens when it ends. */
interface BattleCtx {
  label: string;
  /** site being assaulted; cleared on victory */
  site: Site | null;
  /** scrap awarded on victory */
  reward: number;
  /** dev sandbox battle: no consequences, restart/next-map available */
  sandbox: boolean;
  /** a night attack on camp: the enemy starts awake and close */
  ambush?: boolean;
  /** the word flashed when the fight starts: Ambush, Assault, Skirmish */
  banner?: string;
}

/** Set while a night ambush is being fought: when it ends, morning comes. */
let pendingNight: { watch?: string } | null = null;
let battleCtx: BattleCtx | null = null;

/** Set once the run is lost (the player character fell, or nobody is left); play stops and only "New game" works. */
let over: GameOver | null = null;

let scenarioIndex = 0;
let state: GameState = createBattle(SCENARIOS[scenarioIndex]);
let busy = false;
let logIndex = 0;
const view: ViewState = {
  selectedId: null,
  mode: 'move',
  hover: null,
  reach: null,
  preview: null,
  previewTargetId: null,
  visible: null,
  hint: null,
};

/** True if one of your units currently has this tile in sight. */
const seen = (p: Pos): boolean => view.visible?.[p.y]?.[p.x] ?? false;

/** An enemy you can't currently see doesn't exist as far as clicking and hovering go. */
function visibleUnitAt(x: number, y: number): Unit | undefined {
  const u = unitAt(state, x, y);
  if (!u) return undefined;
  return u.team === 'player' || seen(u.pos) ? u : undefined;
}

// ---------- helpers ----------

const selected = (): Unit | undefined => {
  const u = view.selectedId ? getUnit(state, view.selectedId) : undefined;
  return u && u.alive ? u : undefined;
};

// ---------- banners: how a fight opens and how it ends ----------

const bannerEl = document.getElementById('banner') as HTMLDivElement;
let bannerTimer = 0;
let endBannerQueued = false;

function esc2(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** A big word across the board that fades after a moment: Ambush, Assault... */
function showBanner(word: string, sub: string): void {
  window.clearTimeout(bannerTimer);
  bannerEl.className = 'start';
  bannerEl.innerHTML = `<div class="word">${esc2(word)}</div><div class="subtitle">${esc2(sub)}</div>`;
  bannerEl.hidden = false;
  bannerTimer = window.setTimeout(() => {
    if (bannerEl.className === 'start') bannerEl.hidden = true;
  }, 2200);
}

function hideEndBanner(): void {
  endBannerQueued = false;
  window.clearTimeout(bannerTimer);
  bannerEl.hidden = true;
  bannerEl.innerHTML = '';
}

/** The fight is decided: Victory or Defeat, with what to do next (Loot or Leave after a win). Shown once. */
function showEndBanner(): void {
  if (!state.winner || mode !== 'battle') return;
  const won = state.winner === 'player';
  const ctx = battleCtx;
  window.clearTimeout(bannerTimer);
  let sub = '';
  let buttons = '';
  if (ctx?.sandbox) {
    sub = 'Sandbox: nothing carries over.';
    buttons = '<button data-end="restart" class="primary">Restart</button><button data-end="next">Next map</button>';
  } else if (won) {
    const spoils = collectSpoils(state);
    const hasSpoils = spoils.loot.length > 0 || spoils.prisoners.length > 0;
    sub = hasSpoils
      ? `${spoils.loot.length} item${spoils.loot.length === 1 ? '' : 's'} on the field${spoils.prisoners.length ? `, ${spoils.prisoners.length} rival${spoils.prisoners.length === 1 ? '' : 's'} out cold` : ''}.`
      : 'Nothing left on the field.';
    buttons = hasSpoils
      ? '<button data-end="loot" class="primary">Loot (Enter)</button><button data-end="leave" title="Leave the loot where it lies. Anyone out cold is let go.">Leave</button>'
      : '<button data-end="loot" class="primary">Continue (Enter)</button>';
  } else {
    sub = state.units.some((u) => u.team === 'player' && u.protagonist && !u.alive && !u.downed) ? 'Your leader has fallen.' : 'The squad is down.';
    buttons = '<button data-end="loot" class="primary">Continue (Enter)</button>';
  }
  bannerEl.className = `end ${won ? 'win' : 'loss'}`;
  bannerEl.innerHTML = `<div class="word">${won ? 'Victory' : 'Defeat'}</div><div class="subtitle">${esc2(sub)}</div><div class="choices">${buttons}</div>`;
  bannerEl.hidden = false;
}

bannerEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-end]');
  if (!b) return;
  const what = b.dataset.end;
  if (what === 'restart') restart();
  else if (what === 'next') restart(true);
  else if (what === 'leave') finishBattle({ leave: true });
  else finishBattle();
});

const canAct = (): boolean => mode === 'battle' && !busy && !state.winner && state.active === 'player';

function toast(text: string): void {
  const d = document.createElement('div');
  d.className = 'sys';
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function flushLog(): void {
  for (; logIndex < state.log.length; logIndex++) {
    const e = state.log[logIndex];
    // Enemy activity out in the fog stays out of the log.
    if (e.team === 'enemy' && e.at && !e.at.some(seen)) continue;
    const d = document.createElement('div');
    d.className = e.team === 'sys' ? 'sys' : e.team;
    d.textContent = e.text;
    logEl.appendChild(d);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

/** Play the visuals for a batch of events. Returns how long (ms) any walking takes, so the caller can wait for it. */
function playEffects(events: BattleEvent[]): number {
  let walkMs = 0;
  // Visibility is refreshed first so a pod that just woke is already drawn when its flash appears.
  view.visible = visibleTiles(state);
  for (const ev of events) {
    if (ev.type === 'move') {
      const last = ev.path[ev.path.length - 1];
      if (last) renderer.face(ev.unitId, ev.path.length > 1 ? ev.path[ev.path.length - 2] : ev.from, last);
      // Walk it square by square, unless it all happened out of sight.
      if (last && (seen(ev.from) || seen(last))) {
        const mover = getUnit(state, ev.unitId);
        walkMs = Math.max(walkMs, renderer.walk(ev.unitId, ev.from, ev.path, mover?.team === 'enemy' ? WALK_MS_ENEMY : WALK_MS_PLAYER));
      }
      continue;
    }
    if (ev.type === 'reveal') {
      const first = getUnit(state, ev.unitIds[0]);
      if (first) renderer.addTextEffect(first.pos, 'CONTACT!', '#ffb347', 1800);
      continue;
    }
    if (ev.type === 'revive') {
      const t = getUnit(state, ev.targetId);
      if (t) renderer.addTextEffect(t.pos, 'BACK UP', '#6fcf7a', 1800);
      continue;
    }
    if (ev.type === 'skill') {
      const u = getUnit(state, ev.unitId);
      const t = ev.targetId ? getUnit(state, ev.targetId) : u;
      const label = ev.skillId === 'incognito' ? 'INCOGNITO' : ev.skillId === 'patchUp' ? 'PATCHED UP' : ev.ok ? 'CHARMED!' : 'NOT BUYING IT';
      const color = ev.ok ? '#8ad0c0' : '#9aa7b3';
      if (t && (seen(t.pos) || u?.team === 'player')) renderer.addTextEffect(t.pos, label, color, 1800);
      continue;
    }
    if (ev.type === 'tick') {
      const t = getUnit(state, ev.unitId);
      if (t && seen(t.pos)) renderer.addTextEffect(t.pos, `-${ev.damage} ${STATUSES[ev.effect].name.toLowerCase()}`, STATUSES[ev.effect].color, 1600);
      continue;
    }
    if (ev.type !== 'shoot') continue;
    const a = getUnit(state, ev.attackerId);
    const t = getUnit(state, ev.targetId);
    if (!a || !t) continue;
    renderer.face(a.id, a.pos, t.pos);
    if (!seen(a.pos) && !seen(t.pos)) continue; // happened in the fog
    const text = ev.hit ? `${ev.crit ? 'CRIT ' : ''}-${ev.damage}` : 'MISS';
    renderer.addShotEffect(a.pos, t.pos, ev.hit, text, ev.crit);
    if (ev.downed) renderer.addTextEffect(t.pos, 'DOWN!', '#e0674e', 2200);
    if (ev.opportunity) renderer.addTextEffect(a.pos, 'PARTING BLOW', '#ffb347', 1400);
    for (const i of ev.inflicted ?? []) renderer.addTextEffect(t.pos, STATUSES[i].name.toUpperCase() + '!', STATUSES[i].color, 1800);
    if (ev.broke) renderer.addTextEffect(a.pos, `${ev.weaponName ?? 'WEAPON'} BREAKS!`.toUpperCase(), '#c9a27a', 2000);
  }
  return walkMs;
}

/** Time per square when a unit walks. Rivals go a little slower so you can follow what they are doing. */
const WALK_MS_PLAYER = 120;
const WALK_MS_ENEMY = 160;

function select(id: string | null, snap = false): void {
  view.selectedId = id;
  view.mode = 'move';
  clearAim();
  focusSelected(snap);
  refresh();
}

/** Ease the camera onto the selected unit (no-op with nothing selected). */
function focusSelected(snap = false): void {
  const u = selected();
  if (u) renderer.focus(u.pos, snap);
}

/** Tab / Shift+Tab: step through the whole squad in roster order, spent units included. */
function selectNext(step = 1): void {
  const squad = living(state, 'player');
  if (squad.length === 0) return;
  const cur = squad.findIndex((u) => u.id === view.selectedId);
  const i = cur < 0 ? (step > 0 ? 0 : squad.length - 1) : (cur + step + squad.length) % squad.length;
  select(squad[i].id);
}

// ---------- squad bar (left side) ----------

let squadSig = '';

function renderRoster(): void {
  const squad = state.units.filter((u) => u.team === 'player' && (u.alive || u.downed));
  const sig = squad.map((u) => `${u.id}:${u.hp}:${u.ap}:${u.alive ? 1 : 0}:${u.id === view.selectedId ? 1 : 0}`).join('|');
  if (sig === squadSig) return;
  squadSig = sig;
  rosterEl.innerHTML = squad
    .map((u, n) => {
      const down = !u.alive;
      const key = u.sprite ?? u.name.toLowerCase();
      const url = down ? (koUrl(key) ?? spriteUrl(key, 'down')) : spriteUrl(key, 'down');
      const face = url ? `<img src="${url}" alt="">` : `<div class="ph">${esc(u.name.slice(0, 1))}</div>`;
      const pct = Math.max(0, Math.round((u.hp / u.maxHp) * 100));
      const pips = Array.from({ length: u.maxAp }, (_, i) => `<b class="${i < u.ap ? 'on' : ''}"></b>`).join('');
      const cls = ['rc', u.id === view.selectedId ? 'sel' : '', down ? 'down' : '', !down && u.ap <= 0 ? 'spent' : ''].join(' ');
      return (
        `<div class="${cls}" data-id="${esc(u.id)}" title="${esc(u.name)} (${esc(u.role)})">` +
        `<span class="key">${n + 1}</span><div class="face">${face}</div><div class="nm">${esc(u.name)}</div>` +
        (down
          ? `<div class="tag">DOWN</div>`
          : `<div class="bar"><i class="${pct <= 33 ? 'low' : ''}" style="width:${pct}%"></i></div><div class="pips">${pips}</div>`) +
        `</div>`
      );
    })
    .join('');
}

// ---------- camera controls ----------

function cameraCmd(cmd: string): void {
  if (cmd === 'cw') renderer.rotate(1);
  else if (cmd === 'ccw') renderer.rotate(-1);
  else if (cmd === 'in') renderer.zoomBy(1.25);
  else if (cmd === 'out') renderer.zoomBy(1 / 1.25);
  else if (cmd === 'fit') {
    renderer.toggleZoom();
    focusSelected();
  }
  lastWorldSig = '';
}

camctl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-cam]');
  if (b) cameraCmd(b.dataset.cam ?? '');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  },
  { passive: false },
);

rosterEl.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.rc');
  if (!card || mode !== 'battle' || overlayOpen()) return;
  const u = getUnit(state, card.dataset.id ?? '');
  if (!u) return;
  if (u.alive && canAct()) select(u.id);
  else renderer.focus(u.pos); // a downed friend or mid-enemy-turn: just look
});

// ---------- buttons (rebuilt per mode) ----------

interface Btn {
  label: string;
  key: string;
  run: () => void;
  enabled: (s: Unit | undefined) => boolean;
  active?: () => boolean;
  /** Shown in the action bar under the map ('main' = Move / Basic Attack, 'skill' = one per skill) instead of the side panel. */
  bar?: 'main' | 'skill';
  /** Bar caption (the label without its key hint). */
  name?: string;
  /** For 'skill' buttons: the skill id; the button only works for units that have the skill. */
  skillId?: string;
  /** Hover text for bar buttons. */
  tip?: (s: Unit | undefined) => Tip;
}

let currentButtons: Btn[] = [];
let buttonEls: Array<HTMLButtonElement | null> = [];

/** Whether the button can be used right now, skill ownership included. */
const usable = (b: Btn, s: Unit | undefined): boolean =>
  (!b.skillId || skillsOf(s).some((k) => k.id === b.skillId)) && b.enabled(s);

function setButtons(list: Btn[]): void {
  currentButtons = list;
  actions.innerHTML = '';
  barSig = '';
  buttonEls = list.map((b) => {
    if (b.bar) return null; // lives in the action bar
    const el = document.createElement('button');
    el.textContent = b.label;
    el.addEventListener('click', b.run);
    actions.appendChild(el);
    return el;
  });
}

function renderActions(sel: Unit | undefined): void {
  currentButtons.forEach((b, i) => {
    const el = buttonEls[i];
    if (!el) return;
    el.disabled = !usable(b, sel);
    el.classList.toggle('active', b.active?.() ?? false);
  });
  if (mode === 'battle') renderBar(sel);
}

// ---------- action bar: weapon in hand, Move, Basic Attack, then one button per skill ----------

let barSig = '';
let barShown: Array<{ b: Btn; el: HTMLButtonElement }> = [];

function renderBar(sel: Unit | undefined): void {
  const skills = skillsOf(sel);
  const sig = `${sel?.id ?? ''}|${sel?.weapon.name ?? ''}|${JSON.stringify(sel?.gear ?? {})}|${skills.map((k) => k.id).join(',')}`;
  if (sig !== barSig) {
    barSig = sig;
    handsEl.innerHTML = sel ? handsHtml(sel.weapon, sel.gear) : '';
    barBtnsEl.innerHTML = '';
    const shown = [
      ...currentButtons.filter((b) => b.bar === 'main'),
      ...skills.flatMap((k) => currentButtons.filter((b) => b.bar === 'skill' && b.skillId === k.id)),
    ];
    barShown = shown.map((b) => {
      const el = document.createElement('button');
      el.className = `abtn ${b.bar === 'main' ? 'main' : 'skill'}`;
      el.innerHTML = `<span>${esc(b.name ?? b.label)}</span><kbd>${esc(b.key.toUpperCase())}</kbd>`;
      el.addEventListener('click', () => {
        if (usable(b, selected())) b.run();
      });
      barBtnsEl.appendChild(el);
      return { b, el };
    });
  }
  // aria-disabled rather than disabled: a greyed-out button should still explain itself on hover
  for (const { b, el } of barShown) {
    const ok = usable(b, sel);
    el.classList.toggle('off', !ok);
    el.setAttribute('aria-disabled', String(!ok));
    el.classList.toggle('active', b.active?.() ?? false);
  }
}

barBtnsEl.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.abtn');
  const hit = barShown.find((x) => x.el === el);
  if (!el || !hit?.b.tip) return;
  tipEl.innerHTML = tipHtml(hit.b.tip(selected()));
  tipEl.hidden = false;
  const stage = tipEl.parentElement as HTMLElement;
  const sr = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const half = tipEl.offsetWidth / 2;
  const cx = Math.min(Math.max(r.left + r.width / 2 - sr.left, half + 6), sr.width - half - 6);
  tipEl.style.left = `${cx}px`;
  tipEl.style.bottom = `${sr.bottom - r.top + 8}px`;
});
barBtnsEl.addEventListener('mouseout', (e) => {
  if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.abtn')) tipEl.hidden = true;
});

/** Hover text for a skill button, with why it is greyed out when it is. */
function skillTipFor(id: string): (s: Unit | undefined) => Tip {
  return (s) => {
    const k = skillsOf(s).find((x) => x.id === id);
    const t = k ? skillTip(k) : { title: id, cost: '', lines: [] };
    if (s && id === 'reload' && s.ammo >= s.weapon.clip) t.lines.push('Already full.');
    if (s && id === 'revive' && revivableBy(state, s).length === 0) t.lines.push('Nobody is down next to you.');
    if (s && id === 'overwatch' && s.weapon.melee) t.lines.push('Melee weapons cannot hold overwatch.');
    else if (s && id === 'overwatch' && s.ammo <= 0) t.lines.push('Out of ammo: reload first.');
    if (s && (id === 'overwatch' || id === 'revive') && !canUseSkills(s)) t.lines.push('Silenced: cannot do this right now.');
    const extra = EXTRA_SKILLS[id];
    if (s && extra) {
      if (extra.perBattle !== undefined) t.lines.push(`Left this battle: ${Math.max(0, usesLeft(s, extra))} of ${extra.perBattle}.`);
      if (id === 'charm') t.lines.push('Chance depends on the target: tougher kids are harder to sweet-talk (about 15-85%).');
      const why = canAct() ? skillBlock(state, s, extra) : null;
      if (why) t.lines.push(`<i>${esc(why)}</i>`);
    }
    return t;
  };
}

function inventoryTip(s: Unit | undefined): Tip {
  const here = s ? lootAt(state, s.pos).length : 0;
  const lines = ['Change what you wear and carry. Armour, belt and pack changes are free; swapping what is in your hands costs 1 AP.'];
  if (here > 0) lines.push(`There ${here === 1 ? 'is 1 item' : `are ${here} items`} on the ground here.`);
  return { title: 'Inventory', cost: 'Free (a new weapon: 1 AP)', lines };
}

interface StatLine {
  hp: number;
  maxHp: number;
  rangedAim: number;
  meleeAim: number;
  rangedDefense: number;
  meleeDefense: number;
  mobility: number;
  crit: number;
}

const unitStats = (s: StatLine): string =>
  `HP ${s.hp}/${s.maxHp} &middot; Move ${s.mobility} &middot; Crit ${s.crit}%<br>` +
  `Ranged ${s.rangedAim}/${s.rangedDefense} &middot; Melee ${s.meleeAim}/${s.meleeDefense} <span style="opacity:.6">(attack/defense)</span>`;

const weaponLine = (w: Unit['weapon'], ammo?: number): string =>
  `${w.name}: ${w.damage[0]}-${w.damage[1]} dmg, range ${w.range}, ${w.hands}-handed, ${w.heavy ? 'heavy' : 'light'}${ammo === undefined ? '' : `, ammo ${ammo}/${w.clip}`}`;

function unitView(u: Unit): InvView {
  return {
    name: u.name,
    role: u.role,
    sprite: u.sprite ?? u.name.toLowerCase(),
    gear: u.gear ?? {},
    stats: unitStats({ hp: u.hp, maxHp: u.maxHp, rangedAim: u.aim, meleeAim: u.meleeAim ?? u.aim, rangedDefense: u.defense, meleeDefense: u.meleeDefense ?? u.defense, mobility: u.mobility, crit: u.critChance }),
    weapon: weaponLine(u.weapon, u.ammo),
  };
}

/** I in a fight: the selected unit's gear, plus whatever lies on their tile (a fallen rival's loot). */
function openBattleInventory(): void {
  const sel = selected();
  if (!sel || !canAct() || mode !== 'battle') return;
  const u = (id: string): Unit => getUnit(state, id) as Unit;
  showInventory({
    title: 'Inventory',
    note: () => `${u(sel.id).name} has ${u(sel.id).ap} AP. Swapping what is in your hands costs 1 AP; everything else is free.`,
    people: living(state, 'player').map((x) => ({ id: x.id, name: x.name })),
    current: sel.id,
    view: (id) => unitView(u(id)),
    listTitle: 'On the ground here',
    list: (id) => lootAt(state, u(id).pos),
    bodies: (id) => bodiesAt(state, u(id).pos).map((b) => `${b.name}: ${b.fate === 'unconscious' ? 'out cold' : b.fate === 'dead' ? 'dead' : 'down'}`),
    move: (id, from, to) => moveGear(state, u(id), from, to),
    quick: (id, from) => quickMoveGear(state, u(id), from),
    onClose: () => refresh(),
  });
}

/** I on the map: every living member's gear, and the party stash to swap with. */
function openWorldInventory(after?: () => void): void {
  if (mode !== 'world' || over) return;
  const stash = ensureStores(world).stash;
  const live = world.roster.filter((m) => !m.dead);
  const member = (id: string): RosterMember => live.find((m) => m.id === id) ?? live[0];
  const settle = (m: RosterMember): void => {
    m.hp = Math.min(m.hp, effectiveStats(m).hp); // taking off a bonus can lower the cap
  };
  /** Run a gear change, undoing it if the member cannot manage the result (a two-hander with one hand). */
  const guarded = (m: RosterMember, run: () => { ok: boolean; error?: string }): { ok: boolean; error?: string } => {
    const g0 = { ...gearOf(m) };
    const s0 = [...stash];
    const r = run();
    const problem = r.ok ? wieldProblem(m, gearOf(m)) : null;
    if (problem) {
      const g = gearOf(m);
      for (const k of Object.keys(g)) delete g[k];
      Object.assign(g, g0);
      stash.length = 0;
      stash.push(...s0);
      return { ok: false, error: problem };
    }
    settle(m);
    return r;
  };
  showInventory({
    title: 'Inventory',
    note: () => 'Gear changes are free out here. Anything not worn or carried goes in the party stash.',
    people: live.map((m) => ({ id: m.id, name: m.name })),
    current: (live.find((m) => m.protagonist) ?? live[0]).id,
    view: (id) => {
      const m = member(id);
      const s = effectiveStats(m);
      const w = weaponOf(m);
      return {
        name: m.name,
        role: `${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} Lv ${m.level}`,
        sprite: spriteKey(m),
        gear: gearOf(m),
        stats:
          unitStats({ hp: m.hp, maxHp: s.hp, rangedAim: s.rangedAim, meleeAim: s.meleeAim, rangedDefense: s.rangedDefense, meleeDefense: s.meleeDefense, mobility: s.mobility, crit: s.crit }) +
          `<br><span style="opacity:.75">${ATTR_IDS.map((id) => `<b title="${esc(ATTRS[id].label)}">${ATTRS[id].letter}</b> ${m.attributes[id]}`).join(' ')} &middot; Sight ${s.sight}</span>` +
          (combatSpent(m.combat)
            ? `<br><span style="opacity:.75">Trained: ${COMBAT_SKILL_IDS.filter((id) => m.combat[id]).map((id) => `${COMBAT_SKILLS[id].label} ${m.combat[id]}`).join(', ')}</span>`
            : '') +
          `<br><span style="opacity:.75">${m.perks.map((id) => esc(PERKS[id]?.name ?? id)).join(', ')}</span>` +
          (m.pending.length ? `<br><b style="color:#e8b04a">${m.pending.length} level-up choice${m.pending.length === 1 ? '' : 's'} to spend (U on the map)</b>` : ''),
        weapon: weaponLine(w),
      };
    },
    listTitle: 'Party stash',
    list: () => stash,
    move: (id, from, to) => guarded(member(id), () => moveItem(gearOf(member(id)), stash, from, to)),
    quick: (id, from) => guarded(member(id), () => quickMove(gearOf(member(id)), stash, from)),
    onClose: () => {
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
      after?.();
    },
  });
}

const battleButtons: Btn[] = [
  { label: 'Move (M)', name: 'Move', bar: 'main', tip: moveTip, key: 'm', run: () => setAimMode('move'), enabled: (s) => canAct() && !!s && s.ap > 0, active: () => view.mode === 'move' },
  { label: 'Basic Attack (F)', name: 'Basic Attack', bar: 'main', tip: attackTip, key: 'f', run: () => setAimMode('shoot'), enabled: (s) => canAct() && !!s && s.ap > 0 && (!!s.weapon.melee || s.ammo > 0), active: () => view.mode === 'shoot' && !aimSkill },
  { label: 'Overwatch (O)', name: 'Overwatch', bar: 'skill', skillId: 'overwatch', tip: skillTipFor('overwatch'), key: 'o', run: () => act(setOverwatch(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo > 0 && !s.weapon.melee && canUseSkills(s) },
  { label: 'Revive (V)', name: 'Revive', bar: 'skill', skillId: 'revive', tip: skillTipFor('revive'), key: 'v', run: () => reviveAdjacent(), enabled: (s) => canAct() && !!s && s.ap > 0 && canUseSkills(s) && revivableBy(state, s).length > 0 },
  { label: 'Reload (R)', name: 'Reload', bar: 'skill', skillId: 'reload', tip: skillTipFor('reload'), key: 'r', run: () => act(reload(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo < s.weapon.clip },
  ...Object.keys(EXTRA_SKILLS).map(skillButton),
  { label: 'Inventory (I)', name: 'Inventory', bar: 'main', tip: inventoryTip, key: 'i', run: () => openBattleInventory(), enabled: (s) => canAct() && !!s },
  { label: 'End turn (E)', key: 'e', run: () => startEnemyPhase(), enabled: () => canAct() },
  { label: 'Continue (Enter)', key: 'enter', run: () => finishBattle(), enabled: () => !!state.winner && !busy && !battleCtx?.sandbox },
  { label: 'Retreat (W)', key: 'w', run: () => retreat(), enabled: () => !busy && (!state.winner || !!battleCtx?.sandbox) },
  { label: 'Restart (N)', key: 'n', run: () => restart(), enabled: () => !!battleCtx?.sandbox },
  { label: 'Next map (X)', key: 'x', run: () => restart(true), enabled: () => !!battleCtx?.sandbox },
];

const worldButtons: Btn[] = [
  { label: 'Enter site (E)', key: 'e', run: () => enterSite(siteNear(world.pos)), enabled: () => !!siteNear(world.pos) },
  { label: 'Make camp (C)', key: 'c', run: () => openCamp(isSettlement(siteNear(world.pos))), enabled: () => !over },
  { label: 'Settlement (T)', key: 't', run: () => openSettlement(), enabled: () => !over && isSettlement(siteNear(world.pos)) },
  { label: 'Level up (U)', key: 'u', run: () => offerLevelUps(), enabled: () => !over && pendingCount(world.roster) > 0 },
  { label: 'Inventory (I)', key: 'i', run: () => openWorldInventory(), enabled: () => !over },
  { label: 'Debug overlay (G)', key: 'g', run: () => (worldView.debug = !worldView.debug), enabled: () => true, active: () => worldView.debug },
  { label: 'Sandbox: Beach (B)', key: 'b', run: () => startSandbox(0), enabled: () => true },
  { label: 'Sandbox: Jungle (J)', key: 'j', run: () => startSandbox(1), enabled: () => true },
];

const gameOverButtons: Btn[] = [
  { label: 'Load last save (L)', key: 'l', run: () => loadLastSave(), enabled: () => !!loadGame() },
  { label: 'New game (N)', key: 'n', run: () => startNewGame(), enabled: () => true },
];

// ---------- battle refresh: derive all view data from state ----------

function refresh(): void {
  if (mode !== 'battle') return;
  if (state.winner && !endBannerQueued && !busy) {
    endBannerQueued = true;
    window.setTimeout(showEndBanner, 900); // let the last shot land first
  }
  const sel = selected();
  if (view.selectedId && !sel) view.selectedId = null;

  view.reach = sel && sel.ap > 0 && canAct() ? reachableFor(state, sel) : null;
  view.visible = visibleTiles(state);
  view.hint = getHint(state);

  view.preview = null;
  view.previewTargetId = null;
  if (sel && view.hover) {
    const t = visibleUnitAt(view.hover.x, view.hover.y);
    if (t && t.team !== sel.team) {
      view.preview = computeShot(state.map, view.aim ? { ...sel, weapon: view.aim } : sel, sel.pos, t);
      view.previewTargetId = t.id;
    }
  }

  flushLog();
  renderRoster();
  renderPanel(sel);
  renderActions(sel);
}

function renderPanel(sel: Unit | undefined): void {
  const lines: string[] = [];
  const side = state.active === 'player' ? 'Your squad' : 'Rival faction';
  lines.push(`<h2>${state.name} &mdash; Turn ${state.turn}</h2>`);
  if (state.winner) {
    const verdict = state.winner === 'player' ? 'VICTORY' : 'DEFEAT';
    const next = battleCtx?.sandbox ? 'press N to restart' : 'press Enter to return to the map';
    lines.push(`<div><b>${verdict}</b> &mdash; ${next}</div>`);
  } else {
    lines.push(`<div>${side}${busy ? ' (acting...)' : ''}</div>`);
  }

  for (const d of state.units.filter((u) => u.team === 'player' && u.downed && !u.alive)) {
    lines.push(
      `<div style="margin-top:8px;padding:6px 8px;border-left:3px solid #e0674e;background:#2a1a1a;color:#e0674e">` +
        `<b>${esc(d.name)} is down.</b> Move an ally next to ${esc(d.name)} and press V to revive. ` +
        `Going down again means game over.</div>`,
    );
  }

  if (view.hint) {
    const h = view.hint;
    lines.push(
      `<div style="margin-top:8px;padding:6px 8px;border-left:3px solid #e8b04a;background:#1a2530;color:#e8b04a">` +
        `No contact for ${state.turnsSinceContact} turns.<br>` +
        `Hostile group detected to the <b>${h.direction}</b> &mdash; ${h.band}, roughly ${h.distance} tiles.</div>`,
    );
  }

  if (sel) {
    const member = battleCtx && !battleCtx.sandbox && sel.team === 'player' ? world.roster.find((r) => r.id === sel.id) : undefined;
    lines.push(
      `<div style="margin-top:8px"><b>${esc(sel.name)}</b> <span style="opacity:.7">${sel.role}${member ? ` Lv ${member.level}` : ''}</span><br>` +
        `HP ${sel.hp}/${sel.maxHp} &middot; AP ${sel.ap}/${sel.maxAp}${sel.weapon.melee ? '' : ` &middot; Ammo ${sel.ammo}/${sel.weapon.clip}`}<br>` +
        (sel.weapon.melee
          ? `${sel.weapon.name} ${sel.weapon.damage[0]}-${sel.weapon.damage[1]} dmg, adjacent only<br>`
          : `${sel.weapon.name} ${sel.weapon.damage[0]}-${sel.weapon.damage[1]} dmg, range ${sel.weapon.range} (full accuracy to ${sel.weapon.optimal})<br>`) +
        (sel.status?.length ? `<span style="color:#f2d04a">${esc(statusLine(sel))}</span><br>` : '') +
        `Ranged ${sel.aim}/${sel.defense} &middot; Melee ${sel.meleeAim ?? sel.aim}/${sel.meleeDefense ?? sel.defense} &middot; Move ${sel.mobility}/${sel.mobility * 2}` +
        (member ? memberTags(member) : '') +
        `</div>`,
    );
  } else if (!state.winner) {
    lines.push(`<div style="margin-top:8px;opacity:.7">Click one of your units (blue) to select.</div>`);
  }

  if (view.preview && view.previewTargetId) {
    const t = getUnit(state, view.previewTargetId);
    const pv = view.preview;
    if (t) {
      lines.push(
        `<div style="margin-top:8px;border-top:1px solid #22303c;padding-top:6px"><b>${esc(t.name)}</b> HP ${t.hp}/${t.maxHp}<br>` +
          (pv.canShoot
            ? `Hit ${pv.hitChance}% &middot; Crit ${pv.critChance}% &middot; ${pv.dmgMin}-${pv.dmgMax} dmg<br>` +
              `Range ${pv.distance.toFixed(1)}${pv.rangePenalty ? ` (-${pv.rangePenalty} hit)` : ''} &middot; ` +
              (pv.flanked ? '<b style="color:#ff8a70">FLANKED: a hit always crits</b>' : `Cover: ${pv.cover}${pv.coverPenalty ? ` (-${pv.coverPenalty} hit)` : ''}`)
            : `<span style="opacity:.7">${pv.reason === 'Out of range' ? `Out of range (${pv.distance.toFixed(1)} tiles, max ${pv.range})` : pv.reason}</span>`) +
          `</div>`,
      );
    }
  }

  lines.push(
    `<div style="margin-top:10px;opacity:.55;font-size:11px">Click tile: move &middot; click enemy: attack<br>` +
      `M move &middot; F attack &middot; O overwatch &middot; V revive &middot; R reload &middot; E end turn &middot; Tab next &middot; W retreat` +
      (sel?.skills?.length
        ? `<br>Skills: ${sel.skills.map((id) => `${EXTRA_SKILLS[id]?.key.toUpperCase() ?? '?'} ${EXTRA_SKILLS[id]?.name ?? id}`).join(' &middot; ')}`
        : '') +
      `</div>`,
  );
  panel.innerHTML = lines.join('');
}

/** The aimed skill waiting for a target click (Throw Ball, Acid Beaker, Charm), if any. */
let aimSkill: Skill | null = null;

function clearAim(): void {
  aimSkill = null;
  view.aim = null;
}

function setAimMode(m: 'move' | 'shoot'): void {
  view.mode = m;
  clearAim();
  refresh();
}

/** The weapon an aimed skill is drawn and previewed with: what it throws, or sight-range for a charm. */
const aimWeapon = (k: Skill): Unit['weapon'] => k.throws ?? { name: k.name, damage: [0, 0], range: 7, optimal: 7, aimMod: 0, critMod: 0, clip: 99, hands: 1, heavy: false };

/** Press a class/clique skill: aimed ones wait for a click on an enemy, the rest happen now. */
function runSkill(id: string): void {
  const sel = selected();
  const k = EXTRA_SKILLS[id];
  if (!sel || !k || !canAct()) return;
  const why = skillBlock(state, sel, k);
  if (why) {
    toast(why);
    return;
  }
  if (k.target === 'enemy') {
    if (aimSkill?.id === id) {
      setAimMode('move'); // pressing it again cancels
      return;
    }
    view.mode = 'shoot';
    aimSkill = k;
    view.aim = aimWeapon(k);
    refresh();
    return;
  }
  act(useSkill(state, sel.id, id));
}

/** One action-bar button for a class/clique skill (only shown on units that have it). */
function skillButton(id: string): Btn {
  const k = EXTRA_SKILLS[id];
  return {
    label: `${k.name} (${k.key.toUpperCase()})`,
    name: k.name,
    bar: 'skill',
    skillId: id,
    tip: skillTipFor(id),
    key: k.key,
    run: () => runSkill(id),
    enabled: (s) => canAct() && !!s && skillBlock(state, s, k) === null,
    active: () => aimSkill?.id === id,
  };
}

// ---------- player actions ----------

function reviveAdjacent(): void {
  const sel = selected();
  const target = sel ? revivableBy(state, sel)[0] : undefined;
  if (sel && target) act(reviveUnit(state, sel.id, target.id));
}

function act(res: ActionResult): void {
  if (!res.ok) {
    toast(res.error ?? 'Cannot do that');
    return;
  }
  const walkMs = playEffects(res.events);
  view.mode = 'move';
  clearAim();
  if (walkMs > 0) {
    // Let the walk play out before anything else happens (next unit, enemy phase, win check).
    busy = true;
    refresh();
    window.setTimeout(() => {
      if (mode !== 'battle') return;
      busy = false;
      afterPlayerAction();
    }, walkMs + 60);
    return;
  }
  afterPlayerAction();
}

function afterPlayerAction(): void {
  if (state.winner) {
    refresh();
    return;
  }
  if (playerTurnOver(state)) {
    refresh();
    startEnemyPhase();
    return;
  }
  const sel = selected();
  if (!sel || sel.ap <= 0) {
    const next = living(state, 'player').find((u) => u.ap > 0);
    view.selectedId = next ? next.id : null;
  }
  focusSelected();
  refresh();
}

function onClick(p: Pos): void {
  if (!canAct()) return;
  const fallen = state.units.find((u) => u.downed && !u.alive && u.team === 'player' && u.pos.x === p.x && u.pos.y === p.y);
  const medic = selected();
  if (fallen && medic) {
    // Clicking a downed ally while one of your units stands next to them revives them.
    if (revivableBy(state, medic).includes(fallen)) act(reviveUnit(state, medic.id, fallen.id));
    else toast(`Move next to ${fallen.name} first.`);
    return;
  }
  const clicked = visibleUnitAt(p.x, p.y);
  if (clicked && clicked.team === 'player') {
    select(clicked.id);
    return;
  }
  const sel = selected();
  if (!sel) return;
  if (clicked && clicked.team === 'enemy') {
    act(aimSkill ? useSkill(state, sel.id, aimSkill.id, clicked.id) : shoot(state, sel.id, clicked.id));
    return;
  }
  act(moveUnit(state, sel.id, p));
}

// ---------- enemy phase ----------

function startEnemyPhase(): void {
  if (!canAct()) return;
  busy = true;
  view.selectedId = null;
  endTurn(state);
  refresh();

  const tick = (): void => {
    if (mode !== 'battle') return; // left mid-phase (e.g. debug hook)
    const ev = enemyStep(state);
    if (ev === null) {
      busy = false;
      if (!state.winner) {
        const first = living(state, 'player').find((u) => u.ap > 0);
        view.selectedId = first ? first.id : null;
        focusSelected();
      }
      refresh();
      return;
    }
    const walkMs = playEffects(ev);
    followEnemy(ev);
    refresh();
    window.setTimeout(tick, ev.length > 0 ? Math.max(650, walkMs + 350) : 100);
  };
  window.setTimeout(tick, 450);
}

/** During the rival phase, keep the camera on whoever just acted if we can see them. */
function followEnemy(events: BattleEvent[]): void {
  for (const ev of events) {
    const id = ev.type === 'move' ? ev.unitId : ev.type === 'shoot' ? ev.attackerId : null;
    const u = id ? getUnit(state, id) : undefined;
    if (u && u.team === 'enemy' && seen(u.pos)) {
      renderer.focus(u.pos);
      return;
    }
  }
}

function restart(nextMap = false): void {
  if (nextMap) scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
  beginBattle(SCENARIOS[scenarioIndex], battleCtx ?? { label: SCENARIOS[scenarioIndex].name, site: null, reward: 0, sandbox: true });
}

// ---------- mode switching: world <-> battle ----------

function beginBattle(scenario: Scenario, ctx: BattleCtx): void {
  mode = 'battle';
  battleCtx = ctx;
  // Real fights field the persistent squad; sandbox battles use the stock one and have no consequences.
  state = createBattle(ctx.sandbox ? scenario : deployRoster(scenario, world.roster, world.squad));
  if (ctx.ambush) for (const u of state.units) if (u.team === 'enemy') u.dormant = false;
  // Start fetching everyone's art (and the ground's) right away; units are held back until theirs is in.
  void preloadArt(state.units.map((u) => u.sprite ?? u.name.toLowerCase()));
  void preloadTerrain(state.map.biome);
  busy = false;
  logIndex = 0;
  logEl.innerHTML = '';
  canvas.hidden = false;
  worldCanvas.hidden = true;
  heldKeys.clear();
  renderer.resetFacing();
  view.selectedId = null;
  view.mode = 'move';
  clearAim();
  view.hover = null;
  setButtons(battleButtons);
  const first = living(state, 'player')[0];
  if (first) view.selectedId = first.id;
  squadSig = '';
  rosterEl.hidden = false;
  camctl.hidden = false;
  barEl.hidden = false;
  focusSelected(true);
  toast(ctx.label);
  hideEndBanner();
  showBanner(ctx.banner ?? (ctx.sandbox ? 'Skirmish' : 'Battle'), ctx.label);
  refresh();
}

/** Assaults let you pick who goes (when there is a choice to make); ambushes just use the last squad. */
function beginAssault(scenario: Scenario, ctx: BattleCtx): void {
  const living = world.roster.filter((m) => !m.dead);
  if (ctx.sandbox || living.length <= FIELD_SIZE) {
    beginBattle(scenario, ctx);
    return;
  }
  showPrep(
    ctx.label,
    world.roster,
    world.squad,
    (ids) => {
      world.squad = ids;
      hideOverlay();
      beginBattle(scenario, ctx);
    },
    hideOverlay,
  );
}

function startSandbox(i: number): void {
  scenarioIndex = i;
  beginBattle(SCENARIOS[i], { label: `Sandbox: ${SCENARIOS[i].name}`, site: null, reward: 0, sandbox: true, banner: 'Skirmish' });
}

function worldLog(text: string): void {
  world.log.push(text);
  if (mode === 'world') appendWorldLog(text);
}

function appendWorldLog(text: string): void {
  const d = document.createElement('div');
  d.className = 'sys';
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function enterWorld(): void {
  mode = 'world';
  battleCtx = null;
  busy = false;
  canvas.hidden = true;
  worldCanvas.hidden = false;
  rosterEl.hidden = true;
  camctl.hidden = true;
  barEl.hidden = true;
  tipEl.hidden = true;
  logEl.innerHTML = '';
  for (const t of world.log.slice(-40)) appendWorldLog(t);
  setButtons(over ? gameOverButtons : worldButtons);
  lastWorldSig = '';
  updateWorldPanel();
  // Autosave on every return to the map. Never after game over: the save stays the last good state, so "Load last save" is a real undo.
  if (started && !over) saveGame(world);
}

/** Open the level-up screen if anybody owes a choice. Safe to call whenever we land back on the map. */
function offerLevelUps(): void {
  if (mode !== 'world' || over || overlayOpen() || pendingCount(world.roster) === 0) return;
  showLevelUp({
    roster: world.roster,
    onChange: () => {
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
    },
    onClose: () => {
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
    },
  });
}

/** Back to the map, then straight into any choices that are owed. */
function returnToWorld(): void {
  enterWorld();
  offerLevelUps();
}

/** Experience from something that happened out in the world rather than in a fight. */
function worldXp(amount: number, why: string): void {
  if (amount <= 0 || over) return;
  const notes = grantXp(world.roster, amount, world);
  if (notes.length > 0) worldLog(`${why} (+${amount} XP each)`);
  for (const n of notes) worldLog(n);
}

/** Somewhere new: a region or a site pays once, the first time the party stands in it. */
function noteDiscovery(id: string, name: string): void {
  world.seen ??= {};
  if (world.seen[id]) return;
  world.seen[id] = true;
  worldXp(XP_DISCOVERY, `Found ${name}.`);
}

/** The settlement the party is standing in, if any. */
function settlementHere(): SettlementState | null {
  const site = siteNear(world.pos);
  if (!isSettlement(site) || !site) return null;
  const st = ensureSettlement(world, site.id);
  refreshSettlement(world, st);
  return st;
}

function openSettlement(): void {
  if (mode !== 'world' || over) return;
  const st = settlementHere();
  if (!st) {
    worldLog('No settlement here.');
    return;
  }
  showSettlement({
    world,
    id: st.id,
    onChange: (notes) => {
      for (const n of notes ?? []) worldLog(n);
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
    },
    onInventory: () => openWorldInventory(() => openSettlement()),
    onClose: () => {
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
      offerLevelUps();
    },
  });
}

/** Push something that happened in the world through every settlement's jobs, and log what it finished. */
function advanceMissions(apply: (st: SettlementState) => Mission[]): void {
  for (const st of visitedSettlements(world)) {
    const place = SETTLEMENTS[st.id]?.name ?? 'the settlement';
    for (const m of apply(st)) worldLog(`${m.title}: done. Report in at ${place}.`);
  }
}

/** Why the run ended, for the log and the game-over panel. */
const overText = (reason: GameOver): string => {
  const leader = world.roster.find((m) => m.protagonist)?.name ?? 'The leader';
  return reason === 'protagonist-fell' ? `${leader} didn't make it.` : 'The whole squad was wiped out.';
};

/** The run ends if the leader is dead or the squad was wiped. Logs it and returns true the moment that happens. */
function checkGameOver(outcome?: Outcome): boolean {
  if (over) return true;
  over = gameOverReason(world.roster, outcome);
  if (!over) return false;
  worldLog(`${overText(over)} Game over.`);
  return true;
}

/** Return from a finished fight: rewards on victory; a defeat is a wipe, which ends the run. */
let pendingSiteXp = 0;

function finishBattle(opts: { leave?: boolean } = {}): void {
  const ctx = battleCtx;
  if (!ctx || !state.winner || ctx.sandbox) return;
  hideEndBanner();
  const report = applyBattleResult(world.roster, state, world);
  ensureStores(world).stash.push(...report.dropped);
  if (state.winner === 'player') {
    const firstClear = !!ctx.site && !world.cleared[ctx.site.id];
    if (ctx.site) world.cleared[ctx.site.id] = true;
    world.scrap += ctx.reward;
    worldLog(`${ctx.label}: victory. +${ctx.reward} scrap.`);
    if (firstClear && ctx.site) pendingSiteXp = XP_SITE_BASE + XP_SITE_PER_DIFFICULTY * (ctx.site.difficulty ?? 1);
    // whoever posted work about this place, or this patch of the island, now owes you for it
    advanceMissions((st) => recordWin(st.active, regionAt(world.pos).id));
    const downed = state.units.filter((u) => u.team === 'enemy' && !u.alive).length;
    advanceMissions((st) => recordKills(st.active, downed));
    if (firstClear && ctx.site) {
      const site = ctx.site;
      advanceMissions((st) => recordClear(st.active, site.id));
      for (const st of visitedSettlements(world)) {
        const grew = addStanding(st, SITE_CLEAR_STANDING * (site.difficulty ?? 1));
        if (grew.note) worldLog(grew.note);
      }
    }
  } else {
    worldLog(`${ctx.label}: defeat.`);
  }
  for (const note of report.notes) worldLog(note);
  if (pendingSiteXp > 0 && !gameOverReason(world.roster, report.outcome)) {
    worldXp(pendingSiteXp, `${ctx.site?.name ?? 'The site'} is yours for good.`);
    pendingSiteXp = 0;
  }
  checkGameOver(report.outcome);
  completeNight();
  const spoils = collectSpoils(state);
  if (opts.leave && !over) {
    // Walk away from it: the loot stays where it lies and anyone out cold is let go.
    for (const note of resolveSpoils(world, spoils, { take: [], fates: {} }, world)) worldLog(note);
    returnToWorld();
    return;
  }
  if (over || (spoils.loot.length === 0 && spoils.prisoners.length === 0)) {
    if (!over) resolveSpoils(world, spoils, { take: [], fates: {} }, world); // still counts the rivals who died
    returnToWorld();
    return;
  }
  // The field is ours: take what we want, then decide what to do with anyone left out cold.
  showSpoils(spoils, ctx.label, (choice) => {
    for (const note of resolveSpoils(world, spoils, choice, world)) worldLog(note);
    hideOverlay();
    returnToWorld();
  });
}

function retreat(): void {
  if (busy) return;
  const ctx = battleCtx;
  if (ctx && !ctx.sandbox && !state.winner) {
    worldLog(`${ctx.label}: you pull back without finishing it.`);
    // Anyone who already went down is still lost, and wounds carry over; XP and injury recovery do not (see applyBattleResult).
    const res = applyBattleResult(world.roster, state, world);
    ensureStores(world).stash.push(...res.dropped);
    for (const note of res.notes) worldLog(note);
    checkGameOver();
    completeNight();
  }
  returnToWorld();
}

/** The squad's average level: what the rival schools have had to keep up with. */
function squadLevel(): number {
  const live = world.roster.filter((m) => !m.dead);
  return live.length ? live.reduce((n, m) => n + m.level, 0) / live.length : 1;
}

function randomEncounter(region: Region): void {
  const d = Math.max(1, Math.min(4, region.danger));
  const scenario = encounterScenario({
    seed: Math.floor(rand(world) * 0x7fffffff),
    level: squadLevel(),
    biome: region.biome,
    pods: d >= 3 ? 2 : 1,
    podSize: d === 2 ? 3 : 2,
    difficulty: d,
  });
  worldLog(`Ambush in ${region.name}!`);
  beginBattle(scenario, { label: `Ambush in ${region.name}`, site: null, reward: d * 2, sandbox: false, banner: 'Ambush' });
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function siteScenario(site: Site): Scenario {
  const d = site.difficulty ?? 1;
  return encounterScenario({
    seed: hashStr(site.id), // same layout every attempt: the site is a place, not a dice roll
    level: squadLevel(),
    biome: regionAt(site).biome,
    pods: 1 + Math.ceil(d / 2),
    podSize: d === 1 ? 2 : 3,
    difficulty: d,
  });
}

/** The camp screen: on the road (a night may bring an ambush) or at the home camp (safe, and mends faster). */
function openCamp(safe: boolean): void {
  if (mode !== 'world' || over) return;
  const region = regionAt(world.pos);
  const danger = safe ? 0 : region.danger;
  showCamp({
    world,
    place: safe ? siteNear(world.pos)?.name ?? region.name : region.name,
    safe,
    danger,
    onInventory: () => openWorldInventory(() => openCamp(safe)),
    onSleep: (watch) => {
      if (!safe && rollAmbush(world, { danger, watch })) {
        pendingNight = { watch };
        worldLog(`Night ambush in ${region.name}!`);
        hideOverlay();
        const d = Math.max(1, danger);
        beginBattle(
          encounterScenario({ seed: Math.floor(rand(world) * 0x7fffffff), level: squadLevel(), biome: region.biome, pods: 1, podSize: d >= 3 ? 3 : 2, difficulty: d, ambush: true }),
          { label: `Night ambush in ${region.name}`, site: null, reward: d * 2, sandbox: false, ambush: true, banner: 'Ambush' },
        );
        return { ambush: true, notes: [] };
      }
      const here = settlementHere();
      const notes = morning(world, safe ? 'home' : 'quiet', watch, here ? restBonusOf(here) : 0);
      for (const n of notes) worldLog(n);
      saveGame(world);
      return { ambush: false, notes };
    },
    onClose: () => {
      lastWorldSig = '';
      saveGame(world);
      updateWorldPanel();
    },
  });
}

/** An ambushed night ends with the fight: morning comes (a rough one). */
function completeNight(): void {
  if (!pendingNight) return;
  const { watch } = pendingNight;
  pendingNight = null;
  if (over) return;
  for (const n of morning(world, 'ambushed', watch)) worldLog(n);
}

function enterSite(site: Site | null): void {
  if (mode !== 'world' || over) return;
  if (!site) {
    worldLog('There is nothing to enter here.');
    return;
  }
  if (isSettlement(site)) {
    openSettlement();
    return;
  }
  if (site.kind === 'home') {
    openCamp(true);
    return;
  }
  if (!site.difficulty) {
    worldLog(`${site.name}: ${site.blurb}`);
    return;
  }
  if (world.cleared[site.id]) {
    worldLog(`${site.name} is already cleared.`);
    return;
  }
  worldLog(`${site.name}: ${site.blurb}`);
  beginAssault(siteScenario(site), {
    label: `Assault on ${site.name}`,
    site,
    reward: site.reward ?? 0,
    sandbox: false,
    banner: 'Assault',
  });
}

// ---------- squad display (shared by the world and battle panels) ----------

/** Traits and active injuries as extra panel lines. */
function memberTags(m: RosterMember): string {
  const traits = [...m.traits.map((t) => TRAITS[t].name), ...m.perks.map((id) => PERKS[id]?.name ?? id)].join(', ');
  const hurt = m.injuries.map((i) => (INJURIES[i.id].permanent ? INJURIES[i.id].name : `${INJURIES[i.id].name} (${i.left} day${i.left === 1 ? '' : 's'})`)).join(', ');
  return (
    (traits ? `<br><span style="opacity:.75">${traits}</span>` : '') + (hurt ? `<br><span style="color:#e0674e">${hurt}</span>` : '')
  );
}

function rosterHtml(roster: RosterMember[]): string {
  const rows = roster.map((m) => {
    if (m.dead) {
      return (
        `<div style="margin-top:4px;opacity:.6"><b>${esc(m.name)}</b> <span style="opacity:.7">${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} Lv ${m.level}</span> ` +
        `&mdash; <span style="color:#e0674e">fallen</span></div>`
      );
    }
    const max = effectiveStats(m).hp;
    const need = xpToNext(m.level);
    const xp = Number.isFinite(need) ? `XP ${m.xp}/${need}` : 'max level';
    const hpColor = m.hp >= max ? '#6fcf7a' : m.hp / max > 0.4 ? '#e8b04a' : '#e0674e';
    return (
      `<div style="margin-top:4px"><b>${esc(m.name)}${m.protagonist ? ' (you)' : ''}</b> <span style="opacity:.7">${CLIQUES[m.clique].label} / ${CLASSES[m.schoolClass].label} Lv ${m.level}</span><br>` +
      `<span style="color:${hpColor}">HP ${m.hp}/${max}</span> &middot; ${xp}` +
      (m.pending.length ? ` &middot; <b style="color:#e8b04a">${m.pending.length} to spend (U)</b>` : '') +
      `${memberTags(m)}</div>`
    );
  });
  return `<div style="margin-top:8px;border-top:1px solid #22303c;padding-top:6px"><b>Squad</b>${rows.join('')}</div>`;
}

const rosterSig = (roster: RosterMember[]): string =>
  roster.map((m) => [m.dead, m.hp, m.level, m.xp, m.pending.length, m.perks.join(), m.traits.join(), m.injuries.map((i) => `${i.id}${i.left}`).join()].join(':')).join('|');

// ---------- world panel ----------

let lastWorldSig = '';

function updateWorldPanel(): void {
  const region = regionAt(world.pos);
  const site = siteNear(world.pos);
  const clearable = WORLD.sites.filter((s) => s.difficulty);
  const done = clearable.filter((s) => world.cleared[s.id]).length;
  const sets = Object.values(world.settlements ?? {}).map((st) => `${st.id}:${st.standing}:${st.active.length}:${st.house ?? ''}`).join(',');
  const sig = [region.id, site?.id ?? '-', site ? !!world.cleared[site.id] : '', world.scrap, done, rosterSig(world.roster), over ?? '', world.stash?.length ?? 0, world.captives?.length ?? 0, sets].join('|');
  if (sig === lastWorldSig) return;
  lastWorldSig = sig;

  if (over) {
    const why = overText(over) + (loadGame() ? '<br><span style="opacity:.8">Press L to load your last save.</span>' : '');
    panel.innerHTML =
      `<h2>The Island</h2>` +
      `<div style="margin-top:8px;padding:6px 8px;border-left:3px solid #e0674e;background:#2a1a1a;color:#e0674e"><b>GAME OVER</b><br>${why}</div>` +
      rosterHtml(world.roster);
    renderActions(undefined);
    return;
  }

  const danger = region.danger === 0 ? 'safe' : '●'.repeat(region.danger) + '○'.repeat(4 - region.danger);
  const lines: string[] = [];
  lines.push(`<h2>The Island</h2>`);
  lines.push(`<div><b>${region.name}</b> <span style="opacity:.7">${region.biome}</span><br>Danger: ${danger}</div>`);
  lines.push(`<div style="margin-top:6px">Scrap: <b>${world.scrap}</b> &middot; Sites cleared: ${done}/${clearable.length}</div>`);
  if ((world.stash?.length ?? 0) > 0 || (world.captives?.length ?? 0) > 0) {
    lines.push(`<div style="margin-top:4px">Stash: <b>${world.stash?.length ?? 0}</b> item${world.stash?.length === 1 ? '' : 's'} &middot; Captives: <b>${world.captives?.length ?? 0}</b> <span style="opacity:.6">(I: inventory)</span></div>`);
  }
  if (site) {
    let status = '';
    if (site.difficulty) status = world.cleared[site.id] ? ' &mdash; cleared' : ` &mdash; hostile (${'!'.repeat(site.difficulty)}), reward ${site.reward ?? 0} scrap`;
    const here = isSettlement(site) ? world.settlements?.[site.id] : null;
    if (here) status = ` &mdash; ${settlementSummary(here)}`;
    const hint = isSettlement(site)
      ? 'Press E for the settlement, C to sleep here.'
      : site.kind === 'home'
        ? 'Press E to rest at camp.'
        : site.difficulty && !world.cleared[site.id]
          ? 'Press E to assault.'
          : '';
    lines.push(
      `<div style="margin-top:8px;padding:6px 8px;border-left:3px solid #7ec4e8;background:#1a2530"><b>${site.name}</b>${status}<br>` +
        `<span style="opacity:.8">${site.blurb}</span>${hint ? `<br><span style="color:#e8b04a">${hint}</span>` : ''}</div>`,
    );
  }
  lines.push(rosterHtml(world.roster));
  lines.push(
    `<div style="margin-top:10px;opacity:.55;font-size:11px">WASD / arrows: walk &middot; click map: travel<br>` +
      `E: enter site &middot; G: debug overlay<br>Random fights trigger as you walk outside safe ground.</div>`,
  );
  panel.innerHTML = lines.join('');
  renderActions(undefined);
}

// ---------- input ----------

const heldKeys = new Set<string>();
const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

function heldInput(): { dx: number; dy: number } | null {
  let dx = 0;
  let dy = 0;
  for (const k of heldKeys) {
    const v = MOVE_KEYS[k];
    if (v) {
      dx += v[0];
      dy += v[1];
    }
  }
  return dx !== 0 || dy !== 0 ? { dx: Math.sign(dx), dy: Math.sign(dy) } : null;
}

canvas.addEventListener('mousemove', (e) => {
  const p = renderer.tileAt(e.clientX, e.clientY, state);
  const changed = (p?.x ?? -1) !== (view.hover?.x ?? -1) || (p?.y ?? -1) !== (view.hover?.y ?? -1);
  view.hover = p;
  if (changed) refresh();
});
canvas.addEventListener('mouseleave', () => {
  view.hover = null;
  refresh();
});
canvas.addEventListener('click', (e) => {
  const p = renderer.tileAt(e.clientX, e.clientY, state);
  if (p) onClick(p);
});

worldCanvas.addEventListener('mousemove', (e) => {
  worldView.hover = worldRenderer.toWorld(e.clientX, e.clientY);
});
worldCanvas.addEventListener('mouseleave', () => {
  worldView.hover = null;
});
worldCanvas.addEventListener('click', (e) => {
  if (mode !== 'world' || over) return;
  const p = worldRenderer.toWorld(e.clientX, e.clientY);
  if (!p) return;
  // Clicking a site's ring heads for its centre.
  const target = siteNear(p);
  walkTo(world, target ? { x: target.x, y: target.y } : p);
});

window.addEventListener('blur', () => heldKeys.clear());
window.addEventListener('keyup', (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener('keydown', (e) => {
  if (overlayOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();

  if (mode === 'world') {
    if (MOVE_KEYS[k] && !over) {
      e.preventDefault();
      heldKeys.add(k);
      return;
    }
    const b = currentButtons.find((x) => x.key === k);
    if (b && b.enabled(undefined)) {
      b.run();
      lastWorldSig = '';
    }
    return;
  }

  if (k === 'tab') {
    e.preventDefault();
    if (canAct()) selectNext(e.shiftKey ? -1 : 1);
    return;
  }
  if (/^[1-9]$/.test(k) && canAct()) {
    const u = living(state, 'player')[Number(k) - 1];
    if (u) select(u.id);
    return;
  }
  if (mode === 'battle' && !overlayOpen()) {
    const cam = { z: 'fit', '[': 'ccw', ']': 'cw', '+': 'in', '=': 'in', '-': 'out', _: 'out' }[k];
    if (cam) {
      cameraCmd(cam);
      return;
    }
  }
  const b = currentButtons.find((x) => x.key === k);
  if (b && usable(b, selected())) b.run();
});

// ---------- new game / load / boot ----------

/** False until the player has chosen Continue or New game; keeps the placeholder world from overwriting a real save. */
let started = false;

function startNewGame(): void {
  showCreate((choice: PlayerChoice) => {
    resetWorld(createWorld(Date.now() & 0x7fffffff, choice));
    over = null;
    started = true;
    hideOverlay();
    enterWorld();
  });
}

function loadLastSave(): void {
  const saved = loadGame();
  if (!saved) return;
  if (migrateRoster(saved.roster, saved)) saved.log.push('Your squad has grown into the new way of doing things: spend what they have earned.');
  resetWorld(saved);
  over = null;
  started = true;
  hideOverlay();
  enterWorld();
  offerLevelUps();
}

if (params.has('quick')) {
  // Straight into the default character, no screens (dev and scripted runs).
  started = true;
  enterWorld();
} else {
  enterWorld();
  showTitle({ canContinue: !!loadGame(), onContinue: loadLastSave, onNew: startNewGame });
}

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (mode === 'world') {
    const ev = over || overlayOpen() ? null : stepWorld(world, dt, heldInput());
    if (ev) randomEncounter(ev.region);
    else {
      if (started && !over && !overlayOpen()) {
        const here = regionAt(world.pos);
        noteDiscovery(`r:${here.id}`, here.name);
        const at = siteNear(world.pos);
        if (at) noteDiscovery(`s:${at.id}`, at.name);
      }
      updateWorldPanel();
      worldRenderer.draw(world, worldView);
    }
  } else {
    renderer.draw(state, view);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Scripted playthroughs (headless tests) drive the game through this; enabled with ?debug.
if (params.has('debug')) {
  Object.assign(window, {
    __wrecked: {
      world,
      get mode() {
        return mode;
      },
      get state() {
        return state;
      },
      get over() {
        return over;
      },
      enterSite: (id: string) => enterSite(siteById(id) ?? null),
      clearSave,
      encounter: () => randomEncounter(regionAt(world.pos)),
      xp: (n: number) => {
        worldXp(n, 'Debug experience.');
        updateWorldPanel();
      },
      levelUp: () => offerLevelUps(),
      finish: () => finishBattle(),
    },
  });
}
