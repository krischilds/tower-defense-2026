import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';

const world = (rows: string[], credits = 1000) => {
  const w = new World(Grid.fromMap({ id: 't', name: 't', rows }), credits);
  w.spawning = false;
  return w;
};

const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) w.update(1 / 60);
};

describe('enemy movement', () => {
  it('walks to the objective, damages the core and is removed', () => {
    const w = world(['S...O']);
    w.spawnEnemy('basic', { x: 0, y: 0 });
    run(w, 1);
    expect(w.enemies).toHaveLength(1);
    expect(w.enemies[0].x).toBeGreaterThan(1);
    run(w, 3);
    expect(w.enemies).toHaveLength(0);
    expect(w.coreHealth).toBe(w.coreMax - 1);
  });

  it('different enemy types move at different speeds', () => {
    const w = world(['S.........O']);
    const slow = w.spawnEnemy('tank', { x: 0, y: 0 });
    const fast = w.spawnEnemy('runner', { x: 0, y: 0 });
    run(w, 1);
    expect(fast.x).toBeGreaterThan(slow.x * 2);
  });

  it('reroutes around a tower placed in its path', () => {
    const w = world(['S.....', '......', '.....O']);
    const e = w.spawnEnemy('basic', { x: 0, y: 0 });
    run(w, 0.5);
    const ahead = w.flow.path({ x: e.to.x, y: e.to.y }).find((p) => p.x >= 3 && p.x < 5 && p !== undefined)!;
    expect(w.placeTower('cannon', ahead.x, ahead.y).ok).toBe(true);
    const visited = new Set<string>();
    for (let i = 0; i < 600 && w.enemies.length; i++) {
      w.update(1 / 60);
      for (const en of w.enemies) visited.add(`${Math.round(en.x)},${Math.round(en.y)}`);
    }
    expect(visited.has(`${ahead.x},${ahead.y}`)).toBe(false);
    expect(w.enemies).toHaveLength(0); // reached the core or was shot down
  });

  it('refuses towers on tiles an enemy is using', () => {
    const w = world(['S...O']);
    const e = w.spawnEnemy('basic', { x: 0, y: 0 });
    run(w, 0.2);
    expect(w.placeTower('cannon', e.to.x, e.to.y)).toEqual({ ok: false, reason: 'enemy-in-way' });
  });

  it('refuses a tower that would cut a live enemy off from the objective', () => {
    const w = world(['S.O', '#.#', '...']);
    w.spawnEnemy('basic', { x: 0, y: 2 });
    // The spawn still has the top row, but the enemy's only exit is (1,1).
    expect(w.checkPlacement(1, 1)).toBe('blocks-path');
  });
  it('ends the game when core health reaches zero', () => {
    const w = world(['SO']);
    for (let i = 0; i < 25; i++) {
      w.spawnEnemy('basic', { x: 0, y: 0 });
      run(w, 1);
    }
    expect(w.coreHealth).toBe(0);
    expect(w.status).toBe('defeat');
  });

  it('spawns waves automatically when enabled and resets cleanly', () => {
    const w = world(['S.........O']);
    w.spawning = true;
    run(w, 12);
    expect(w.waves.started).toBe(1);
    expect(w.enemies.length).toBeGreaterThan(1);
    w.placeTower('cannon', 5, 0);
    w.reset();
    expect(w.enemies).toHaveLength(0);
    expect(w.allTowers()).toHaveLength(0);
    expect(w.credits).toBe(1000);
  });
});
