import { describe, expect, it } from 'vitest';
import { BASE_SKILLS, WEAPONS, skillsOf } from '../engine';
import { unit } from '../engine/testutil';
import { attackTip, handsHtml, iconKey, moveTip, skillTip, tipHtml } from './actionbar';

describe('attack tooltip', () => {
  it('says a heavy attack ends the turn, and a light one is just 1 AP', () => {
    const heavy = unit({ id: 'h', team: 'player', weapon: WEAPONS.javelin });
    const light = unit({ id: 'l', team: 'player', weapon: WEAPONS.slingshot });
    expect(attackTip(heavy).cost).toBe('1 AP (ends turn)');
    expect(attackTip(light).cost).toBe('1 AP');
    expect(attackTip(heavy).lines.join(' ')).toMatch(/whole turn/);
    expect(attackTip(light).lines.join(' ')).toMatch(/move after attacking, or attack twice/);
  });

  it('warns when there is no ammo', () => {
    const u = unit({ id: 'a', team: 'player', weapon: WEAPONS.slingshot, ammo: 0 });
    expect(attackTip(u).lines.join(' ')).toMatch(/Out of ammo/);
  });

  it('renders to html without raw weapon names', () => {
    const html = tipHtml(attackTip(unit({ id: 'a', team: 'player', weapon: { ...WEAPONS.pole, name: 'Pole <b>' } })));
    expect(html).not.toContain('Pole <b>');
    expect(html).toContain('Basic Attack');
  });
});

describe('move tooltip', () => {
  it('spells out the 1 AP and dash distances', () => {
    const t = moveTip(unit({ id: 'm', team: 'player', mobility: 6 }));
    expect(t.lines[0]).toContain('6 tiles for 1 AP');
    expect(t.lines[0]).toContain('12 tiles');
  });
});

describe('hands display', () => {
  it('puts a one-hander in the right hand with the left hand bare', () => {
    const html = handsHtml(WEAPONS.slingshot);
    expect(html).toContain('slot bare');
    expect(html).not.toContain('slot ghost');
    expect(html).toContain('1-handed');
    expect(html).toContain('light');
  });

  it('shows a two-hander in both hands, the left one faded', () => {
    const html = handsHtml(WEAPONS.javelin);
    expect(html).toContain('slot ghost');
    expect(html).not.toContain('slot bare');
    expect(html).toContain('2-handed');
    expect(html).toContain('heavy');
  });
});

describe('weapon art', () => {
  it('maps weapon names to their icon', () => {
    expect(iconKey('Flare Gun')).toBe('flaregun');
    expect(iconKey('Sharpened Pole')).toBe('pole');
    expect(iconKey('Javelin')).toBe('javelin');
    expect(iconKey('Spork')).toBe('generic');
  });

  it('every weapon in the game has real art, not the generic stick', () => {
    for (const w of Object.values(WEAPONS)) expect(iconKey(w.name), w.name).not.toBe('generic');
  });
});

describe('skills', () => {
  it('everyone has the base skills, each with a tooltip', () => {
    const u = unit({ id: 's', team: 'player' });
    expect(skillsOf(u).map((s) => s.id)).toEqual(['overwatch', 'reload', 'revive']);
    for (const s of BASE_SKILLS) expect(skillTip(s).lines.length).toBeGreaterThan(0);
  });
});
