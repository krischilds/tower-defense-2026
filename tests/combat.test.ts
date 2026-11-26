import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';
import { armorMultiplier, pickTarget, updateCombat } from '../src/sim/combat';
import { getTowerDef, TOWERS } from '../src/data/towers';
import { MAPS } from '../src/data/maps';

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
const alignTower = (w: World, x: number, y: number) => {
  const tower = w.towerAt(x, y)!;
  const cooldown = tower.cooldown;
  tower.cooldown = Infinity;
  updateCombat(w, 1);
  tower.cooldown = cooldown;
};

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

describe('projectile obstacles', () => {
  it.each([
    { kind: 'cannon', start: 2, target: 5, impact: 2.5, upgraded: false },
    { kind: 'missile', start: 2, target: 5, impact: 2.5, upgraded: false },
    { kind: 'missile', start: 4, target: 1, impact: 3.5, upgraded: true },
  ])('$kind explodes on blocked tile (3, 9) before reaching its target', ({ kind, start, target, impact, upgraded }) => {
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    expect(w.grid.get(3, 9)?.type).toBe('blocked');
    expect(w.placeTower(kind, start, 9).ok).toBe(true);
    if (upgraded) expect(w.upgradeTower(start, 9, 'warhead').ok).toBe(true);
    const enemy = enemyAt(w, 'basic', target, 9);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(start, 9)!.aim = target > start ? Math.PI / 2 : -Math.PI / 2;
    updateCombat(w, 0);
    expect(w.projectiles).toHaveLength(1);
    updateCombat(w, 0.5);
    expect(w.projectiles).toHaveLength(0);
    expect(enemy.health).toBe(1000);
    const hit = w.events.find((event) => event.type === 'hit');
    expect(hit).toMatchObject({ x: impact, y: 9, blocked: true });
    if (kind === 'missile') {
      expect(w.events.find((event) => event.type === 'missileTrail')).toMatchObject({ to: { x: impact, y: 9 } });
    }
  });

  it('hits a nearer enemy before the blocked tile', () => {
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    expect(w.placeTower('cannon', 1, 9).ok).toBe(true);
    const enemy = enemyAt(w, 'basic', 2, 9);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(1, 9)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    updateCombat(w, 0.5);
    expect(enemy.health).toBeLessThan(1000);
    expect(w.events.find((event) => event.type === 'hit')).toMatchObject({ x: 2, y: 9 });
    expect(w.events.some((event) => event.type === 'hit' && event.blocked)).toBe(false);
  });

  it('detects an obstacle crossed diagonally between simulation steps', () => {
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    expect(w.placeTower('cannon', 1, 8).ok).toBe(true);
    enemyAt(w, 'basic', 4, 9.5);
    w.towerAt(1, 8)!.aim = Math.atan2(3, 1.5);
    updateCombat(w, 0);
    updateCombat(w, 0.5);
    expect(w.projectiles).toHaveLength(0);
    expect(w.events.find((event) => event.type === 'hit')).toMatchObject({ x: 2.5, y: 8.75, blocked: true });
  });

  it('does not hit a blocked tile outside the diagonal flight path', () => {
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    expect(w.placeTower('cannon', 1, 8).ok).toBe(true);
    const enemy = enemyAt(w, 'basic', 4, 8.55);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(1, 8)!.aim = Math.atan2(3, 0.55);
    updateCombat(w, 0);
    updateCombat(w, 0.5);
    expect(enemy.health).toBeLessThan(1000);
    expect(w.events.some((event) => event.type === 'hit' && event.blocked)).toBe(false);
  });

  it('explodes on a blocked tile during an upgraded missile return pass', () => {
    const w = new World(Grid.fromMap(MAPS[0]), 1000);
    expect(w.placeTower('missile', 2, 9).ok).toBe(true);
    expect(w.upgradeTower(2, 9, 'warhead').ok).toBe(true);
    enemyAt(w, 'basic', 5, 9);
    w.towerAt(2, 9)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    const missile = w.projectiles[0];
    if (missile.kind !== 'missile') throw new Error('Expected a missile');
    missile.phase = 'returning';
    updateCombat(w, 0.5);
    expect(w.projectiles).toHaveLength(0);
    expect(w.events.find((event) => event.type === 'hit')).toMatchObject({ x: 2.5, y: 9, blocked: true });
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

  describe('projectile tower aiming', () => {
    it.each(['cannon', 'missile'])('%s waits for its gun to finish turning before firing', (kind) => {
      const w = world(LANE);
      w.placeTower(kind, 5, 1);
      const enemy = enemyAt(w, 'basic', 5, 0);
      const tower = w.towerAt(5, 1)!;

      updateCombat(w, 0.1);
      expect(tower.aim).not.toBe(0);
      expect(w.projectiles).toHaveLength(0);
      expect(tower.cooldown).toBe(0);

      enemy.x = 6;
      updateCombat(w, 0.1);
      expect(w.projectiles).toHaveLength(0);
      updateCombat(w, 0.1);
      expect(w.projectiles).toHaveLength(1);
      const projectile = w.projectiles[0];
      expect(tower.aim).toBeCloseTo(Math.atan2(projectile.dx, projectile.dy));
      expect(w.events.filter((event) => event.type === 'shot')).toHaveLength(1);
    });

    it('only moves a new projectile for the part of the step after alignment', () => {
      const w = world(LANE);
      w.placeTower('cannon', 5, 2);
      enemyAt(w, 'basic', 5, 0);
      updateCombat(w, 0.38);
      expect(w.projectiles).toHaveLength(0);
      updateCombat(w, 0.02);
      expect(w.projectiles).toHaveLength(1);
      expect(2 - w.projectiles[0].y).toBeCloseTo(9 * (0.4 - Math.PI / 8));
    });
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
  it.each([
    { x: 4.2, from: 4, to: 5 },
    { x: 6.8, from: 7, to: 6 },
  ])('leads a moving target at x=$x where direct aim would miss', ({ x, from, to }) => {
    const setup = () => {
      const w = world(LANE);
      w.placeTower('cannon', 5, 2);
      const enemy = enemyAt(w, 'runner', x, 0);
      enemy.from = { x: from, y: 0 };
      enemy.to = { x: to, y: 0 };
      enemy.t = 0.2;
      alignTower(w, 5, 2);
      updateCombat(w, 0);
      return { w, enemy };
    };
    const led = setup();
    const direct = setup();
    const shot = direct.w.projectiles[0];
    const dx = direct.enemy.x - shot.x;
    const dy = direct.enemy.y - shot.y;
    const length = Math.hypot(dx, dy);
    shot.dx = dx / length;
    shot.dy = dy / length;

    run(led.w, 0.4);
    run(direct.w, 0.4);
    expect(led.enemy.health).toBeLessThan(led.enemy.maxHealth);
    expect(direct.enemy.health).toBe(direct.enemy.maxHealth);
  });

  it('fires a projectile that travels and can hit a moving enemy', () => {
    const w = world(LANE, 100);
    w.placeTower('cannon', 5, 1); // credits 50
    const e = enemyAt(w, 'basic', 5, 0);
    e.to = { x: 5, y: 0 };
    alignTower(w, 5, 1);
    run(w, 0.05);
    expect(w.projectiles.length).toBe(1);
    expect(e.health).toBe(e.maxHealth); // not instant
    run(w, 0.3);
    expect(e.health).toBeLessThan(e.maxHealth);
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

  it('misses a target that leaves the firing line and keeps flying until out of bounds', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const enemy = enemyAt(w, 'basic', 8, 0);
    enemy.health = enemy.maxHealth = 1000;
    enemy.from = { x: 7, y: 0 };
    enemy.to = { x: 8, y: 0 };
    alignTower(w, 5, 1);
    updateCombat(w, 0);
    expect(w.projectiles).toHaveLength(1);

    enemy.y = 2;
    updateCombat(w, 0.3);
    expect(w.projectiles).toHaveLength(1);
    expect(enemy.health).toBe(1000);
    expect(w.projectiles[0].x).toBeGreaterThan(5);

    updateCombat(w, 0.5);
    expect(w.projectiles).toHaveLength(0);
    expect(enemy.health).toBe(1000);
    expect(w.events.some((event) => event.type === 'hit')).toBe(false);
  });

  it('respects fire rate', () => {
    const w = world(LANE);
    w.placeTower('cannon', 5, 1);
    const e = enemyAt(w, 'tank', 3.5, 0);
    e.health = e.maxHealth = 1e6;
    e.t = 1;
    alignTower(w, 5, 1);
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
  it('hits more moving targets than direct aim across five first-pass shots', () => {
    const cases = [
      { defId: 'runner', x: 4.2, from: 4, to: 5 },
      { defId: 'runner', x: 6.8, from: 7, to: 6 },
      { defId: 'basic', x: 4.2, from: 4, to: 5 },
      { defId: 'basic', x: 6.8, from: 7, to: 6 },
      { defId: 'runner', x: 8.2, from: 8, to: 9 },
    ];
    let ledHits = 0;
    let directHits = 0;
    for (const { defId, x, from, to } of cases) {
      const setup = () => {
        const w = world(LANE);
        w.placeTower('missile', 5, 2);
        const enemy = enemyAt(w, defId, x, 0);
        enemy.health = enemy.maxHealth = 1000;
        enemy.from = { x: from, y: 0 };
        enemy.to = { x: to, y: 0 };
        enemy.t = 0.2;
        alignTower(w, 5, 2);
        updateCombat(w, 0);
        return { w, enemy };
      };
      const led = setup();
      const direct = setup();
      const shot = direct.w.projectiles[0];
      const dx = direct.enemy.x - shot.x;
      const dy = direct.enemy.y - shot.y;
      const length = Math.hypot(dx, dy);
      shot.dx = dx / length;
      shot.dy = dy / length;
      run(led.w, 0.5);
      run(direct.w, 0.5);
      if (led.enemy.health < led.enemy.maxHealth) ledHits++;
      if (direct.enemy.health < direct.enemy.maxHealth) directHits++;
    }
    expect(ledHits).toBeGreaterThan(directHits);
    expect(ledHits).toBeGreaterThanOrEqual(4);
  });

  it.each([false, true])('does not turn back when fired unupgraded (upgrade after launch: %s)', (upgradeAfterLaunch) => {
    const w = world(['S.............O', ...Array<string>(14).fill('...............')]);
    w.placeTower('missile', 4, 7);
    const enemy = enemyAt(w, 'basic', 8, 7);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(4, 7)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    const missile = w.projectiles[0];
    if (missile.kind !== 'missile') throw new Error('Expected a missile');
    if (upgradeAfterLaunch) expect(w.upgradeTower(4, 7, 'warhead').ok).toBe(true);
    enemy.y = 8.5;

    for (let i = 0; i < 120 && w.projectiles.includes(missile); i++) {
      updateCombat(w, 1 / 60);
      expect(missile.phase).toBe('initial');
      expect(missile.dx).toBeCloseTo(1);
      expect(missile.dy).toBeCloseTo(0);
    }
    expect(w.projectiles).not.toContain(missile);
    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it.each([
    { targetX: 8, targetY: 8.5, upgrades: 1 },
    { targetX: 8, targetY: 5.5, upgrades: 1 },
    { targetX: 14, targetY: 8.5, upgrades: 1 },
    { targetX: 8, targetY: 8.5, upgrades: 2 },
  ])('makes a wide, gradual return at ($targetX, $targetY) with $upgrades upgrades', ({ targetX, targetY, upgrades }) => {
    const w = world(['S.............O', ...Array<string>(14).fill('...............')]);
    w.placeTower('missile', targetX - 4, 7);
    for (let i = 0; i < upgrades; i++) expect(w.upgradeTower(targetX - 4, 7, 'warhead').ok).toBe(true);
    const enemy = enemyAt(w, 'basic', targetX, 7);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(targetX - 4, 7)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    const missile = w.projectiles[0];
    if (missile.kind !== 'missile') throw new Error('Expected a missile');
    enemy.y = targetY;

    let turned = false;
    let returned = false;
    let maxDeviation = 0;
    for (let i = 0; i < 120 && w.projectiles.includes(missile); i++) {
      const previousAngle = Math.atan2(missile.dy, missile.dx);
      updateCombat(w, 1 / 60);
      const angleChange = Math.atan2(Math.sin(Math.atan2(missile.dy, missile.dx) - previousAngle), Math.cos(Math.atan2(missile.dy, missile.dx) - previousAngle));
      expect(Math.abs(angleChange)).toBeLessThanOrEqual(0.101);
      if (missile.phase === 'turning') turned = true;
      if (missile.phase === 'returning') returned = true;
      maxDeviation = Math.max(maxDeviation, Math.abs(missile.y - 7));
    }
    expect(turned).toBe(true);
    expect(returned).toBe(true);
    expect(maxDeviation).toBeGreaterThan(3);
    expect(enemy.health).toBeLessThan(enemy.maxHealth);
    expect(w.projectiles).not.toContain(missile);
  });

  it('does not turn a second time after the return pass misses', () => {
    const w = world(['S.............O', ...Array<string>(14).fill('...............')]);
    w.placeTower('missile', 4, 7);
    expect(w.upgradeTower(4, 7, 'warhead').ok).toBe(true);
    const enemy = enemyAt(w, 'basic', 8, 7);
    enemy.health = enemy.maxHealth = 1000;
    w.towerAt(4, 7)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    const missile = w.projectiles[0];
    if (missile.kind !== 'missile') throw new Error('Expected a missile');
    enemy.y = 8.5;

    for (let i = 0; i < 120 && missile.phase !== 'returning'; i++) updateCombat(w, 1 / 60);
    expect(missile.phase).toBe('returning');
    const direction = { dx: missile.dx, dy: missile.dy };
    enemy.x = 2;
    enemy.y = 2;
    for (let i = 0; i < 120 && w.projectiles.includes(missile); i++) {
      updateCombat(w, 1 / 60);
      expect(missile.dx).toBe(direction.dx);
      expect(missile.dy).toBe(direction.dy);
    }
    expect(w.projectiles).not.toContain(missile);
    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('stops trying to turn if its target dies during the return maneuver', () => {
    const w = world(['S.............O', ...Array<string>(14).fill('...............')]);
    w.placeTower('missile', 4, 7);
    expect(w.upgradeTower(4, 7, 'warhead').ok).toBe(true);
    const enemy = enemyAt(w, 'basic', 8, 7);
    w.towerAt(4, 7)!.aim = Math.PI / 2;
    updateCombat(w, 0);
    const missile = w.projectiles[0];
    if (missile.kind !== 'missile') throw new Error('Expected a missile');
    enemy.y = 8.5;
    for (let i = 0; i < 120 && missile.phase === 'initial'; i++) updateCombat(w, 1 / 60);
    expect(missile.phase).toBe('turning');
    enemy.health = 0;
    const direction = { dx: missile.dx, dy: missile.dy };
    updateCombat(w, 1 / 60);
    expect(missile.phase).toBe('returning');
    expect(missile.dx).toBe(direction.dx);
    expect(missile.dy).toBe(direction.dy);
  });

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
    alignTower(w, 5, 1);
    updateCombat(w, 0);
    updateCombat(w, 2.85);
    expect(w.events.filter((event) => event.type === 'shot')).toHaveLength(1);
    updateCombat(w, 0.01);
    expect(w.events.filter((event) => event.type === 'shot')).toHaveLength(2);
  });

  it('accelerates from below cannon speed and leaves the grid along its firing line', () => {
    const w = world(LANE);
    w.placeTower('missile', 5, 1);
    enemyAt(w, 'basic', 9, 0);
    alignTower(w, 5, 1);
    updateCombat(w, 0);
    const projectile = w.projectiles[0];
    expect(projectile.kind).toBe('missile');
    expect(projectile.speed).toBeLessThan(getTowerDef('cannon').projectileSpeed!);
    projectile.dx = 1;
    projectile.dy = 0;
    w.enemies = [];
    const startX = projectile.x;
    updateCombat(w, 0.25);
    expect(projectile.speed).toBeCloseTo(17);
    expect(projectile.x - startX).toBeCloseTo(3);
    updateCombat(w, 0.75);
    expect(projectile.speed).toBeCloseTo(2 * getTowerDef('cannon').projectileSpeed!);
    expect(projectile.x - startX).toBeCloseTo(5.5);
    updateCombat(w, 0.5);
    expect(projectile.speed).toBeCloseTo(18);
    expect(w.projectiles).toHaveLength(0);
    expect(w.events.filter((event) => event.type === 'missileTrail')).toHaveLength(2);

    const ranged = world(LANE);
    ranged.placeTower('missile', 5, 1);
    enemyAt(ranged, 'basic', 9, 0);
    alignTower(ranged, 5, 1);
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
