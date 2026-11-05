import { describe, expect, it } from 'vitest';
import { DIRS, dirFromDelta, nearestDir, previewUrl, spriteUrl, type Dir } from './sprites';

describe('dirFromDelta', () => {
  it('maps the eight steps to their facings (y points down)', () => {
    expect(dirFromDelta(1, 0)).toBe('right');
    expect(dirFromDelta(1, 1)).toBe('down-right');
    expect(dirFromDelta(0, 1)).toBe('down');
    expect(dirFromDelta(-1, 1)).toBe('down-left');
    expect(dirFromDelta(-1, 0)).toBe('left');
    expect(dirFromDelta(-1, -1)).toBe('up-left');
    expect(dirFromDelta(0, -1)).toBe('up');
    expect(dirFromDelta(1, -1)).toBe('up-right');
  });

  it('snaps longer vectors to the nearest facing, and ignores no movement', () => {
    expect(dirFromDelta(10, 1)).toBe('right');
    expect(dirFromDelta(5, 4)).toBe('down-right');
    expect(dirFromDelta(-1, 9)).toBe('down');
    expect(dirFromDelta(0, 0)).toBeNull();
  });
});

describe('nearestDir', () => {
  it('uses the exact facing when it exists', () => {
    expect(nearestDir('left', DIRS)).toBe('left');
  });

  it('falls back to the closest drawn facing, wrapping around the circle', () => {
    expect(nearestDir('up-right', ['right', 'down', 'left'])).toBe('right');
    expect(nearestDir('down-left', ['up', 'right', 'left'])).toBe('left');
    expect(nearestDir('up-right', ['up-left', 'down-right'] as Dir[])).toBe('up-left'); // equally close: first listed wins
  });

  it('returns null when nothing is drawn', () => {
    expect(nearestDir('up', [])).toBeNull();
  });
});

describe('bundled art', () => {
  it('has all eight facings for both player bodies', () => {
    for (const body of ['pc-male', 'pc-female', 'scott', 'amy', 'tyson', 'anna', 'drama-guy']) {
      for (const d of DIRS) expect(spriteUrl(body, d), `${body}/${d}`).toBeTruthy();
      expect(previewUrl(body)).toBe(spriteUrl(body, 'down'));
    }
    expect(spriteUrl('pc-male', 'up')).not.toBe(spriteUrl('pc-male', 'down'));
    expect(spriteUrl('pc-male', 'down')).not.toBe(spriteUrl('pc-female', 'down'));
  });

  it('has nothing for a unit without art', () => {
    expect(spriteUrl('nobody', 'down')).toBeNull();
  });
});
