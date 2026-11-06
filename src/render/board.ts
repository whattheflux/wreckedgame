import type { GameState, Pos, Unit } from '../engine/types';
import { coverAgainst, dist, posKey, type PathNode } from '../engine/grid';
import type { Hint } from '../engine/hint';
import { computeShot, EXPOSED_CRIT_BONUS, type ShotPreview } from '../engine/combat';
import { DIRS, dirFromDelta, koUrl, loadedImage, spriteUrl, type Dir } from './sprites';
import { terrainImage } from './terrain';

export interface ViewState {
  selectedId: string | null;
  mode: 'move' | 'shoot';
  hover: Pos | null;
  reach: Map<string, PathNode> | null;
  preview: ShotPreview | null;
  /** unit under the cursor that the preview refers to */
  previewTargetId: string | null;
  /** tiles the squad can see right now: visible[y][x]. Enemies outside it are not drawn. */
  visible: boolean[][] | null;
  /** direction to the nearest undiscovered pod, once the squad has gone too long without contact */
  hint: Hint | null;
}

interface Effect {
  kind: 'line' | 'text';
  from?: Pos;
  to?: Pos;
  at?: Pos;
  text?: string;
  color: string;
  born: number;
  ttl: number;
}

const TEAM_COLOR = { player: '#3d8fc2', enemy: '#c2503d' } as const;

/** The unit's art for the way it is facing once it has loaded, else null (draw the circle). */
function spriteFor(u: Unit, facing: Dir): HTMLImageElement | null {
  const url = spriteUrl(u.sprite ?? u.name.toLowerCase(), facing);
  return url ? loadedImage(url) : null;
}

function koFor(u: Unit): HTMLImageElement | null {
  const url = koUrl(u.sprite ?? u.name.toLowerCase());
  return url ? loadedImage(url) : null;
}

