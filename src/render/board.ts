import type { Biome, GameState, Pos, Terrain, Unit } from '../engine/types';
import { coverAgainst, dist, posKey, type PathNode } from '../engine/grid';
import type { Hint } from '../engine/hint';
import { computeShot, type ShotPreview } from '../engine/combat';
import { dirFromDelta, loadedImage, spriteUrl, type Dir } from './sprites';

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

const TERRAIN_COLOR: Record<Terrain, string> = {
  floor: '#6b6246',
  wall: '#3f444c',
  half: '#6b6246',
  full: '#6b6246',
  water: '#15324a',
};

const BIOME_FLOOR: Record<Biome, string> = {
  beach: '#7a7150',
  forest: '#3f5a36',
  wastes: '#6e5a46',
  marsh: '#46583f',
  mountain: '#5a5d63',
  canyon: '#74523c',
  volcano: '#4a3330',
};
const BIOME_WATER: Partial<Record<Biome, string>> = { marsh: '#1f4a45', volcano: '#7a2a10' };

const TEAM_COLOR = { player: '#3d8fc2', enemy: '#c2503d' } as const;

/** The unit's art for the way it is facing once it has loaded, else null (draw the circle). */
function spriteFor(u: Unit, facing: Dir): HTMLImageElement | null {
  const url = spriteUrl(u.sprite ?? u.name.toLowerCase(), facing);
  return url ? loadedImage(url) : null;
}

export class BoardRenderer {
  private ctx: CanvasRenderingContext2D;
  private tile = 32;
  private ox = 0;
  private oy = 0;
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

  resetFacing(): void {
    this.facing.clear();
  }

  private facingOf(u: Unit): Dir {
    return this.facing.get(u.id) ?? (u.team === 'player' ? 'right' : 'left');
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
    const x = Math.floor((clientX - rect.left - this.ox) / this.tile);
    const y = Math.floor((clientY - rect.top - this.oy) / this.tile);
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return null;
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
    this.tile = Math.max(12, Math.floor(Math.min(w / state.map.width, h / state.map.height)));
    this.ox = Math.floor((w - this.tile * state.map.width) / 2);
    this.oy = Math.floor((h - this.tile * state.map.height) / 2);
    return { w, h };
  }

  private px(p: Pos): { x: number; y: number } {
    return { x: this.ox + p.x * this.tile, y: this.oy + p.y * this.tile };
  }

  private center(p: Pos): { x: number; y: number } {
    const o = this.px(p);
    return { x: o.x + this.tile / 2, y: o.y + this.tile / 2 };
  }

