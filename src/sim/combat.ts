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
const MISSILE_TURN_RATE = 6;
const MISSILE_TURN_MARGIN = 8;
const TOWER_TURN_RATE = 8;

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

function turnToward(tower: PlacedTower, x: number, y: number, dt: number): number | null {
  const desired = Math.atan2(x - tower.x, y - tower.y);
  const difference = Math.atan2(Math.sin(desired - tower.aim), Math.cos(desired - tower.aim));
  const limit = TOWER_TURN_RATE * dt;
  if (Math.abs(difference) <= limit) {
    tower.aim = desired;
    return dt - Math.abs(difference) / TOWER_TURN_RATE;
  }
  tower.aim += Math.sign(difference) * limit;
  return null;
}

function missileTravelTime(distance: number, speed: number, acceleration: number, maxSpeed: number): number {
  if (acceleration <= 0 || speed >= maxSpeed) return distance / speed;
  const accelerationTime = (maxSpeed - speed) / acceleration;
  const accelerationDistance = (speed + maxSpeed) * accelerationTime / 2;
  if (distance <= accelerationDistance) {
    return 2 * distance / (speed + Math.sqrt(speed * speed + 2 * acceleration * distance));
  }
  return accelerationTime + (distance - accelerationDistance) / maxSpeed;
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

function moveProjectiles(world: World, dt: number, byId: Map<number, Enemy>, flightTimes: Map<number, number>) {
  const keep: Projectile[] = [];
  for (const p of world.projectiles) {
    const flightTime = flightTimes.get(p.id) ?? dt;
    const target = p.kind === 'missile' ? byId.get(p.targetId) : undefined;
    if (p.kind === 'missile' && p.phase === 'turning') {
      if (!target || target.health <= 0) {
        p.phase = 'returning';
      } else {
        const targetAngle = Math.atan2(target.y - p.y, target.x - p.x);
        const angle = Math.atan2(p.dy, p.dx);
        const fullTurn = 2 * Math.PI;
        const difference = p.turnDirection > 0
          ? (targetAngle - angle + fullTurn) % fullTurn
          : -((angle - targetAngle + fullTurn) % fullTurn);
        const limit = Math.min(MISSILE_TURN_RATE * flightTime, 2 * Math.PI - p.turnAmount);
        const turn = Math.max(-limit, Math.min(limit, difference));
        p.turnAmount += Math.abs(turn);
        p.dx = Math.cos(angle + turn);
        p.dy = Math.sin(angle + turn);
        if (Math.abs(difference) <= limit || p.turnAmount >= 2 * Math.PI) {
          p.phase = 'returning';
        }
      }
    }
    const accelerationTime = p.acceleration > 0 ? Math.min(flightTime, Math.max(0, (p.maxSpeed - p.speed) / p.acceleration)) : 0;
    const step = p.speed * flightTime + p.acceleration * accelerationTime * (flightTime - accelerationTime / 2);
    p.speed = Math.min(p.maxSpeed, p.speed + p.acceleration * flightTime);
    const fromX = p.x;
    const fromY = p.y;
    const rawX = fromX + p.dx * step;
    const rawY = fromY + p.dy * step;
    const outsideGrid = fromX < -0.5 || fromY < -0.5 || fromX > world.grid.width - 0.5 || fromY > world.grid.height - 0.5;
    const margin = p.kind === 'missile' && (p.phase === 'turning' || (p.phase === 'returning' && outsideGrid))
      ? MISSILE_TURN_MARGIN : 0;
    const minX = -0.5 - margin;
    const minY = -0.5 - margin;
    const maxX = world.grid.width - 0.5 + margin;
    const maxY = world.grid.height - 0.5 + margin;
    const boundaryProgress = (start: number, end: number, min: number, max: number) => (
      end < min ? (min - start) / (end - start) : end > max ? (max - start) / (end - start) : 1
    );
    const endProgress = Math.min(
      boundaryProgress(fromX, rawX, minX, maxX),
      boundaryProgress(fromY, rawY, minY, maxY),
    );
    const x = fromX + (rawX - fromX) * endProgress;
    const y = fromY + (rawY - fromY) * endProgress;
    const leavesGrid = endProgress < 1 || (fromX === maxX && p.dx > 0) || (fromX === minX && p.dx < 0)
      || (fromY === maxY && p.dy > 0) || (fromY === minY && p.dy < 0);

    let impact: { x: number; y: number; enemy: Enemy | null } | null = null;
    let impactProgress = Infinity;
    const segmentX = x - fromX;
    const segmentY = y - fromY;
    const segmentLengthSq = segmentX * segmentX + segmentY * segmentY;
    const minTileX = Math.max(0, Math.ceil(Math.min(fromX, x) - 0.5));
    const maxTileX = Math.min(world.grid.width - 1, Math.floor(Math.max(fromX, x) + 0.5));
    const minTileY = Math.max(0, Math.ceil(Math.min(fromY, y) - 0.5));
    const maxTileY = Math.min(world.grid.height - 1, Math.floor(Math.max(fromY, y) + 0.5));
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        if (world.grid.get(tileX, tileY)?.type !== 'blocked') continue;
        let entry = 0;
        let exit = 1;
        for (const [start, delta, center] of [[fromX, segmentX, tileX], [fromY, segmentY, tileY]]) {
          if (delta === 0) {
            if (start < center - 0.5 || start > center + 0.5) exit = -1;
          } else {
            const a = (center - 0.5 - start) / delta;
            const b = (center + 0.5 - start) / delta;
            entry = Math.max(entry, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
          }
        }
        if (entry <= exit && entry < impactProgress) {
          impactProgress = entry;
          impact = { x: fromX + entry * segmentX, y: fromY + entry * segmentY, enemy: null };
        }
      }
    }
    const obstacleProgress = impactProgress;
    for (const enemy of world.enemies) {
      if (enemy.health <= 0) continue;
      const hitRadius = 0.12 + getEnemyDef(enemy.defId).scale * 0.1;
      const offsetX = enemy.x - fromX;
      const offsetY = enemy.y - fromY;
      const closest = segmentLengthSq > 0 ? (offsetX * segmentX + offsetY * segmentY) / segmentLengthSq : 0;
      const perpendicularSq = Math.max(0, offsetX * offsetX + offsetY * offsetY - closest * closest * segmentLengthSq);
      if (perpendicularSq > hitRadius * hitRadius) continue;
      const halfChord = segmentLengthSq > 0 ? Math.sqrt((hitRadius * hitRadius - perpendicularSq) / segmentLengthSq) : 0;
      const entry = Math.max(0, closest - halfChord);
      if (closest + halfChord < 0 || entry > 1 || entry >= impactProgress) continue;
      const hitProgress = Math.min(1, Math.max(0, closest), obstacleProgress);
      impact = { x: fromX + hitProgress * segmentX, y: fromY + hitProgress * segmentY, enemy };
      impactProgress = entry;
    }

    if (p.kind === 'missile' && step > 0) {
      push(world, { type: 'missileTrail', id: p.id, from: { x: fromX, y: fromY }, to: impact ?? { x, y } });
    }

    if (!impact) {
      p.x = x;
      p.y = y;
      if (p.kind === 'missile' && p.canReturn && p.phase === 'initial' && target && target.health > 0
        && (leavesGrid || (target.x - x) * p.dx + (target.y - y) * p.dy <= 0)) {
        p.phase = 'turning';
        const cross = p.dx * (target.y - y) - p.dy * (target.x - x);
        // Turning away first leaves room for a wide, smooth approach.
        p.turnDirection = cross >= 0 ? -1 : 1;
        keep.push(p);
      } else if (!leavesGrid) {
        keep.push(p);
      }
      continue;
    }

    p.x = impact.x;
    p.y = impact.y;
    if (p.splash > 0) {
      for (const e of world.enemies) {
        if (e.health <= 0) continue;
        const ed = dist(p.x, p.y, e.x, e.y);
        if (ed <= p.splash) damageEnemy(world, e, p.damage * (1 - 0.5 * (ed / p.splash)), p.pierce);
      }
    } else if (impact.enemy) {
      damageEnemy(world, impact.enemy, p.damage, p.pierce);
    }
    push(world, { type: 'hit', x: p.x, y: p.y, color: p.color, big: p.splash > 0, ...(impact.enemy ? {} : { blocked: true }) });
  }
  world.projectiles = keep;
}