export class BoardRenderer {
  private ctx: CanvasRenderingContext2D;
  private tile = 32;
  private ox = 0;
  private oy = 0;
  /** Camera: `zoom` multiplies the fit-to-window tile size; the view eases toward `goal` (tile coordinates). */
  private zoom = 1.5;
  /** Camera centre and where it is easing to, in (fractional) map-tile coordinates, independent of rotation. */
  private cam: { x: number; y: number } | null = null;
  private goal = { x: 0, y: 0 };
  /** Quarter turns clockwise: 0 = north up. Only the view turns; units stay upright. */
  private rot = 0;
  /**
   * Turn animation. `rot` jumps straight to the new orientation; the ground is drawn in it but turned back by `spin`
   * radians, which eases to 0, so the view swings round instead of flipping. `pivot` is the screen point it turns
   * about (the camera centre); `pivotOff` is where that point sat on screen before the turn, relative to the pivot.
   */
  private spin = 0;
  private pivot = { x: 0, y: 0 };
  private pivotOff = { x: 0, y: 0 };
  private pivotOffFrac = 1;
  private pendingFrom: { x: number; y: number } | null = null;
  private mw = 1;
  private mh = 1;
  private fit = 32;
  private lastLayout = performance.now();
  private effects: Effect[] = [];
  /** which way each unit last moved or fired; purely visual, so it lives here and not in the game state */
  private facing = new Map<string, Dir>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
  }

  /** Turn a unit toward `to` (a move step or a target); no-op if the points coincide. */
  face(unitId: string, from: Pos, to: Pos): void {
    const d = dirFromDelta(to.x - from.x, to.y - from.y);
    if (d) this.facing.set(unitId, d);
  }

  /** Centre the camera on a tile; `snap` jumps there instead of easing. */
  focus(p: Pos, snap = false): void {
    this.goal = { x: p.x + 0.5, y: p.y + 0.5 };
    if (snap || !this.cam) this.cam = { ...this.goal };
  }

  /** Flip between the zoomed-in follow camera and the whole-map view. Returns true when zoomed in. */
  toggleZoom(): boolean {
    this.zoom = this.zoom > 1 ? 1 : 1.5;
    return this.zoom > 1;
  }

  static readonly MAX_ZOOM = 3;

  /** Multiply the zoom (clamped 1..3). With a cursor position, the map point under it stays put. */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const next = Math.min(BoardRenderer.MAX_ZOOM, Math.max(1, this.zoom * factor));
    if (next === this.zoom) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cur = this.unspun({ x: (clientX ?? rect.left + w / 2) - rect.left, y: (clientY ?? rect.top + h / 2) - rect.top });
    const cx = cur.x;
    const cy = cur.y;
    const oldTile = this.tile;
    const newTile = Math.max(12, Math.round(this.fit * next));
    this.zoom = next;
    if (clientX === undefined || !this.cam) return;
    // the map point under the cursor, in view tiles, then the view centre that keeps it under the cursor
    const vx = (cx - this.ox) / oldTile;
    const vy = (cy - this.oy) / oldTile;
    const c = this.fromView(vx - (cx - w / 2) / newTile, vy - (cy - h / 2) / newTile);
    this.cam = c;
    this.goal = { ...c };
  }

  /** Turn the view a quarter turn (+1 clockwise, -1 anticlockwise). */
  rotate(step: 1 | -1): void {
    this.pendingFrom = this.displayPivot();
    this.pivotOffFrac = Math.min(1, Math.max(0.001, Math.abs(this.spin) / (Math.PI / 2)));
    this.rot = (this.rot + step + 4) % 4;
    this.spin -= (step * Math.PI) / 2;
    this.spin = Math.atan2(Math.sin(this.spin), Math.cos(this.spin)); // chained turns take the short way round
  }

  /** Where the pivot is actually drawn right now (it slides from its old screen position to its new one). */
  private displayPivot(): { x: number; y: number } {
    const k = Math.min(1, Math.abs(this.spin) / (Math.PI / 2) / this.pivotOffFrac);
    return { x: this.pivot.x + this.pivotOff.x * k, y: this.pivot.y + this.pivotOff.y * k };
  }

  /** Layout position (as if no turn were in progress) -> where it is drawn while the view swings round. */
  private spun(p: { x: number; y: number }): { x: number; y: number } {
    if (!this.spin) return p;
    const d = this.displayPivot();
    const c = Math.cos(this.spin);
    const s = Math.sin(this.spin);
    const x = p.x - this.pivot.x;
    const y = p.y - this.pivot.y;
    return { x: d.x + x * c - y * s, y: d.y + x * s + y * c };
  }

  /** The inverse of `spun`: a point on screen -> layout position, for the mouse. */
  private unspun(p: { x: number; y: number }): { x: number; y: number } {
    if (!this.spin) return p;
    const d = this.displayPivot();
    const c = Math.cos(-this.spin);
    const s = Math.sin(-this.spin);
    const x = p.x - d.x;
    const y = p.y - d.y;
    return { x: this.pivot.x + x * c - y * s, y: this.pivot.y + x * s + y * c };
  }

  /** Apply the turn to the canvas, for everything that lies flat on the ground. */
  private applySpin(): void {
    if (!this.spin) return;
    const d = this.displayPivot();
    this.ctx.translate(d.x, d.y);
    this.ctx.rotate(this.spin);
    this.ctx.translate(-this.pivot.x, -this.pivot.y);
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  /** Map-tile coordinates (fractional, centres at +0.5) -> view-tile coordinates for the current rotation. */
  private toView(x: number, y: number): { x: number; y: number } {
    const W = this.mw;
    const H = this.mh;
    switch (this.rot) {
      case 1: return { x: H - y, y: x };
      case 2: return { x: W - x, y: H - y };
      case 3: return { x: y, y: W - x };
      default: return { x, y };
    }
  }

  private fromView(vx: number, vy: number): { x: number; y: number } {
    const W = this.mw;
    const H = this.mh;
    switch (this.rot) {
      case 1: return { x: vy, y: H - vx };
      case 2: return { x: W - vx, y: H - vy };
      case 3: return { x: W - vy, y: vx };
      default: return { x: vx, y: vy };
    }
  }

  /** Map-tile delta for a one-tile step on screen (dx, dy), used to find the neighbour across a screen edge. */
  private screenToMapDelta(dx: number, dy: number): [number, number] {
    switch (this.rot) {
      case 1: return [dy, -dx];
      case 2: return [-dx, -dy];
      case 3: return [-dy, dx];
      default: return [dx, dy];
    }
  }

  resetFacing(): void {
    this.facing.clear();
  }

  /** The way the unit faces on screen: its map facing turned with the view. */
  private facingOf(u: Unit): Dir {
    const d = this.facing.get(u.id) ?? (u.team === 'player' ? 'right' : 'left');
    return DIRS[(DIRS.indexOf(d) + 2 * this.rot) % 8];
  }

  addTextEffect(at: Pos, text: string, color: string, ttl = 1500): void {
    this.effects.push({ kind: 'text', at, text, color, born: performance.now(), ttl });
  }

  addShotEffect(from: Pos, to: Pos, hit: boolean, text: string, crit: boolean): void {
    const now = performance.now();
    this.effects.push({ kind: 'line', from, to, color: hit ? '#ffd27a' : '#8a9aa8', born: now, ttl: 280 });
    this.effects.push({
      kind: 'text',
      at: to,
      text,
      color: hit ? (crit ? '#ffb347' : '#ff6b5e') : '#c5d0da',
      born: now,
      ttl: 1100,
    });
  }

  /** Canvas pixel -> tile coordinate, or null if outside the map. */
  tileAt(clientX: number, clientY: number, state: GameState): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    this.mw = state.map.width;
    this.mh = state.map.height;
    const at = this.unspun({ x: clientX - rect.left, y: clientY - rect.top });
    const vx = Math.floor((at.x - this.ox) / this.tile);
    const vy = Math.floor((at.y - this.oy) / this.tile);
    // cell indices turn like cell centres do, so go via the centre and back
    const m = this.fromView(vx + 0.5, vy + 0.5);
    const x = Math.floor(m.x);
    const y = Math.floor(m.y);
    if (vx < 0 || vy < 0 || vx >= this.viewW() || vy >= this.viewH() || x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
    return { x, y };
  }

  private layout(state: GameState): { w: number; h: number } {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mw = state.map.width;
    this.mh = state.map.height;
    const vw = this.viewW();
    const vh = this.viewH();
    const fit = Math.floor(Math.min(w / vw, h / vh));
    this.fit = fit;
    this.tile = Math.max(12, Math.round(fit * this.zoom));
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastLayout) / 1000);
    this.lastLayout = now;
    if (!this.cam) this.cam = { x: state.map.width / 2, y: state.map.height / 2 };
    const k = 1 - Math.exp(-dt * 9);
    this.cam.x += (this.goal.x - this.cam.x) * k;
    this.cam.y += (this.goal.y - this.cam.y) * k;
    // Centre on the camera, but never show void past the map edge; a map smaller than the window just sits centred.
    const axis = (len: number, tiles: number, c: number): number => {
      const px = tiles * this.tile;
      if (px <= len) return Math.floor((len - px) / 2);
      return Math.round(Math.min(0, Math.max(len - px, len / 2 - c * this.tile)));
    };
    const cv = this.toView(this.cam.x, this.cam.y);
    this.ox = axis(w, vw, cv.x);
    this.oy = axis(h, vh, cv.y);
    this.pivot = { x: this.ox + cv.x * this.tile, y: this.oy + cv.y * this.tile };
    if (this.pendingFrom) {
      this.pivotOff = { x: this.pendingFrom.x - this.pivot.x, y: this.pendingFrom.y - this.pivot.y };
      this.pendingFrom = null;
    }
    if (this.spin) {
      this.spin -= this.spin * (1 - Math.exp(-dt * 11));
      if (Math.abs(this.spin) < 0.01) this.spin = 0;
    }
    return { w, h };
  }

  private viewW(): number {
    return this.rot % 2 ? this.mh : this.mw;
  }

  private viewH(): number {
    return this.rot % 2 ? this.mw : this.mh;
  }

  private px(p: Pos): { x: number; y: number } {
    const v = this.toView(p.x + 0.5, p.y + 0.5);
    return { x: this.ox + (v.x - 0.5) * this.tile, y: this.oy + (v.y - 0.5) * this.tile };
  }

  /** Tile centre in layout space: for anything drawn inside the turning ground layer. */
  private rawCenter(p: Pos): { x: number; y: number } {
    const o = this.px(p);
    return { x: o.x + this.tile / 2, y: o.y + this.tile / 2 };
  }

  /** Tile centre as drawn on screen, turn included: for things that stand upright (units, labels, markers). */
  private center(p: Pos): { x: number; y: number } {
    return this.spun(this.rawCenter(p));
  }

  draw(state: GameState, view: ViewState): void {
    const { w, h } = this.layout(state);
    const { ctx } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1117';
    ctx.fillRect(0, 0, w, h);

    // The ground (terrain, fog, outlines, rings, grid) swings round with the view...
    ctx.save();
    this.applySpin();
    this.drawTerrain(state);
    this.drawFog(state, view);
    this.drawOverlays(state, view);
    this.drawShotLine(state, view);
    this.drawGrid();
    ctx.restore();

    // ...while everything standing on it stays upright, only its position following the turn.
    for (const u of state.units) if (!u.alive && !u.downed && this.canSee(u, view)) this.drawFallen(u);
    for (const u of state.units) if (u.downed && !u.alive) this.drawDowned(u, state);
    for (const u of state.units) if (u.alive && this.canSee(u, view)) this.drawUnit(u, state, view);
    this.drawMarkers(state, view); // after the units, so a sprite never hides a cover marker
    this.drawPreviewLabel(state, view);
    this.drawEffects();
    this.drawHint(view);
  }

  private drawGrid(): void {
    const { ctx, tile } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= this.viewW(); x++) {
      ctx.moveTo(this.ox + x * tile + 0.5, this.oy);
      ctx.lineTo(this.ox + x * tile + 0.5, this.oy + this.viewH() * tile);
    }
    for (let y = 0; y <= this.viewH(); y++) {
      ctx.moveTo(this.ox, this.oy + y * tile + 0.5);
      ctx.lineTo(this.ox + this.viewW() * tile, this.oy + y * tile + 0.5);
    }
    ctx.stroke();
  }

  private drawTerrain(state: GameState): void {
    const { ctx, tile } = this;
    const biome = state.map.biome;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false; // chunky pixels, not blur
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const t = state.map.tiles[y][x];
        const o = this.px({ x, y });
        // cover objects stand on ordinary ground, everything else is its own surface
        ctx.drawImage(terrainImage(biome, t === 'half' || t === 'full' ? 'floor' : t, x, y), o.x, o.y, tile, tile);
        if (t === 'half' || t === 'full') ctx.drawImage(terrainImage(biome, t, x, y), o.x, o.y, tile, tile);
      }
    }
    ctx.imageSmoothingEnabled = smooth;
  }

  /** Your own units are always drawn; enemies only while one of your units has them in sight. */
  private canSee(u: Unit, view: ViewState): boolean {
    if (u.team === 'player' || !view.visible) return true;
    return view.visible[u.pos.y]?.[u.pos.x] ?? false;
  }

  /** Never-seen tiles are black; seen-but-not-currently-visible tiles are dimmed. */
  private drawFog(state: GameState, view: ViewState): void {
    const { ctx, tile } = this;
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const o = this.px({ x, y });
        if (!state.explored[y][x]) {
          ctx.fillStyle = '#05080b';
          ctx.fillRect(o.x, o.y, tile, tile);
        } else if (view.visible && !view.visible[y][x]) {
          ctx.fillStyle = 'rgba(5,8,12,0.55)';
          ctx.fillRect(o.x, o.y, tile, tile);
        }
      }
    }
  }

  /** Pulsing arrow on the edge of the map pointing toward the nearest undiscovered group. */
  private drawHint(view: ViewState): void {
    const h = view.hint;
    if (!h) return;
    const { ctx, tile } = this;
    const bw = this.viewW() * tile;
    const bh = this.viewH() * tile;
    const ang = h.angle + (this.rot * Math.PI) / 2 + this.spin;
    const cx = this.ox + bw / 2;
    const cy = this.oy + bh / 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const margin = 34;
    const tx = Math.abs(dx) > 1e-6 ? (bw / 2 - margin) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-6 ? (bh / 2 - margin) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const px = cx + dx * t;
    const py = cy + dy * t;

    ctx.save();
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(performance.now() / 350);
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = '#e8b04a';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-11, -14);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-11, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const label = `HOSTILES ~${h.distance}`;
    ctx.font = 'bold 12px system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 14;
    const lx = px - dx * 52;
    const ly = py - dy * 52;
    ctx.fillStyle = 'rgba(10,16,22,0.9)';
    ctx.fillRect(lx - lw / 2, ly - 11, lw, 22);
    ctx.fillStyle = '#e8b04a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly);
  }

  private selected(state: GameState, view: ViewState): Unit | undefined {
    return view.selectedId ? state.units.find((u) => u.id === view.selectedId && u.alive) : undefined;
  }

  private drawOverlays(state: GameState, view: ViewState): void {
    const { ctx, tile } = this;
    const sel = this.selected(state, view);
    if (!sel) return;

    const foes = state.units.filter((e) => e.alive && e.team !== sel.team && this.canSee(e, view));
    const hoverNode = view.hover && view.reach ? view.reach.get(posKey(view.hover.x, view.hover.y)) : undefined;

    if (view.mode === 'move' && view.reach) {
      // How far you can go: a light wash plus a bold outline round the edge of each zone (blue = one move,
      // amber = dash), so the ground underneath stays readable instead of being buried under tint.
      const zoneOf = (x: number, y: number): 0 | 1 | 2 => {
        const n = view.reach?.get(posKey(x, y));
        return !n || n.cost === 0 ? 0 : n.cost <= sel.mobility ? 1 : 2;
      };
      for (const n of view.reach.values()) {
        if (n.cost === 0) continue;
        const o = this.px(n.pos);
        ctx.fillStyle = n.cost <= sel.mobility ? 'rgba(80,170,255,0.13)' : 'rgba(255,205,80,0.11)';
        ctx.fillRect(o.x, o.y, tile, tile);
      }
      ctx.lineWidth = 2;
      for (const n of view.reach.values()) {
        const z = zoneOf(n.pos.x, n.pos.y);
        if (z === 0) continue;
        const o = this.px(n.pos);
        ctx.strokeStyle = z === 1 ? 'rgba(110,190,255,0.85)' : 'rgba(255,205,80,0.8)';
        ctx.beginPath();
        // the unit's own tile counts as the blue zone for outlining purposes
        // dx, dy are screen steps; the neighbour across that edge is found in map coordinates
        const same = (sx: number, sy: number): boolean => {
          const [dx, dy] = this.screenToMapDelta(sx, sy);
          const nz = zoneOf(n.pos.x + dx, n.pos.y + dy);
          const own = n.pos.x + dx === sel.pos.x && n.pos.y + dy === sel.pos.y;
          return z === 1 ? nz === 1 || own || false : nz === 2 || nz === 1 || own;
        };
        if (!same(0, -1)) { ctx.moveTo(o.x, o.y + 1); ctx.lineTo(o.x + tile, o.y + 1); }
        if (!same(0, 1)) { ctx.moveTo(o.x, o.y + tile - 1); ctx.lineTo(o.x + tile, o.y + tile - 1); }
        if (!same(-1, 0)) { ctx.moveTo(o.x + 1, o.y); ctx.lineTo(o.x + 1, o.y + tile); }
        if (!same(1, 0)) { ctx.moveTo(o.x + tile - 1, o.y); ctx.lineTo(o.x + tile - 1, o.y + tile); }
        ctx.stroke();
      }
    }

    // Weapon range: green ring = full accuracy, amber ring = maximum range. Brightest while aiming.
    // Hovering a reachable tile shows the same rings from there, and what you could hit from it.
    const aiming = view.mode === 'shoot';
    this.drawRangeRings(sel.pos, sel.weapon.optimal, sel.weapon.range, aiming ? 1 : 0.45);
    if (hoverNode && hoverNode.cost > 0 && view.hover) {
      this.drawRangeRings(view.hover, sel.weapon.optimal, sel.weapon.range, 0.9);
    }

    if (view.mode === 'shoot') {
      for (const e of foes) {
        if (!computeShot(state.map, sel, sel.pos, e).canShoot) continue;
        const c = this.rawCenter(e.pos);
        ctx.strokeStyle = 'rgba(255,90,70,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, tile * 0.46, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (view.hover) {
      const o = this.px(view.hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, tile - 2, tile - 2);
    }
  }

  /**
   * Everything that annotates the board and must stay readable: cover shields, hit-chance tags, range labels.
   * Drawn after the units (sprites are taller than a tile and would otherwise hide them) and upright.
   */
  private drawMarkers(state: GameState, view: ViewState): void {
    const { tile } = this;
    const sel = this.selected(state, view);
    if (!sel) return;
    const foes = state.units.filter((e) => e.alive && e.team !== sel.team && this.canSee(e, view));
    const hoverNode = view.hover && view.reach ? view.reach.get(posKey(view.hover.x, view.hover.y)) : undefined;

    // Cover you would get on each reachable tile, against the nearest enemy you can see.
    if (view.mode === 'move' && view.reach && foes.length) {
      const nearest = (p: Pos): Unit => foes.reduce((b, e) => (dist(p, e.pos) < dist(p, b.pos) ? e : b));
      for (const n of view.reach.values()) {
        if (n.cost === 0) continue;
        const cover = coverAgainst(state.map, nearest(n.pos).pos, n.pos);
        if (cover === 'none') continue;
        const c = this.center(n.pos);
        this.drawShield(c.x, c.y, tile * 0.2, cover, 0.9);
      }
    }

    if (view.mode === 'shoot') {
      this.drawRangeLabels(sel.pos, sel.weapon.optimal, sel.weapon.range);
      for (const e of foes) {
        const pv = computeShot(state.map, sel, sel.pos, e);
        const c = this.center(e.pos);
        if (!pv.canShoot) {
          if (pv.reason === 'Out of range') this.drawTag('OUT OF RANGE', c.x, c.y + tile * 0.62, '#9aa7b3');
          continue;
        }
        this.drawCoverBadge(e.pos, pv);
      }
    }

    // Hovering a reachable tile: what you could hit from it.
    if (hoverNode && hoverNode.cost > 0 && view.hover) {
      for (const e of foes) {
        const pv = computeShot(state.map, sel, view.hover, e);
        if (!pv.canShoot) continue;
        const c = this.center(e.pos);
        this.drawTag(`${pv.hitChance}%`, c.x, c.y + tile * 0.62, '#ffd27a');
      }
    }
  }

  /** "best N" / "max N" labels at the top of the two range rings. */
  private drawRangeLabels(at: Pos, optimal: number, range: number): void {
    const c = this.rawCenter(at);
    const best = this.spun({ x: c.x, y: c.y - optimal * this.tile });
    const max = this.spun({ x: c.x, y: c.y - range * this.tile });
    this.drawTag(`best ${optimal}`, best.x, best.y - 8, '#8fe0a0');
    this.drawTag(`max ${range}`, max.x, max.y - 8, '#ffd27a');
  }

  /** Two rings around a tile: solid green out to full-accuracy range, dashed amber out to maximum range. */
  private drawRangeRings(at: Pos, optimal: number, range: number, alpha: number): void {
    const { ctx, tile } = this;
    const c = this.rawCenter(at);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(120,220,140,0.07)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, optimal * tile, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,220,140,0.95)';
    ctx.stroke();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(255,200,90,0.95)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, range * tile, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** A small dark pill with text, centred on (x, y). */
  private drawTag(text: string, x: number, y: number, color: string): void {
    const { ctx, tile } = this;
    ctx.save();
    ctx.font = `bold ${Math.max(10, Math.round(tile * 0.3))}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 10;
    const h = Math.max(15, tile * 0.42);
    ctx.fillStyle = 'rgba(10,16,22,0.88)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  /** Cover shield: full = solid, half = bottom half filled. `flank` draws it red and broken. */
  private drawShield(x: number, y: number, s: number, kind: 'half' | 'full' | 'flank', alpha = 1): void {
    const { ctx } = this;
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.85, y - s * 0.6);
      ctx.lineTo(x + s * 0.85, y);
      ctx.quadraticCurveTo(x + s * 0.8, y + s * 0.75, x, y + s * 1.1);
      ctx.quadraticCurveTo(x - s * 0.8, y + s * 0.75, x - s * 0.85, y);
      ctx.lineTo(x - s * 0.85, y - s * 0.6);
      ctx.closePath();
    };
    ctx.save();
    ctx.globalAlpha = alpha;
    const col = kind === 'flank' ? '#ff6a55' : '#9fd4ff';
    path();
    ctx.fillStyle = 'rgba(10,16,22,0.85)';
    ctx.fill();
    if (kind === 'full') {
      path();
      ctx.fillStyle = col;
      ctx.fill();
    } else if (kind === 'half') {
      ctx.save();
      path();
      ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(x - s, y, s * 2, s * 1.2);
      ctx.restore();
    }
    path();
    ctx.strokeStyle = kind === 'flank' ? '#ff6a55' : '#dff0ff';
    ctx.lineWidth = Math.max(1.5, s * 0.16);
    ctx.stroke();
    if (kind === 'flank') {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.45, y - s * 0.4);
      ctx.lineTo(x + s * 0.45, y + s * 0.5);
      ctx.moveTo(x + s * 0.45, y - s * 0.4);
      ctx.lineTo(x - s * 0.45, y + s * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cover status of a target as seen by the selected shooter: a shield, or a red broken one when flanked. */
  private drawCoverBadge(at: Pos, pv: ShotPreview): void {
    const { tile } = this;
    const c = this.center(at);
    const kind = pv.flanked ? 'flank' : pv.cover;
    if (kind === 'none') return;
    // to the right of the sprite, at chest height
    this.drawShield(c.x + tile * 0.62, c.y - tile * 0.4, tile * 0.23, kind);
  }

  private drawShotLine(state: GameState, view: ViewState): void {
    const sel = this.selected(state, view);
    if (!sel || !view.preview || !view.previewTargetId) return;
    const target = state.units.find((u) => u.id === view.previewTargetId);
    if (!target) return;
    const { ctx } = this;
    const a = this.rawCenter(sel.pos);
    const b = this.rawCenter(target.pos);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = view.preview.canShoot ? 'rgba(255,210,120,0.9)' : 'rgba(200,200,200,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Someone who is out for good (a beaten rival, or one of yours who was lost): lying where they fell, nothing to click. */
  private drawFallen(u: Unit): void {
    const { ctx, tile } = this;
    const c = this.center(u.pos);
    const ko = koFor(u);
    if (ko) {
      const h = tile * 1.45;
      const w = h * (ko.naturalWidth / ko.naturalHeight);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(ko, c.x - w / 2, c.y - h / 2, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    // no knocked-out art for this one: a small grey X so the spot still shows where they went down
    const r = tile * 0.2;
    ctx.strokeStyle = 'rgba(190,200,210,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x - r, c.y - r);
    ctx.lineTo(c.x + r, c.y + r);
    ctx.moveTo(c.x + r, c.y - r);
    ctx.lineTo(c.x - r, c.y + r);
    ctx.stroke();
  }

  /** A knocked-down unit: a grey, crossed-out marker that still occupies its tile (an ally can revive it). */
  private drawDowned(u: Unit, state: GameState): void {
    const { ctx, tile } = this;
    const c = this.center(u.pos);
    const r = tile * 0.34;
    const pulse = state.active === 'player' ? 0.75 + 0.25 * Math.sin(performance.now() / 250) : 0.75;
    const ko = koFor(u);
    if (ko) {
      // Knocked-out art: a pulsing red ring on the tile (so a revivable ally is easy to spot), the body on top.
      ctx.globalAlpha = pulse * 0.9;
      ctx.strokeStyle = '#e0674e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + tile * 0.05, tile * 0.46, tile * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const h = tile * 1.6;
      const w = h * (ko.naturalWidth / ko.naturalHeight);
      ctx.drawImage(ko, c.x - w / 2, c.y - h / 2, w, h);
      ctx.fillStyle = '#e0674e';
      ctx.font = `bold ${Math.round(tile * 0.24)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('DOWN', c.x, c.y - tile * 0.5);
      return;
    }
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#4b5864';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0674e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x - r * 0.6, c.y - r * 0.6);
    ctx.lineTo(c.x + r * 0.6, c.y + r * 0.6);
    ctx.moveTo(c.x + r * 0.6, c.y - r * 0.6);
    ctx.lineTo(c.x - r * 0.6, c.y + r * 0.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e0674e';
    ctx.font = `bold ${Math.round(tile * 0.24)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('DOWN', c.x, c.y - r - 5);
  }

  private drawUnit(u: Unit, state: GameState, view: ViewState): void {
    const { ctx, tile } = this;
    const c = this.center(u.pos);
    const r = tile * 0.34;
    const isSel = u.id === view.selectedId;
    const exhausted = u.team === 'player' && state.active === 'player' && u.ap <= 0;

    const art = spriteFor(u, this.facingOf(u));
    // Art exists but is still arriving: draw nothing yet instead of flashing the placeholder circle.
    if (!art && spriteUrl(u.sprite ?? u.name.toLowerCase(), this.facingOf(u))) return;
    const feetY = c.y + tile * 0.42;
    const artH = tile * 1.6;

    if (art) {
      // Character art: a team-coloured base at the feet (so friend and foe read at a glance), then the sprite.
      const artW = artH * (art.naturalWidth / art.naturalHeight);
      ctx.globalAlpha = exhausted ? 0.5 : 1;
      ctx.fillStyle = TEAM_COLOR[u.team];
      ctx.strokeStyle = isSel ? '#e8b04a' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.beginPath();
      ctx.ellipse(c.x, feetY - 2, tile * 0.36, tile * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.drawImage(art, c.x - artW / 2, feetY - artH, artW, artH);
      ctx.globalAlpha = 1;
    } else {
      if (isSel) {
        ctx.strokeStyle = '#e8b04a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = TEAM_COLOR[u.team];
      ctx.globalAlpha = exhausted ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(tile * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.name[0], c.x, c.y + 1);
    }

    // HP bar (above the art when there is some)
    const bw = tile * 0.7;
    const bx = c.x - bw / 2;
    const by = art ? feetY - artH - 8 : c.y - r - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = u.hp / u.maxHp > 0.4 ? '#6fcf7a' : '#e0674e';
    ctx.fillRect(bx, by, bw * (u.hp / u.maxHp), 4);

    // AP pips
    if (u.team === 'player' || u.ap > 0) {
      for (let i = 0; i < u.maxAp; i++) {
        ctx.fillStyle = i < u.ap ? '#e8b04a' : 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.arc(c.x - 5 + i * 10, c.y + r + 7, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (u.overwatch) {
      ctx.fillStyle = '#e8b04a';
      ctx.font = `bold ${Math.round(tile * 0.26)}px system-ui, sans-serif`;
      ctx.fillText('OW', c.x + r + 6, c.y - r);
    }
  }

  /** The hover tooltip: hit and crit chance, damage, and what is helping or hurting the shot. */
  private drawPreviewLabel(state: GameState, view: ViewState): void {
    const pv = view.preview;
    if (!pv || !view.previewTargetId) return;
    const target = state.units.find((u) => u.id === view.previewTargetId);
    if (!target) return;
    const { ctx, tile } = this;
    const c = this.center(target.pos);

    const lines: Array<{ text: string; color: string; bold?: boolean }> = [];
    if (pv.canShoot) {
      const hitColor = pv.hitChance >= 66 ? '#8fe0a0' : pv.hitChance >= 40 ? '#ffd27a' : '#ff8a70';
      lines.push({ text: `HIT ${pv.hitChance}%    CRIT ${pv.critChance}%`, color: hitColor, bold: true });
      lines.push({ text: `Damage ${pv.dmgMin}-${pv.dmgMax}${pv.critChance > 0 ? ` (crit x1.5)` : ''}`, color: '#d7e0e8' });
      lines.push(
        pv.rangePenalty > 0
          ? { text: `Range ${pv.distance.toFixed(1)}: -${pv.rangePenalty} (best within ${pv.optimal})`, color: '#ffd27a' }
          : { text: `Range ${pv.distance.toFixed(1)}: full accuracy`, color: '#8fe0a0' },
      );
      if (pv.flanked) lines.push({ text: 'FLANKED: a hit is a guaranteed crit', color: '#ff8a70', bold: true });
      else if (pv.cover === 'none') lines.push({ text: `EXPOSED: no cover, +${EXPOSED_CRIT_BONUS}% crit`, color: '#ffb347', bold: true });
      else lines.push({ text: `${pv.cover === 'full' ? 'Full' : 'Half'} cover: -${pv.coverPenalty}`, color: '#9fd4ff' });
    } else if (pv.reason === 'Out of range') {
      lines.push({ text: 'OUT OF RANGE', color: '#ff8a70', bold: true });
      lines.push({ text: `${pv.distance.toFixed(1)} tiles away, max ${pv.range}`, color: '#d7e0e8' });
    } else {
      lines.push({ text: (pv.reason ?? 'Cannot shoot').toUpperCase(), color: '#ff8a70', bold: true });
    }

    const fs = Math.max(11, Math.round(tile * 0.34));
    const lh = fs + 5;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let w = 0;
    for (const l of lines) {
      ctx.font = `${l.bold ? 'bold ' : ''}${fs}px system-ui, sans-serif`;
      w = Math.max(w, ctx.measureText(l.text).width);
    }
    w += 18;
    const h = lines.length * lh + 10;
    const cw = this.canvas.clientWidth;
    let bx = c.x - w / 2;
    let by = c.y - tile * 0.6 - h;
    if (by < 4) by = c.y + tile * 0.6; // not enough room above: go below
    bx = Math.min(Math.max(4, bx), cw - w - 4);
    ctx.fillStyle = 'rgba(10,16,22,0.94)';
    ctx.strokeStyle = pv.flanked && pv.canShoot ? '#ff8a70' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, w, h);
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    lines.forEach((l, i) => {
      ctx.font = `${l.bold ? 'bold ' : ''}${fs}px system-ui, sans-serif`;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, bx + 9, by + 5 + lh * i + lh / 2);
    });
    ctx.restore();
  }

  private drawEffects(): void {
    const now = performance.now();
    const { ctx, tile } = this;
    this.effects = this.effects.filter((e) => now - e.born < e.ttl);
    for (const e of this.effects) {
      const t = (now - e.born) / e.ttl;
      ctx.globalAlpha = 1 - t * t;
      if (e.kind === 'line' && e.from && e.to) {
        const a = this.center(e.from);
        const b = this.center(e.to);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (e.kind === 'text' && e.at && e.text) {
        const c = this.center(e.at);
        ctx.fillStyle = e.color;
        ctx.font = `bold ${Math.round(tile * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.text, c.x, c.y - tile * 0.5 - t * tile * 0.7);
      }
    }
    ctx.globalAlpha = 1;
  }
}
