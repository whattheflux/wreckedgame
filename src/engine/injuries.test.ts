import { describe, expect, it } from 'vitest';
import { INJURIES, MAX_INJURIES, PERMANENT_INJURIES, createStarterRoster, dropIllegalGear, effectiveStats, gearOf, giveInjury, handsOf, severityOf, tickInjuries, wieldProblem } from './index';

const member = (id = 'p2') => createStarterRoster().find((m) => m.id === id)!;

describe('body-part injuries', () => {
  it('every injury has a part, a blurb, and permanent ones do not heal', () => {
    for (const [id, d] of Object.entries(INJURIES)) {
      expect(d.part, id).toBeTruthy();
      expect(d.blurb, id).toBeTruthy();
      expect(d.permanent ? d.recovery === 0 : d.recovery > 0, id).toBe(true);
    }
    expect(severityOf('torn-tendon')).toBe('serious');
    expect(severityOf('shaken')).toBe('light');
    expect(severityOf('lost-leg')).toBe('permanent');
  });

  it('a permanent roll gives a scar that stays through any number of days', () => {
    const m = member();
    const id = giveInjury(m, { rngState: 1 }, { permanentChance: 1 });
    expect(PERMANENT_INJURIES).toContain(id);
    tickInjuries(m, [], 50);
    expect(m.injuries.map((i) => i.id)).toEqual([id]);
    expect(effectiveStats(m).mobility + effectiveStats(m).aim).toBeLessThan(effectiveStats(member()).mobility + effectiveStats(member()).aim);
  });

  it('healing injuries are capped and replace the closest to mending; scars are extra', () => {
    const m = member();
    m.injuries = [{ id: 'lost-leg', left: 0 }];
    for (let i = 0; i < 12; i++) giveInjury(m, { rngState: i * 7 + 3 });
    expect(m.injuries.filter((i) => !INJURIES[i.id].permanent).length).toBeLessThanOrEqual(MAX_INJURIES);
    expect(m.injuries.some((i) => i.id === 'lost-leg')).toBe(true);
  });

  it('days tick healing injuries and report what mended', () => {
    const m = member();
    m.injuries = [{ id: 'shaken', left: 1 }, { id: 'torn-tendon', left: 6 }];
    const notes: string[] = [];
    expect(tickInjuries(m, notes)).toEqual(['shaken']);
    expect(notes[0]).toMatch(/recovered from shaken up/);
    expect(m.injuries).toEqual([{ id: 'torn-tendon', left: 5 }]);
    tickInjuries(m, [], 2);
    expect(m.injuries[0].left).toBe(3);
  });

  it('a lost hand rules out two-handers: they come off and cannot go back on', () => {
    const scott = member('p2'); // javelin
    expect(wieldProblem(scott, gearOf(scott))).toBeNull();
    scott.injuries = [{ id: 'lost-hand', left: 0 }];
    expect(handsOf(scott)).toBe(1);
    expect(wieldProblem(scott, gearOf(scott))).toMatch(/one hand/);
    expect(dropIllegalGear(scott)).toEqual(['javelin']);
    expect(gearOf(scott).rightHand).toBeUndefined();
    expect(wieldProblem(scott, gearOf(scott))).toBeNull();
  });
});
