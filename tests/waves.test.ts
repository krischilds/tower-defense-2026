import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';
import { WAVES, type WaveDef } from '../src/data/waves';
import { ENEMIES } from '../src/data/enemies';

const TEST_WAVES: WaveDef[] = [
  { groups: [{ enemy: 'basic', count: 3, interval: 0.5 }], bonus: 20 },
  { groups: [{ enemy: 'runner', count: 2, interval: 0.5, delay: 1 }], bonus: 40, healthMult: 2 },
];

const make = (waves = TEST_WAVES, credits = 100) => new World(Grid.fromMap({ id: 't', name: 't', rows: ['S' + '.'.repeat(20) + 'O'] }), credits, waves);
const runUntil = (w: World, cond: () => boolean, max = 200) => {
  for (let i = 0; i < max * 60 && !cond(); i++) w.update(1 / 60);
};
const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) w.update(1 / 60);
};

describe('waves', () => {
  it('data only references known enemies and is non-empty', () => {
    const ids = new Set(ENEMIES.map((e) => e.id));
    expect(WAVES.length).toBeGreaterThan(0);
    for (const wave of WAVES) for (const g of wave.groups) expect(ids.has(g.enemy)).toBe(true);
    expect(WAVES.some((w) => w.boss)).toBe(true);
  });

  it('counts down, then spawns the configured enemies', () => {
    const w = make();
    expect(w.waves.phase).toBe('countdown');
    run(w, 7);
    expect(w.waves.started).toBe(0);
    run(w, 5);
    expect(w.waves.started).toBe(1);
    expect(w.waves.phase).toBe('active');
  });

  it('pays the wave bonus on clear and starts the next wave automatically', () => {
    const w = make();
    w.callNextWave();
    runUntil(w, () => w.waves.lastBonus > 0);
    expect(w.waves.lastBonus).toBe(20);
    expect(w.credits).toBe(120);
    expect(w.waves.phase).toBe('countdown');
    run(w, 7);
    expect(w.waves.started).toBe(2);
  });

  it('applies the wave health multiplier', () => {
    const w = make();
    w.callNextWave();
    runUntil(w, () => w.waves.started === 2);
    run(w, 1.5);
    expect(w.enemies.length).toBeGreaterThan(0);
    expect(w.enemies[0].maxHealth).toBe(36);
  });

  it('wins when the final wave is cleared with core intact', () => {
    const w = make();
    w.callNextWave();
    runUntil(w, () => w.status === 'victory');
    expect(w.waves.phase).toBe('done');
    expect(w.status).toBe('victory');
    expect(w.credits).toBe(160);
  });

  it('does not advance waves while still enemies alive, and reset restarts waves', () => {
    const w = make();
    w.callNextWave();
    run(w, 1);
    expect(w.waves.phase).toBe('active');
    w.reset();
    expect(w.waves.started).toBe(0);
    expect(w.waves.phase).toBe('countdown');
  });
});
