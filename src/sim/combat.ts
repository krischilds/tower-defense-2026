import type { Enemy, GameEvent, PlacedTower, Projectile, TargetPriority } from './types';
import type { World } from './world';
import { getEffectiveTowerDef, type TowerDef } from '../data/towers';
import { getEnemyDef } from '../data/enemies';

/** Armor reduces damage multiplicatively; pierce ignores a fraction of the armor. */
export function armorMultiplier(armor: number, pierce = 0): number {
  return 1 / (1 + 0.25 * armor * (1 - pierce));
}

/** Path distance still to walk to the objective. */
export function remainingDistance(world: World, e: Enemy): number {
  const d = world.flow.distanceAt(e.to.x, e.to.y);
  return (Number.isFinite(d) ? d : 1e9) + (1 - Math.min(e.t, 1)) * e.len;
}

export function damageEnemy(world: World, e: Enemy, amount: number, pierce: number) {
  e.health -= amount * armorMultiplier(getEnemyDef(e.defId).armor, pierce);
  e.lastHit = world.time;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function score(world: World, tower: PlacedTower, e: Enemy, priority: TargetPriority): number {
  switch (priority) {
    case 'first':
      return remainingDistance(world, e);
    case 'last':
      return -remainingDistance(world, e);
    case 'strongest':
      return -e.health;
    case 'weakest':
      return e.health;
    case 'closest':
      return dist(tower.x, tower.y, e.x, e.y);
  }
}

/** Lowest score wins. Ties fall back to enemy id for determinism. */
export function pickTarget(world: World, tower: PlacedTower, def: TowerDef): Enemy | null {
  let best: Enemy | null = null;
  let bestScore = Infinity;
  for (const e of world.enemies) {
    if (e.health <= 0 || dist(tower.x, tower.y, e.x, e.y) > def.range) continue;
    const s = score(world, tower, e, tower.priority);
    if (s < bestScore || (s === bestScore && best && e.id < best.id)) {
      best = e;
      bestScore = s;
    }
  }
  return best;
}

function aimAt(tower: PlacedTower, x: number, y: number) {
  tower.aim = Math.atan2(x - tower.x, y - tower.y);
}

function push(world: World, ev: GameEvent) {
  if (world.events.length < 600) world.events.push(ev);
}

function fireChain(world: World, tower: PlacedTower, def: TowerDef, first: Enemy) {
  const points = [{ x: tower.x, y: tower.y }];
  const visited = new Set<number>();
  let cur: Enemy | null = first;
  let dmg = def.damage;
  for (let i = 0; cur && i < (def.chainCount ?? 1); i++) {
    visited.add(cur.id);
    damageEnemy(world, cur, dmg, def.armorPierce);
    points.push({ x: cur.x, y: cur.y });
    dmg *= def.chainFalloff ?? 1;
    const from: Enemy = cur;
    let next: Enemy | null = null;
    let nd = def.chainRange ?? 1.5;
    for (const e of world.enemies) {
      if (e.health <= 0 || visited.has(e.id)) continue;
      const d = dist(from.x, from.y, e.x, e.y);
      if (d <= nd) {
        nd = d;
        next = e;
      }
    }
    cur = next;
  }
  push(world, { type: 'chain', points, color: def.color });
}

function moveProjectiles(world: World, dt: number, byId: Map<number, Enemy>) {
  const keep: Projectile[] = [];
  for (const p of world.projectiles) {
    const target = byId.get(p.targetId);
    if (target && target.health > 0) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const d = dist(p.x, p.y, p.tx, p.ty);
    const accelerationTime = p.acceleration > 0 ? Math.min(dt, Math.max(0, (p.maxSpeed - p.speed) / p.acceleration)) : 0;
    const step = p.speed * dt + p.acceleration * accelerationTime * (dt - accelerationTime / 2);
    p.speed = Math.min(p.maxSpeed, p.speed + p.acceleration * dt);
    const travel = d > 0.05 ? Math.min(step, d) : d;
    const x = d > 0 ? p.x + ((p.tx - p.x) / d) * travel : p.tx;
    const y = d > 0 ? p.y + ((p.ty - p.y) / d) * travel : p.ty;
    if (p.kind === 'missile' && travel > 0) {
      push(world, { type: 'missileTrail', id: p.id, from: { x: p.x, y: p.y }, to: { x, y } });
    }
    if (d > step && d > 0.05) {
      p.x = x;
      p.y = y;
      keep.push(p);
      continue;
    }
    // Impact
    if (p.splash > 0) {
      for (const e of world.enemies) {
        if (e.health <= 0) continue;
        const ed = dist(p.tx, p.ty, e.x, e.y);
        if (ed <= p.splash) damageEnemy(world, e, p.damage * (1 - 0.5 * (ed / p.splash)), p.pierce);
      }
    } else if (target && target.health > 0) {
      damageEnemy(world, target, p.damage, p.pierce);
    }
    push(world, { type: 'hit', x: p.tx, y: p.ty, color: p.color, big: p.splash > 0 });
  }
  world.projectiles = keep;
}

export function updateCombat(world: World, dt: number) {
  const byId = new Map<number, Enemy>();
  for (const e of world.enemies) byId.set(e.id, e);

  for (const tower of world.allTowers()) {
    const def = getEffectiveTowerDef(tower);
    tower.firing = false;

    // Beams hold their target while it stays valid; other towers pick fresh at fire time.
    let target: Enemy | null = null;
    if (def.kind === 'beam' && tower.targetId !== null) {
      const cur = byId.get(tower.targetId);
      if (cur && cur.health > 0 && dist(tower.x, tower.y, cur.x, cur.y) <= def.range) target = cur;
    }
    if (!target) target = pickTarget(world, tower, def);
    tower.targetId = target ? target.id : null;
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    if (!target) continue;
    aimAt(tower, target.x, target.y);

    if (def.kind === 'beam') {
      tower.firing = true;
      damageEnemy(world, target, def.damage * dt, def.armorPierce);
    } else if (tower.cooldown <= 0) {
      tower.cooldown = 1 / def.fireRate;
      if (def.kind === 'projectile' || def.kind === 'missile') {
        const speed = def.projectileSpeed ?? 8;
        world.projectiles.push({
          id: world.nextEntityId(),
          kind: def.kind,
          x: tower.x,
          y: tower.y,
          targetId: target.id,
          tx: target.x,
          ty: target.y,
          speed,
          acceleration: def.projectileAcceleration ?? 0,
          maxSpeed: def.projectileMaxSpeed ?? speed,
          damage: def.damage,
          splash: def.splash ?? 0,
          pierce: def.armorPierce,
          color: def.color,
        });
        push(world, { type: 'shot', x: tower.x, y: tower.y, color: def.color });
      } else {
        fireChain(world, tower, def, target);
      }
    }
  }

  moveProjectiles(world, dt, byId);
}

/** Removes dead enemies, paying out their rewards. */
export function sweepDead(world: World) {
  if (!world.enemies.some((e) => e.health <= 0)) return;
  for (const e of world.enemies) {
    if (e.health > 0) continue;
    const def = getEnemyDef(e.defId);
    world.credits += def.reward;
    world.kills++;
    push(world, { type: 'death', x: e.x, y: e.y, color: def.color });
  }
  world.enemies = world.enemies.filter((e) => e.health > 0);
}
