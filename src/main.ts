import {
  CLASSES,
  CLIQUES,
  FIELD_SIZE,
  INJURIES,
  SCENARIOS,
  TRAITS,
  applyBattleResult,
  computeShot,
  createBattle,
  deployRoster,
  effectiveStats,
  gameOverReason,
  restAtCamp,
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
  type Scenario,
  type Unit,
} from './engine';
import { rand } from './engine/rng';
import { esc, hideOverlay, overlayOpen, showCreate, showPrep, showTitle } from './ui/screens';
import { clearSave, loadGame, saveGame } from './world/save';
import { BoardRenderer, type ViewState } from './render/board';
import { preloadArt } from './render/sprites';
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
}
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

function playEffects(events: BattleEvent[]): void {
  // Visibility is refreshed first so a pod that just woke is already drawn when its flash appears.
  view.visible = visibleTiles(state);
  for (const ev of events) {
    if (ev.type === 'move') {
      const last = ev.path[ev.path.length - 1];
      if (last) renderer.face(ev.unitId, ev.path.length > 1 ? ev.path[ev.path.length - 2] : ev.from, last);
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
    if (ev.type !== 'shoot') continue;
    const a = getUnit(state, ev.attackerId);
    const t = getUnit(state, ev.targetId);
    if (!a || !t) continue;
    renderer.face(a.id, a.pos, t.pos);
    if (!seen(a.pos) && !seen(t.pos)) continue; // happened in the fog
    const text = ev.hit ? `${ev.crit ? 'CRIT ' : ''}-${ev.damage}` : 'MISS';
    renderer.addShotEffect(a.pos, t.pos, ev.hit, text, ev.crit);
    if (ev.downed) renderer.addTextEffect(t.pos, 'DOWN!', '#e0674e', 2200);
  }
}

function select(id: string | null): void {
  view.selectedId = id;
  view.mode = 'move';
  refresh();
}

function selectNext(): void {
  const ready = living(state, 'player').filter((u) => u.ap > 0);
  if (ready.length === 0) return;
  const cur = ready.findIndex((u) => u.id === view.selectedId);
  select(ready[(cur + 1) % ready.length].id);
}

// ---------- buttons (rebuilt per mode) ----------

interface Btn {
  label: string;
  key: string;
  run: () => void;
  enabled: (s: Unit | undefined) => boolean;
  active?: () => boolean;
}

let currentButtons: Btn[] = [];
let buttonEls: HTMLButtonElement[] = [];

function setButtons(list: Btn[]): void {
  currentButtons = list;
  actions.innerHTML = '';
  buttonEls = list.map((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.addEventListener('click', b.run);
    actions.appendChild(el);
    return el;
  });
}

function renderActions(sel: Unit | undefined): void {
  currentButtons.forEach((b, i) => {
    buttonEls[i].disabled = !b.enabled(sel);
    buttonEls[i].classList.toggle('active', b.active?.() ?? false);
  });
}

const battleButtons: Btn[] = [
  { label: 'Move (M)', key: 'm', run: () => setAimMode('move'), enabled: (s) => canAct() && !!s && s.ap > 0, active: () => view.mode === 'move' },
  { label: 'Fire (F)', key: 'f', run: () => setAimMode('shoot'), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo > 0, active: () => view.mode === 'shoot' },
  { label: 'Overwatch (O)', key: 'o', run: () => act(setOverwatch(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo > 0 },
  { label: 'Revive (V)', key: 'v', run: () => reviveAdjacent(), enabled: (s) => canAct() && !!s && s.ap > 0 && revivableBy(state, s).length > 0 },
  { label: 'Reload (R)', key: 'r', run: () => act(reload(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo < s.weapon.clip },
  { label: 'End turn (E)', key: 'e', run: () => startEnemyPhase(), enabled: () => canAct() },
  { label: 'Continue (Enter)', key: 'enter', run: () => finishBattle(), enabled: () => !!state.winner && !busy && !battleCtx?.sandbox },
  { label: 'Retreat (W)', key: 'w', run: () => retreat(), enabled: () => !busy && (!state.winner || !!battleCtx?.sandbox) },
  { label: 'Restart (N)', key: 'n', run: () => restart(), enabled: () => !!battleCtx?.sandbox },
  { label: 'Next map (X)', key: 'x', run: () => restart(true), enabled: () => !!battleCtx?.sandbox },
];

const worldButtons: Btn[] = [
  { label: 'Enter site (E)', key: 'e', run: () => enterSite(siteNear(world.pos)), enabled: () => !!siteNear(world.pos) },
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
      view.preview = computeShot(state.map, sel, sel.pos, t);
      view.previewTargetId = t.id;
    }
  }

  flushLog();
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
        `HP ${sel.hp}/${sel.maxHp} &middot; AP ${sel.ap}/${sel.maxAp} &middot; Ammo ${sel.ammo}/${sel.weapon.clip}<br>` +
        `${sel.weapon.name} ${sel.weapon.damage[0]}-${sel.weapon.damage[1]} dmg, range ${sel.weapon.range} (full accuracy to ${sel.weapon.optimal})<br>` +
        `Aim ${sel.aim} &middot; Def ${sel.defense} &middot; Move ${sel.mobility}/${sel.mobility * 2}` +
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
    `<div style="margin-top:10px;opacity:.55;font-size:11px">Click tile: move &middot; click enemy: shoot<br>` +
      `M move &middot; F fire &middot; O overwatch &middot; V revive &middot; R reload &middot; E end turn &middot; Tab next &middot; W retreat</div>`,
  );
  panel.innerHTML = lines.join('');
}

function setAimMode(m: 'move' | 'shoot'): void {
  view.mode = m;
  refresh();
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
  playEffects(res.events);
  view.mode = 'move';
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
    act(shoot(state, sel.id, clicked.id));
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
      }
      refresh();
      return;
    }
    playEffects(ev);
    refresh();
    window.setTimeout(tick, ev.length > 0 ? 650 : 100);
  };
  window.setTimeout(tick, 450);
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
  view.hover = null;
  setButtons(battleButtons);
  const first = living(state, 'player')[0];
  if (first) view.selectedId = first.id;
  toast(ctx.label);
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
  beginBattle(SCENARIOS[i], { label: `Sandbox: ${SCENARIOS[i].name}`, site: null, reward: 0, sandbox: true });
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
  logEl.innerHTML = '';
  for (const t of world.log.slice(-40)) appendWorldLog(t);
  setButtons(over ? gameOverButtons : worldButtons);
  lastWorldSig = '';
  updateWorldPanel();
  // Autosave on every return to the map. Never after game over: the save stays the last good state, so "Load last save" is a real undo.
  if (started && !over) saveGame(world);
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
function finishBattle(): void {
  const ctx = battleCtx;
  if (!ctx || !state.winner || ctx.sandbox) return;
  const report = applyBattleResult(world.roster, state, world);
  if (state.winner === 'player') {
    if (ctx.site) world.cleared[ctx.site.id] = true;
    world.scrap += ctx.reward;
    worldLog(`${ctx.label}: victory. +${ctx.reward} scrap.`);
  } else {
    worldLog(`${ctx.label}: defeat.`);
  }
  for (const note of report.notes) worldLog(note);
  checkGameOver(report.outcome);
  enterWorld();
}

