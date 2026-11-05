import { CELL, GRID, WORLD, regionAt, siteNear, type Site, type Vec, type WorldState } from './world';

export interface WorldView {
  hover: Vec | null;
  /** debug overlay: walkable grid + region outlines (toggled with G) */
  debug: boolean;
}

const KIND_COLOR: Record<Site['kind'], string> = {
  home: '#6fd08c',
  landmark: '#8a9aa8',
  wreck: '#7ec4e8',
  ruin: '#d8c27a',
  outpost: '#e0885a',
  cave: '#c27ae0',
};

/** Draws the painted world map (letterboxed), sites, the party and the current click-path. */
export class WorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private img = new Image();
  private loaded = false;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.img.onload = () => {
      this.loaded = true;
    };
    this.img.src = `${import.meta.env.BASE_URL}worldmap.png`;
  }

  get ready(): boolean {
    return this.loaded;
  }

  /** Client pixel -> reference-map coordinate, or null if outside the map. */
  toWorld(clientX: number, clientY: number): Vec | null {
    const r = this.canvas.getBoundingClientRect();
    const x = (clientX - r.left - this.ox) / this.scale;
    const y = (clientY - r.top - this.oy) / this.scale;
    if (x < 0 || y < 0 || x > WORLD.size[0] || y > WORLD.size[1]) return null;
    return { x, y };
  }

  private layout(): { w: number; h: number } {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(w / WORLD.size[0], h / WORLD.size[1]);
    this.ox = (w - WORLD.size[0] * this.scale) / 2;
    this.oy = (h - WORLD.size[1] * this.scale) / 2;
    return { w, h };
  }

  private sx(x: number): number {
    return this.ox + x * this.scale;
  }
  private sy(y: number): number {
    return this.oy + y * this.scale;
  }

  draw(world: WorldState, view: WorldView): void {
    const { w, h } = this.layout();
    const { ctx } = this;
    ctx.fillStyle = '#0b1117';
    ctx.fillRect(0, 0, w, h);

    if (this.loaded) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img, this.ox, this.oy, WORLD.size[0] * this.scale, WORLD.size[1] * this.scale);
    } else {
      ctx.fillStyle = '#8a9aa8';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Loading map...', 20, 30);
    }

    if (view.debug) this.drawDebug();
    this.drawSites(world, view);
    this.drawPath(world);
    this.drawParty(world);
    this.drawLabel(world, view);
  }

  private drawDebug(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(80,220,120,0.18)';
    for (let cy = 0; cy < GRID.h; cy++) {
      for (let cx = 0; cx < GRID.w; cx++) {
        if (GRID.cells[cy * GRID.w + cx] === 1) {
          ctx.fillRect(this.sx(cx * CELL), this.sy(cy * CELL), CELL * this.scale, CELL * this.scale);
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    WORLD.coast.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(this.sx(x), this.sy(y)) : ctx.lineTo(this.sx(x), this.sy(y))));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,80,0.7)';
    ctx.setLineDash([5, 4]);
    for (const r of WORLD.regions) {
      if (r.shape.type !== 'circle' || r.shape.r > 1000) continue;
      ctx.beginPath();
      ctx.arc(this.sx(r.shape.x), this.sy(r.shape.y), r.shape.r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawSites(world: WorldState, view: WorldView): void {
    const { ctx } = this;
    const here = siteNear(world.pos);
    const hoverSite = view.hover ? siteNear(view.hover) : null;
    for (const s of WORLD.sites) {
      if (s.kind === 'landmark' && !view.debug) continue; // flavour markers stay invisible unless you walk onto them
      const cx = this.sx(s.x);
      const cy = this.sy(s.y);
      const cleared = !!world.cleared[s.id];
      const active = here?.id === s.id || hoverSite?.id === s.id;
      ctx.lineWidth = active ? 3 : 2;
      ctx.strokeStyle = cleared ? 'rgba(160,170,180,0.85)' : KIND_COLOR[s.kind];
      ctx.setLineDash(s.difficulty && !cleared ? [] : [4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(8, s.radius * this.scale * 0.75), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (cleared) {
        ctx.strokeStyle = '#9fe0b0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx - 1, cy + 5);
        ctx.lineTo(cx + 7, cy - 6);
        ctx.stroke();
      } else if (s.difficulty) {
        ctx.fillStyle = KIND_COLOR[s.kind];
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!'.repeat(s.difficulty), cx, cy + 4);
        ctx.textAlign = 'start';
      }
    }
  }

  private drawPath(world: WorldState): void {
    if (world.path.length === 0) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(this.sx(world.pos.x), this.sy(world.pos.y));
    for (const p of world.path) ctx.lineTo(this.sx(p.x), this.sy(p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    const end = world.path[world.path.length - 1];
    ctx.beginPath();
    ctx.arc(this.sx(end.x), this.sy(end.y), 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawParty(world: WorldState): void {
    const { ctx } = this;
    const x = this.sx(world.pos.x);
    const y = this.sy(world.pos.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 5, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3d8fc2';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawLabel(world: WorldState, view: WorldView): void {
    const target = view.hover ? siteNear(view.hover) : siteNear(world.pos);
    const r = view.hover ? regionAt(view.hover) : regionAt(world.pos);
    const { ctx } = this;
    const text = target ? `${target.name}${world.cleared[target.id] ? ' (cleared)' : ''}` : r.name;
    ctx.font = '12px system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    const px = 12;
    const py = 12;
    ctx.fillStyle = 'rgba(11,17,23,0.82)';
    ctx.fillRect(px, py, tw + 16, 24);
    ctx.fillStyle = '#d7e0e8';
    ctx.fillText(text, px + 8, py + 16);
  }
}
