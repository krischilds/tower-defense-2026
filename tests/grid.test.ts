import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { MAPS } from '../src/data/maps';

describe('Grid', () => {
  it('builds from a map definition', () => {
    const g = Grid.fromMap(MAPS[0]);
    expect(g.width).toBe(16);
    expect(g.height).toBe(16);
    expect(g.find('spawn')).toHaveLength(1);
    expect(g.find('objective')).toHaveLength(1);
    expect(g.get(4, 2)?.type).toBe('blocked');
  });

  it('bounds checks', () => {
    const g = new Grid(3, 3);
    expect(g.get(-1, 0)).toBeUndefined();
    expect(g.get(3, 0)).toBeUndefined();
    expect(g.get(2, 2)?.type).toBe('buildable');
  });

  it('rejects malformed maps', () => {
    expect(() => Grid.fromMap({ id: 'x', name: 'x', rows: ['..', '.'] })).toThrow();
    expect(() => Grid.fromMap({ id: 'x', name: 'x', rows: ['.?'] })).toThrow();
  });
});
