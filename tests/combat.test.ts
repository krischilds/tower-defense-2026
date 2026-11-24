import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';
import { armorMultiplier, pickTarget, updateCombat } from '../src/sim/combat';
import { getTowerDef, TOWERS } from '../src/data/towers';
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

describe('missile', () => {
  it('is the most expensive, highest damage, and slowest-firing tower', () => {
    const missile = getTowerDef('missile');
    for (const other of TOWERS.filter((tower) => tower.id !== missile.id)) {
      expect(missile.cost).toBeGreaterThan(other.cost);
      expect(missile.damage).toBeGreaterThan(other.damage);
      if (other.fireRate > 0) expect(missile.fireRate).toBeLessThan(other.fireRate);
    }

    const w = world(LANE);
    w.placeTower('missile', 5, 1);
    const enemy = enemyAt(w, 'basic', 5, 0);
    enemy.health = enemy.maxHealth = 10000;
    updateCombat(w, 0);
    updateCombat(w, 2.85);
    expect(w.events.filter((event) => event.type === 'shot')).toHaveLength(1);
    updateCombat(w, 0.01);
    expect(w.events.filter((event) => event.type === 'shot')).toHaveLength(2);
  });

  it('accelerates from below cannon speed to twice cannon speed and emits its path', () => {
    const w = world(LANE);
    w.placeTower('missile', 5, 1);
    enemyAt(w, 'basic', 9, 0);
    updateCombat(w, 0);
    const projectile = w.projectiles[0];
    expect(projectile.kind).toBe('missile');
    expect(projectile.speed).toBeLessThan(getTowerDef('cannon').projectileSpeed!);
    projectile.tx = 100;
    projectile.ty = 1;
    w.enemies = [];
    const startX = projectile.x;
    updateCombat(w, 0.25);
    expect(projectile.speed).toBeCloseTo(17);
    expect(projectile.x - startX).toBeCloseTo(3);
    updateCombat(w, 0.75);
    expect(projectile.speed).toBeCloseTo(2 * getTowerDef('cannon').projectileSpeed!);
    expect(projectile.x - startX).toBeCloseTo(18 - 121 / 80);
    updateCombat(w, 0.5);
    expect(projectile.speed).toBeCloseTo(18);
    expect(w.events.filter((event) => event.type === 'missileTrail')).toHaveLength(3);

    const ranged = world(LANE);
    ranged.placeTower('missile', 5, 1);
    enemyAt(ranged, 'basic', 9, 0);
    updateCombat(ranged, 0.275);
    expect(ranged.projectiles).toHaveLength(1);
    expect(ranged.projectiles[0].speed).toBeCloseTo(2 * getTowerDef('cannon').projectileSpeed!);
  });

  it('explodes on impact and damages enemies within two tiles, including the boundary', () => {
    const w = world(LANE);
    w.placeTower('missile', 5, 1);
    w.setPriority(5, 1, 'closest');
    const enemies = [5, 6, 7, 7.01].map((x) => {
      const enemy = enemyAt(w, 'basic', x, 0);
      enemy.health = enemy.maxHealth = 1000;
      return enemy;
    });
    updateCombat(w, 1);
    expect(w.projectiles).toHaveLength(0);
    expect(1000 - enemies[0].health).toBeCloseTo(60);
    expect(1000 - enemies[1].health).toBeCloseTo(45);
    expect(1000 - enemies[2].health).toBeCloseTo(30);
    expect(enemies[3].health).toBe(1000);
    const trail = w.events.find((event) => event.type === 'missileTrail');
    expect(trail).toMatchObject({ to: { x: 5, y: 0 } });
    expect(w.events.some((event) => event.type === 'hit' && event.big)).toBe(true);
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