function retreat(): void {
  if (busy) return;
  const ctx = battleCtx;
  if (ctx && !ctx.sandbox && !state.winner) {
    worldLog(`${ctx.label}: you pull back without finishing it.`);
    // Anyone who already went down is still lost, and wounds carry over; XP and injury recovery do not (see applyBattleResult).
    for (const note of applyBattleResult(world.roster, state, world).notes) worldLog(note);
    checkGameOver();
  }
  enterWorld();
}

function randomEncounter(region: Region): void {
  const d = Math.max(1, Math.min(4, region.danger));
  const scenario = encounterScenario({
    seed: Math.floor(rand(world) * 0x7fffffff),
    biome: region.biome,
    pods: d >= 3 ? 2 : 1,
    podSize: d === 2 ? 3 : 2,
    difficulty: d,
  });
  worldLog(`Ambush in ${region.name}!`);
  beginBattle(scenario, { label: `Ambush in ${region.name}`, site: null, reward: d * 2, sandbox: false });
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
    biome: regionAt(site).biome,
    pods: 1 + Math.ceil(d / 2),
    podSize: d === 1 ? 2 : 3,
    difficulty: d,
  });
}

function enterSite(site: Site | null): void {
  if (mode !== 'world' || over) return;
  if (!site) {
    worldLog('There is nothing to enter here.');
    return;
  }
  if (site.kind === 'home') {
    const healed = restAtCamp(world.roster);
    worldLog(`${site.name}: ${healed > 0 ? 'you rest, and everyone is back on their feet.' : 'everyone is already rested.'}`);
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
  });
}

// ---------- squad display (shared by the world and battle panels) ----------

/** Traits and active injuries as extra panel lines. */
function memberTags(m: RosterMember): string {
  const traits = m.traits.map((t) => TRAITS[t].name).join(', ');
  const hurt = m.injuries.map((i) => `${INJURIES[i.id].name} (${i.left} fight${i.left === 1 ? '' : 's'})`).join(', ');
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
      `<span style="color:${hpColor}">HP ${m.hp}/${max}</span> &middot; ${xp}${memberTags(m)}</div>`
    );
  });
  return `<div style="margin-top:8px;border-top:1px solid #22303c;padding-top:6px"><b>Squad</b>${rows.join('')}</div>`;
}

const rosterSig = (roster: RosterMember[]): string =>
  roster.map((m) => [m.dead, m.hp, m.level, m.xp, m.traits.join(), m.injuries.map((i) => `${i.id}${i.left}`).join()].join(':')).join('|');

// ---------- world panel ----------

let lastWorldSig = '';

function updateWorldPanel(): void {
  const region = regionAt(world.pos);
  const site = siteNear(world.pos);
  const clearable = WORLD.sites.filter((s) => s.difficulty);
  const done = clearable.filter((s) => world.cleared[s.id]).length;
  const sig = [region.id, site?.id ?? '-', site ? !!world.cleared[site.id] : '', world.scrap, done, rosterSig(world.roster), over ?? ''].join('|');
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
  if (site) {
    let status = '';
    if (site.difficulty) status = world.cleared[site.id] ? ' &mdash; cleared' : ` &mdash; hostile (${'!'.repeat(site.difficulty)}), reward ${site.reward ?? 0} scrap`;
    const hint = site.kind === 'home' ? 'Press E to rest at camp.' : site.difficulty && !world.cleared[site.id] ? 'Press E to assault.' : '';
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
    if (canAct()) selectNext();
    return;
  }
  if (/^[1-9]$/.test(k) && canAct()) {
    const u = living(state, 'player')[Number(k) - 1];
    if (u) select(u.id);
    return;
  }
  const b = currentButtons.find((x) => x.key === k);
  if (b && b.enabled(selected())) b.run();
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
  resetWorld(saved);
  over = null;
  started = true;
  hideOverlay();
  enterWorld();
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
      finish: () => finishBattle(),
    },
  });
}