  draw(state: GameState, view: ViewState): void {
    const { w, h } = this.layout(state);
    const { ctx, tile } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1117';
    ctx.fillRect(0, 0, w, h);

    this.drawTerrain(state);
    this.drawFog(state, view);
    this.drawOverlays(state, view);
    this.drawShotLine(state, view);
    for (const u of state.units) if (u.downed && !u.alive) this.drawDowned(u, state);
    for (const u of state.units) if (u.alive && this.canSee(u, view)) this.drawUnit(u, state, view);
    this.drawPreviewLabel(state, view);
    this.drawEffects();
    this.drawHint(state, view);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.map.width; x++) {
      ctx.moveTo(this.ox + x * tile + 0.5, this.oy);
      ctx.lineTo(this.ox + x * tile + 0.5, this.oy + state.map.height * tile);
    }
    for (let y = 0; y <= state.map.height; y++) {
      ctx.moveTo(this.ox, this.oy + y * tile + 0.5);
      ctx.lineTo(this.ox + state.map.width * tile, this.oy + y * tile + 0.5);
    }
    ctx.stroke();
  }

  private drawTerrain(state: GameState): void {
    const { ctx, tile } = this;
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const t = state.map.tiles[y][x];
        const o = this.px({ x, y });
        ctx.fillStyle =
          t === 'water'
            ? (state.map.biome && BIOME_WATER[state.map.biome]) || TERRAIN_COLOR.water
            : t === 'wall'
              ? TERRAIN_COLOR.wall
              : state.map.biome
                ? BIOME_FLOOR[state.map.biome]
                : TERRAIN_COLOR[t];
        ctx.fillRect(o.x, o.y, tile, tile);
        if (t === 'wall') {
          ctx.fillStyle = '#585e68';
          ctx.fillRect(o.x + 2, o.y + 2, tile - 4, tile - 4);
        } else if (t === 'half') {
          const s = tile * 0.55;
          ctx.fillStyle = '#9a8660';
          ctx.fillRect(o.x + (tile - s) / 2, o.y + (tile - s) / 2, s, s);
        } else if (t === 'full') {
          const s = tile * 0.86;
          ctx.fillStyle = '#7a5c3e';
          ctx.fillRect(o.x + (tile - s) / 2, o.y + (tile - s) / 2, s, s);
          ctx.strokeStyle = '#4e3a26';
          ctx.lineWidth = 2;
          ctx.strokeRect(o.x + (tile - s) / 2, o.y + (tile - s) / 2, s, s);
        }
      }
    }
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
  private drawHint(state: GameState, view: ViewState): void {
    const h = view.hint;
    if (!h) return;
    const { ctx, tile } = this;
    const bw = state.map.width * tile;
    const bh = state.map.height * tile;
    const cx = this.ox + bw / 2;
    const cy = this.oy + bh / 2;
    const dx = Math.cos(h.angle);
    const dy = Math.sin(h.angle);
    const margin = 34;
    const tx = Math.abs(dx) > 1e-6 ? (bw / 2 - margin) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-6 ? (bh / 2 - margin) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const px = cx + dx * t;
    const py = cy + dy * t;

    ctx.save();
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(performance.now() / 350);
    ctx.translate(px, py);
    ctx.rotate(h.angle);
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
      for (const n of view.reach.values()) {
        if (n.cost === 0) continue;
        const o = this.px(n.pos);
        ctx.fillStyle = n.cost <= sel.mobility ? 'rgba(80,170,255,0.30)' : 'rgba(255,205,80,0.26)';
        ctx.fillRect(o.x + 1, o.y + 1, tile - 2, tile - 2);
      }
      // Cover you would get on each reachable tile, against the nearest enemy you can see.
      const nearest = (p: Pos): Unit | undefined => foes.reduce<Unit | undefined>((b, e) => (!b || dist(p, e.pos) < dist(p, b.pos) ? e : b), undefined);
      for (const n of view.reach.values()) {
        const foe = nearest(n.pos);
        if (!foe) break;
        const cover = coverAgainst(state.map, foe.pos, n.pos);
        if (cover === 'none') continue;
        const o = this.px(n.pos);
        this.drawShield(o.x + tile * 0.5, o.y + tile * 0.5, tile * 0.2, cover, 0.9);
      }
    }

    // Weapon range: green ring = full accuracy, amber ring = maximum range. Brightest while aiming.
    // Hovering a reachable tile shows the same rings from there, and what you could hit from it.
    const aiming = view.mode === 'shoot';
    this.drawRangeRings(sel.pos, sel.weapon.optimal, sel.weapon.range, aiming ? 1 : 0.45, aiming);
    if (hoverNode && hoverNode.cost > 0 && view.hover) {
      this.drawRangeRings(view.hover, sel.weapon.optimal, sel.weapon.range, 0.9, false);
      for (const e of foes) {
        const pv = computeShot(state.map, sel, view.hover, e);
        if (!pv.canShoot) continue;
        const c = this.center(e.pos);
        this.drawTag(`${pv.hitChance}%`, c.x, c.y + tile * 0.62, '#ffd27a');
      }
    }

    if (view.mode === 'shoot') {
      for (const e of state.units) {
        if (!e.alive || e.team === sel.team || !this.canSee(e, view)) continue;
        const pv = computeShot(state.map, sel, sel.pos, e);
        const c = this.center(e.pos);
        if (!pv.canShoot) {
          if (pv.reason === 'Out of range') this.drawTag('OUT OF RANGE', c.x, c.y + tile * 0.62, '#9aa7b3');
          continue;
        }
        ctx.strokeStyle = 'rgba(255,90,70,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, tile * 0.46, 0, Math.PI * 2);
        ctx.stroke();
        this.drawCoverBadge(e.pos, pv);
      }
    }

    if (view.hover) {
      const o = this.px(view.hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, tile - 2, tile - 2);
    }
  }

  /** Two rings around a tile: solid green out to full-accuracy range, dashed amber out to maximum range. */
  private drawRangeRings(at: Pos, optimal: number, range: number, alpha: number, labels: boolean): void {
    const { ctx, tile } = this;
    const c = this.center(at);
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
    if (labels) {
      this.drawTag(`best ${optimal}`, c.x, c.y - optimal * tile - 8, '#8fe0a0');
      this.drawTag(`max ${range}`, c.x, c.y - range * tile - 8, '#ffd27a');
    }
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
    const o = this.px(at);
    const kind = pv.flanked ? 'flank' : pv.cover;
    if (kind === 'none') return;
    this.drawShield(o.x + tile * 0.82, o.y + tile * 0.22, tile * 0.2, kind);
  }

  private drawShotLine(state: GameState, view: ViewState): void {
    const sel = this.selected(state, view);
    if (!sel || !view.preview || !view.previewTargetId) return;
    const target = state.units.find((u) => u.id === view.previewTargetId);
    if (!target) return;
    const { ctx } = this;
    const a = this.center(sel.pos);
    const b = this.center(target.pos);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = view.preview.canShoot ? 'rgba(255,210,120,0.9)' : 'rgba(200,200,200,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** A knocked-down unit: a grey, crossed-out marker that still occupies its tile (an ally can revive it). */
  private drawDowned(u: Unit, state: GameState): void {
    const { ctx, tile } = this;
    const c = this.center(u.pos);
    const r = tile * 0.34;
    const pulse = state.active === 'player' ? 0.75 + 0.25 * Math.sin(performance.now() / 250) : 0.75;
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
      else if (pv.cover === 'none') lines.push({ text: 'No cover', color: '#d7e0e8' });
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
    const { w: cw } = this.layout(state);
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
