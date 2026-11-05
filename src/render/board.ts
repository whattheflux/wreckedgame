import type { Biome, GameState, Pos, Terrain, Unit } from '../engine/types';
import type { PathNode } from '../engine/grid';
import type { Hint } from '../engine/hint';
import { computeShot, type ShotPreview } from '../engine/combat';

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

export class BoardRenderer {
  private ctx: CanvasRenderingContext2D;
  private tile = 32;
  private ox = 0;
  private oy = 0;
  private effects: Effect[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
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

    if (view.mode === 'move' && view.reach) {
      for (const n of view.reach.values()) {
        if (n.cost === 0) continue;
        const o = this.px(n.pos);
        ctx.fillStyle = n.cost <= sel.mobility ? 'rgba(80,170,255,0.30)' : 'rgba(255,205,80,0.26)';
        ctx.fillRect(o.x + 1, o.y + 1, tile - 2, tile - 2);
      }
    }

    if (view.mode === 'shoot') {
      for (const e of state.units) {
        if (!e.alive || e.team === sel.team || !this.canSee(e, view)) continue;
        const pv = computeShot(state.map, sel, sel.pos, e);
        if (!pv.canShoot) continue;
        const c = this.center(e.pos);
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

  private drawUnit(u: Unit, state: GameState, view: ViewState): void {
    const { ctx, tile } = this;
    const c = this.center(u.pos);
    const r = tile * 0.34;
    const isSel = u.id === view.selectedId;
    const exhausted = u.team === 'player' && state.active === 'player' && u.ap <= 0;

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

    // HP bar
    const bw = tile * 0.7;
    const bx = c.x - bw / 2;
    const by = c.y - r - 8;
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

  private drawPreviewLabel(state: GameState, view: ViewState): void {
    if (!view.preview || !view.previewTargetId) return;
    const target = state.units.find((u) => u.id === view.previewTargetId);
    if (!target) return;
    const { ctx, tile } = this;
    const c = this.center(target.pos);
    const text = view.preview.canShoot ? `${view.preview.hitChance}%` : view.preview.reason ?? '';
    ctx.font = `bold ${Math.round(tile * 0.36)}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width + 12;
    const bx = c.x - tw / 2;
    const by = c.y - tile * 0.95;
    ctx.fillStyle = 'rgba(10,16,22,0.88)';
    ctx.fillRect(bx, by, tw, tile * 0.5);
    ctx.fillStyle = view.preview.canShoot ? '#ffd27a' : '#9aa7b3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.x, by + tile * 0.26);
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
