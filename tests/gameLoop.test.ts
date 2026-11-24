import { describe, expect, it } from 'vitest';
import { GameLoop } from '../src/core/gameLoop';

const counter = () => {
  const s = { steps: 0, time: 0, update(dt: number) { this.steps++; this.time += dt; } };
  return s;
};

describe('GameLoop', () => {
  it('does not advance while paused', () => {
    const s = counter();
    const l = new GameLoop(s);
    l.advance(1);
    expect(s.steps).toBe(0);
  });

  it('runs fixed steps and scales with speed', () => {
    const a = counter();
    const la = new GameLoop(a);
    la.paused = false;
    la.advance(0.1);
    const b = counter();
    const lb = new GameLoop(b);
    lb.paused = false;
    lb.speed = 2;
    lb.advance(0.1);
    expect(a.time).toBeCloseTo(0.1, 1);
    expect(b.time).toBeCloseTo(0.2, 1);
  });

  it.each([0.25, 0.5])('advances at %sx speed over multiple frames', (speed) => {
    const sim = counter();
    const loop = new GameLoop(sim);
    loop.paused = false;
    loop.speed = speed;
    for (let frame = 0; frame < 120; frame++) loop.advance(1 / 60);
    expect(sim.time).toBeCloseTo(2 * speed, 5);
  });

  it('bounds catch-up after a long frame', () => {
    const s = counter();
    const l = new GameLoop(s);
    l.paused = false;
    l.advance(30);
    expect(s.steps).toBeLessThanOrEqual(12);
  });
});
