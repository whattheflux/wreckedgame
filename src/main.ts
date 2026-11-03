import {
  SCENARIOS,
  computeShot,
  createBattle,
  endTurn,
  enemyStep,
  getUnit,
  living,
  moveUnit,
  playerTurnOver,
  reachableFor,
  reload,
  setOverwatch,
  shoot,
  unitAt,
  type ActionResult,
  type BattleEvent,
  type GameState,
  type Pos,
  type Unit,
} from './engine';
import { BoardRenderer, type ViewState } from './render/board';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;
const actions = document.getElementById('actions') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;
const renderer = new BoardRenderer(canvas);

let state: GameState = createBattle(SCENARIOS[0]);
let busy = false;
let logIndex = 0;
const view: ViewState = { selectedId: null, mode: 'move', hover: null, reach: null, preview: null, previewTargetId: null };

// ---------- helpers ----------

const selected = (): Unit | undefined => {
  const u = view.selectedId ? getUnit(state, view.selectedId) : undefined;
  return u && u.alive ? u : undefined;
};

const canAct = (): boolean => !busy && !state.winner && state.active === 'player';

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
    const d = document.createElement('div');
    d.className = e.team === 'sys' ? 'sys' : e.team;
    d.textContent = e.text;
    logEl.appendChild(d);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function playEffects(events: BattleEvent[]): void {
  for (const ev of events) {
    if (ev.type !== 'shoot') continue;
    const a = getUnit(state, ev.attackerId);
    const t = getUnit(state, ev.targetId);
    if (!a || !t) continue;
    const text = ev.hit ? `${ev.crit ? 'CRIT ' : ''}-${ev.damage}` : 'MISS';
    renderer.addShotEffect(a.pos, t.pos, ev.hit, text, ev.crit);
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

// ---------- refresh: derive all view data from state ----------

function refresh(): void {
  const sel = selected();
  if (view.selectedId && !sel) view.selectedId = null;

  view.reach = sel && sel.ap > 0 && canAct() ? reachableFor(state, sel) : null;

  view.preview = null;
  view.previewTargetId = null;
  if (sel && view.hover) {
    const t = unitAt(state, view.hover.x, view.hover.y);
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
    lines.push(`<div><b>${state.winner === 'player' ? 'VICTORY' : 'DEFEAT'}</b> &mdash; press N to restart</div>`);
  } else {
    lines.push(`<div>${side}${busy ? ' (acting...)' : ''}</div>`);
  }

  if (sel) {
    lines.push(
      `<div style="margin-top:8px"><b>${sel.name}</b> <span style="opacity:.7">${sel.role}</span><br>` +
        `HP ${sel.hp}/${sel.maxHp} &middot; AP ${sel.ap}/${sel.maxAp} &middot; Ammo ${sel.ammo}/${sel.weapon.clip}<br>` +
        `${sel.weapon.name} ${sel.weapon.damage[0]}-${sel.weapon.damage[1]} dmg, range ${sel.weapon.range}<br>` +
        `Aim ${sel.aim} &middot; Def ${sel.defense} &middot; Move ${sel.mobility}/${sel.mobility * 2}</div>`,
    );
  } else if (!state.winner) {
    lines.push(`<div style="margin-top:8px;opacity:.7">Click one of your units (blue) to select.</div>`);
  }

  if (view.preview && view.previewTargetId) {
    const t = getUnit(state, view.previewTargetId);
    const pv = view.preview;
    if (t) {
      lines.push(
        `<div style="margin-top:8px;border-top:1px solid #22303c;padding-top:6px"><b>${t.name}</b> HP ${t.hp}/${t.maxHp}<br>` +
          (pv.canShoot
            ? `Hit ${pv.hitChance}% &middot; Crit ${pv.critChance}% &middot; ${pv.dmgMin}-${pv.dmgMax} dmg<br>` +
              `Cover: ${pv.cover}${pv.flanked ? ' (FLANKED)' : ''}`
            : `<span style="opacity:.7">${pv.reason}</span>`) +
          `</div>`,
      );
    }
  }

  lines.push(
    `<div style="margin-top:10px;opacity:.55;font-size:11px">Click tile: move &middot; click enemy: shoot<br>` +
      `M move &middot; F fire &middot; O overwatch &middot; R reload &middot; E end turn &middot; Tab next</div>`,
  );
  panel.innerHTML = lines.join('');
}

interface Btn {
  label: string;
  key: string;
  run: () => void;
  enabled: (s: Unit | undefined) => boolean;
  active?: () => boolean;
}

const buttons: Btn[] = [
  { label: 'Move (M)', key: 'm', run: () => setMode('move'), enabled: (s) => canAct() && !!s && s.ap > 0, active: () => view.mode === 'move' },
  { label: 'Fire (F)', key: 'f', run: () => setMode('shoot'), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo > 0, active: () => view.mode === 'shoot' },
  { label: 'Overwatch (O)', key: 'o', run: () => act(setOverwatch(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo > 0 },
  { label: 'Reload (R)', key: 'r', run: () => act(reload(state, view.selectedId ?? '')), enabled: (s) => canAct() && !!s && s.ap > 0 && s.ammo < s.weapon.clip },
  { label: 'End turn (E)', key: 'e', run: () => startEnemyPhase(), enabled: () => canAct() },
  { label: 'Restart (N)', key: 'n', run: () => restart(), enabled: () => true },
];

const buttonEls = buttons.map((b) => {
  const el = document.createElement('button');
  el.textContent = b.label;
  el.addEventListener('click', b.run);
  actions.appendChild(el);
  return el;
});

function renderActions(sel: Unit | undefined): void {
  buttons.forEach((b, i) => {
    buttonEls[i].disabled = !b.enabled(sel);
    buttonEls[i].classList.toggle('active', b.active?.() ?? false);
  });
}

function setMode(m: 'move' | 'shoot'): void {
  view.mode = m;
  refresh();
}

// ---------- player actions ----------

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
  const clicked = unitAt(state, p.x, p.y);
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

function restart(): void {
  state = createBattle(SCENARIOS[0]);
  busy = false;
  logIndex = 0;
  logEl.innerHTML = '';
  view.selectedId = null;
  view.mode = 'move';
  view.hover = null;
  const first = living(state, 'player')[0];
  if (first) view.selectedId = first.id;
  refresh();
}

// ---------- input ----------

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

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
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
  const b = buttons.find((x) => x.key === k);
  if (b && b.enabled(selected())) b.run();
});

// ---------- boot ----------

const first = living(state, 'player')[0];
if (first) view.selectedId = first.id;
refresh();

function frame(): void {
  renderer.draw(state, view);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