export function updateCombat(world: World, dt: number) {
  const byId = new Map<number, Enemy>();
  for (const e of world.enemies) byId.set(e.id, e);
  const flightTimes = new Map<number, number>();

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
    const previousCooldown = tower.cooldown;
    tower.cooldown = Math.max(0, previousCooldown - dt);
    if (!target) continue;

    if (def.kind === 'beam') {
      aimAt(tower, target.x, target.y);
      tower.firing = true;
      damageEnemy(world, target, def.damage * dt, def.armorPierce);
    } else if (def.kind === 'projectile' || def.kind === 'missile') {
      const speed = def.projectileSpeed ?? 8;
      const segmentX = target.to.x - target.from.x;
      const segmentY = target.to.y - target.from.y;
      const segmentLength = Math.hypot(segmentX, segmentY);
      let lead = 0;
      if (segmentLength > 0) {
        const targetSpeed = getEnemyDef(target.defId).speed;
        const targetDistance = dist(tower.x, tower.y, target.x, target.y);
        if (def.kind === 'projectile') {
          lead = 0.85 * targetSpeed * targetDistance / speed / segmentLength;
        } else {
          let distance = targetDistance;
          for (let i = 0; i < 2; i++) {
            const time = missileTravelTime(distance, speed, def.projectileAcceleration ?? 0, def.projectileMaxSpeed ?? speed);
            lead = targetSpeed * time / segmentLength;
            distance = dist(tower.x, tower.y, target.x + segmentX * lead, target.y + segmentY * lead);
          }
        }
      }
      const aimX = target.x + segmentX * lead;
      const aimY = target.y + segmentY * lead;
      const aimTimeLeft = turnToward(tower, aimX, aimY, dt);
      if (tower.cooldown <= 0 && aimTimeLeft !== null) {
        tower.cooldown = 1 / def.fireRate;
        const aimDistance = dist(tower.x, tower.y, aimX, aimY) || 1;
        const projectile = {
          id: world.nextEntityId(),
          x: tower.x,
          y: tower.y,
          dx: (aimX - tower.x) / aimDistance,
          dy: (aimY - tower.y) / aimDistance,
          speed,
          acceleration: def.projectileAcceleration ?? 0,
          maxSpeed: def.projectileMaxSpeed ?? speed,
          damage: def.damage,
          splash: def.splash ?? 0,
          pierce: def.armorPierce,
          color: def.color,
        };
        world.projectiles.push(def.kind === 'missile'
          ? { ...projectile, kind: 'missile', targetId: target.id, canReturn: tower.level > 0, phase: 'initial', turnDirection: 0, turnAmount: 0 }
          : { ...projectile, kind: 'projectile' });
        flightTimes.set(projectile.id, Math.min(aimTimeLeft, Math.max(0, dt - previousCooldown)));
        push(world, { type: 'shot', x: tower.x, y: tower.y, color: def.color });
      }
    } else {
      aimAt(tower, target.x, target.y);
      if (tower.cooldown <= 0) {
        tower.cooldown = 1 / def.fireRate;
        fireChain(world, tower, def, target);
      }
    }
  }

  moveProjectiles(world, dt, byId, flightTimes);
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
