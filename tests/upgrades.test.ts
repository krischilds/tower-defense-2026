import { describe, expect, it } from 'vitest';
import { getEffectiveTowerDef, getTowerDef, getUpgradeBranches, TOWERS } from '../src/data/towers';
import { Grid } from '../src/sim/grid';
import { World } from '../src/sim/world';

function makeWorld(credits = 1000) {
  const world = new World(Grid.fromMap({ id: 'test', name: 'test', rows: ['S.........O', '...........'] }), credits);
  world.spawning = false;
  return world;
}

describe('tower upgrades', () => {
  it('provides one upgrade path with sequential levels for every tower', () => {
    for (const def of TOWERS) {
      const paths = getUpgradeBranches(def.id);
      expect(paths).toHaveLength(1);
      for (const path of paths) {
        expect(path.levels).toHaveLength(2);
        expect(path.levels.every((level) => level.cost > 0 && level.description.length > 0)).toBe(true);
        const stats = getEffectiveTowerDef({ defId: def.id, branch: path.id, level: 2 });
        expect(stats).not.toEqual(def);
      }
    }
  });

  it('applies upgrade levels in order and refunds total investment', () => {
    const w = makeWorld();
    expect(w.placeTower('cannon', 5, 1).ok).toBe(true);
    const t = w.towerAt(5, 1)!;
    const version = w.version;
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: true });
    expect(w.version).toBe(version + 1);
    expect(t).toMatchObject({ level: 1, branch: 'siege', invested: 110 });
    expect(w.credits).toBe(890);
    expect(getEffectiveTowerDef(t)).toMatchObject({ range: 4, splash: 1.4 });
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: true });
    expect(t.level).toBe(2);
    expect(getEffectiveTowerDef(t)).toMatchObject({ range: 4, splash: 1.9, damage: 38 });
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: false, reason: 'max-level' });
    expect(w.sellTower(5, 1)).toBe(Math.floor(220 * getTowerDef('cannon').sellRatio));
    expect(w.credits).toBe(780 + 154);
  });

  it('rejects invalid or unaffordable upgrades without changing state', () => {
    const w = makeWorld(50);
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: false, reason: 'no-tower' });
    w.placeTower('cannon', 5, 1);
    const version = w.version;
    expect(w.upgradeTower(5, 1, 'invalid')).toEqual({ ok: false, reason: 'invalid-branch' });
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: false, reason: 'insufficient-funds' });
    expect(w.towerAt(5, 1)).toMatchObject({ level: 0, branch: null, invested: 50 });
    expect(w.credits).toBe(0);
    expect(w.version).toBe(version);
    w.status = 'defeat';
    expect(w.upgradeTower(5, 1, 'siege')).toEqual({ ok: false, reason: 'game-ended' });
  });

  it('uses upgraded laser damage and armor penetration during combat', () => {
    const w = makeWorld();
    w.placeTower('laser', 5, 1);
    expect(w.upgradeTower(5, 1, 'lance').ok).toBe(true);
    const enemy = w.spawnEnemy('tank', { x: 5, y: 0 });
    enemy.health = enemy.maxHealth = 1000;
    w.update(1 / 60);
    expect(1000 - enemy.health).toBeCloseTo((14 / 60) / (1 + 0.25 * 2 * 0.4), 8);
  });

  it('fires upgraded siege projectiles with the first-level stats', () => {
    const w = makeWorld();
    w.placeTower('cannon', 5, 1);
    expect(w.upgradeTower(5, 1, 'siege').ok).toBe(true);
    w.spawnEnemy('tank', { x: 5, y: 0 });
    w.update(1 / 60);
    expect(w.projectiles[0]).toMatchObject({ damage: 25, splash: 1.4, pierce: 0.5 });
  });

  it('applies extra tesla jumps', () => {
    const w = makeWorld();
    w.placeTower('tesla', 5, 1);
    expect(w.upgradeTower(5, 1, 'storm').ok).toBe(true);
    const enemies = [3, 3.5, 4, 4.5, 5, 5.5].map((x) => w.spawnEnemy('tank', { x, y: 0 }));
    w.update(1 / 60);
    expect(enemies.every((enemy) => enemy.health < enemy.maxHealth)).toBe(true);
  });

  it('resets upgraded towers and restores initial credits', () => {
    const w = makeWorld();
    w.placeTower('cannon', 5, 1);
    w.upgradeTower(5, 1, 'siege');
    w.reset();
    expect(w.allTowers()).toHaveLength(0);
    expect(w.credits).toBe(1000);
  });
});
