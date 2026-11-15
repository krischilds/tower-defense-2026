import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { computeFlowField } from '../src/sim/pathfinding';
import { World } from '../src/sim/world';

const grid = (rows: string[]) => Grid.fromMap({ id: 't', name: 't', rows });

describe('pathfinding', () => {
  it('finds a straight route', () => {
    const g = grid(['S..O']);
    const f = computeFlowField(g, g.find('objective'), () => false);
    const p = f.path({ x: 0, y: 0 });
    expect(p.map((q) => q.x)).toEqual([0, 1, 2, 3]);
  });

  it('routes around obstacles and does not cut corners', () => {
    const g = grid(['S#.', '.#.', '..O']);
    const f = computeFlowField(g, g.find('objective'), () => false);
    const p = f.path({ x: 0, y: 0 });
    expect(p[p.length - 1]).toEqual({ x: 2, y: 2 });
    expect(p.some((q) => g.get(q.x, q.y)!.type === 'blocked')).toBe(false);
  });

  it('reports unreachable tiles', () => {
    const g = grid(['S#O']);
    const f = computeFlowField(g, g.find('objective'), () => false);
    expect(f.reachable({ x: 0, y: 0 })).toBe(false);
    expect(f.path({ x: 0, y: 0 })).toEqual([]);
  });
});

describe('World placement', () => {
  it('places towers, charges credits and reroutes', () => {
    const w = new World(grid(['S...', '....', '...O']), 200);
    const before = w.flow.distanceAt(0, 0);
    expect(w.placeTower('cannon', 1, 1).ok).toBe(true);
    expect(w.credits).toBe(150);
    expect(w.flow.distanceAt(0, 0)).toBeGreaterThanOrEqual(before);
    expect(w.routes()[0].some((p) => p.x === 1 && p.y === 1)).toBe(false);
  });

  it('rejects occupied, non-buildable and unaffordable placements', () => {
    const w = new World(grid(['S...', '....', '...O']), 60);
    expect(w.placeTower('cannon', 1, 1).ok).toBe(true);
    expect(w.placeTower('cannon', 1, 1)).toEqual({ ok: false, reason: 'occupied' });
    expect(w.placeTower('cannon', 0, 0)).toEqual({ ok: false, reason: 'not-buildable' });
    expect(w.placeTower('cannon', 2, 1)).toEqual({ ok: false, reason: 'insufficient-funds' });
  });

  it('refuses placements that would block every route', () => {
    const w = new World(grid(['S.O']), 500);
    expect(w.placeTower('cannon', 1, 0)).toEqual({ ok: false, reason: 'blocks-path' });
    expect(w.allTowers()).toHaveLength(0);
    expect(w.credits).toBe(500);
  });

  it('refuses the last approach to the objective (no diagonal corner cutting)', () => {
    const w = new World(grid(['S..', '...', '..O']), 1000);
    expect(w.placeTower('cannon', 1, 2).ok).toBe(true);
    expect(w.placeTower('cannon', 2, 1)).toEqual({ ok: false, reason: 'blocks-path' });
  });

  it('sells for a partial refund and restores the route', () => {
    const w = new World(grid(['S..', '...', '..O']), 100);
    w.placeTower('cannon', 1, 1);
    expect(w.sellTower(1, 1)).toBe(35);
    expect(w.credits).toBe(85);
    expect(w.isOccupied(1, 1)).toBe(false);
  });
});

describe('World on the real map', () => {
  it('allows scattered towers without falsely reporting a blocked path (float precision regression)', async () => {
    const { MAPS } = await import('../src/data/maps');
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    for (const [x, y] of [[8, 8], [10, 7], [6, 8], [9, 9], [5, 10]]) {
      expect(w.placeTower('cannon', x, y).ok).toBe(true);
    }
  });
});
