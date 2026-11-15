import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';
import { armorMultiplier, pickTarget } from '../src/sim/combat';
import { getTowerDef } from '../src/data/towers';
import { getEnemyDef } from '../src/data/enemies';

const world = (rows: string[], credits = 1000) => {
  const w = new World(Grid.fromMap({ id: 't', name: 't', rows }), credits);
  w.spawning = false;
  return w;
};
const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) w.update(1 / 60);
};
/** Place an enemy on a given tile without moving it far. */
const enemyAt = (w: World, defId: string, x: number, y: number) => w.spawnEnemy(defId, { x, y });

// Row 0 is the lane; towers go on row 1.
const LANE = ['S.........O', '...........', '...........'];

describe('armor', () => {
  it('reduces damage and is partly ignored by pierce', () => {
    expect(armorMultiplier(0)).toBe(1);
    expect(armorMultiplier(2)).toBeLessThan(1);
    expect(armorMultiplier(2, 0.5)).toBeGreaterThan(armorMultiplier(2, 0));
    expect(armorMultiplier(2, 1)).toBe(1);
  });
});

describe('targeting', () => {
  it('only targets enemies in range', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const near = enemyAt(w, 'basic', 5, 0);
    enemyAt(w, 'basic', 0, 0);
    const t = w.towerAt(5, 1)!;
    expect(pickTarget(w, t, getTowerDef('cannon'))).toBe(near);
    near.health = 0;
    expect(pickTarget(w, t, getTowerDef('cannon'))).toBeNull();
  });

  it('honours priorities', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const t = w.towerAt(5, 1)!;
    const def = getTowerDef('cannon');
    const behind = enemyAt(w, 'tank', 4, 0);
    const ahead = enemyAt(w, 'basic', 7, 0);
    ahead.t = behind.t = 1;
    const check = (p: typeof t.priority) => {
      t.priority = p;
      return pickTarget(w, t, def);
    };
    expect(check('first')).toBe(ahead);
    expect(check('last')).toBe(behind);
    expect(check('strongest')).toBe(behind);
    expect(check('weakest')).toBe(ahead);
    expect(check('closest')).toBe(behind); // (4,0) is 1.41 from (5,1), (7,0) is 2.24
  });
});

describe('cannon', () => {
  it('fires a projectile that travels, then damages and kills with reward', () => {
    const w = world(LANE, 100);
    w.placeTower('cannon', 5, 1); // credits 50
    const e = enemyAt(w, 'basic', 5, 0);
    e.to = { x: 5, y: 0 };
    run(w, 0.05);
    expect(w.projectiles.length).toBe(1);
    expect(e.health).toBe(e.maxHealth); // not instant
    run(w, 2.5);
    expect(w.enemies.find((x) => x.id === e.id)).toBeUndefined();
    expect(w.credits).toBe(50 + getEnemyDef('basic').reward);
    expect(w.kills).toBe(1);
  });

  it('splash damages nearby enemies', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const a = enemyAt(w, 'tank', 5, 0);
    const b = enemyAt(w, 'tank', 5.4, 0);
    a.t = b.t = 1;
    run(w, 1.5);
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('respects fire rate', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const e = enemyAt(w, 'tank', 3.5, 0);
    e.health = e.maxHealth = 1e6;
    e.t = 1;
    run(w, 3.9);
    // 0.8 shots/s over ~3.9 s => 4 shots (first at t=0)
    const hits = w.events.filter((ev) => ev.type === 'shot').length;
    expect(hits).toBe(4);
  });
});

describe('laser', () => {
  it('deals continuous damage per second, reduced by armor', () => {
    const w = world(LANE);
    w.placeTower('laser', 5, 1);
    const basic = enemyAt(w, 'basic', 4, 0);
    basic.health = basic.maxHealth = 1000;
    basic.t = 1;
    run(w, 2);
    expect(basic.maxHealth - basic.health).toBeCloseTo(28, 0);
    expect(w.towerAt(5, 1)!.firing).toBe(true);

    const w2 = world(LANE);
    w2.placeTower('laser', 5, 1);
    const tank = enemyAt(w2, 'tank', 4, 0);
    tank.health = tank.maxHealth = 1000;
    tank.t = 1;
    run(w2, 2);
    expect(1000 - tank.health).toBeCloseTo(28 * armorMultiplier(2), 0);
  });

  it('stops firing when nothing is in range', () => {
    const w = world(LANE);
    w.placeTower('laser', 5, 1);
    run(w, 0.5);
    expect(w.towerAt(5, 1)!.firing).toBe(false);
  });
});

describe('tesla', () => {
  it('chains to several nearby enemies with falloff', () => {
    const w = world(LANE);
    w.placeTower('tesla', 5, 1);
    const es = [5, 5.8, 6.6, 7.4].map((x) => {
      const e = enemyAt(w, 'tank', x, 0);
      e.t = 1;
      return e;
    });
    run(w, 0.05);
    const dmg = es.map((e) => e.maxHealth - e.health);
    expect(dmg.every((d) => d > 0)).toBe(true);
    expect(dmg[0]).toBeGreaterThan(dmg[3]);
    expect(w.events.some((ev) => ev.type === 'chain')).toBe(true);
  });
});

describe('rewards and events', () => {
  it('drains events once', () => {
    const w = world(LANE);
    w.placeTower('laser', 5, 1);
    const e = enemyAt(w, 'runner', 5, 0);
    e.t = 1;
    e.health = 1;
    run(w, 0.2);
    const evs = w.drainEvents();
    expect(evs.some((x) => x.type === 'death')).toBe(true);
    expect(w.drainEvents()).toHaveLength(0);
  });

  it('priority can be changed per tower', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    w.setPriority(5, 1, 'weakest');
    expect(w.towerAt(5, 1)!.priority).toBe('weakest');
  });
});
