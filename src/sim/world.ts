import { Grid, type Tile } from './grid';
import { computeFlowField, type FlowField, type Point } from './pathfinding';
import { getTowerDef, getUpgradeBranches } from '../data/towers';
import { getEnemyDef } from '../data/enemies';
import { CORE_HEALTH } from '../data/balance';
import { WAVES, type WaveDef } from '../data/waves';
import { WaveController } from './waves';
import type { Enemy, GameEvent, PlacedTower, Projectile, TargetPriority } from './types';
import { sweepDead, updateCombat } from './combat';

export type { Enemy, PlacedTower, Projectile, GameEvent, TargetPriority } from './types';

export type PlaceFailure =
  | 'out-of-bounds'
  | 'not-buildable'
  | 'occupied'
  | 'enemy-in-way'
  | 'blocks-path'
  | 'insufficient-funds';

export type PlaceResult = { ok: true; tower: PlacedTower } | { ok: false; reason: PlaceFailure };
export type UpgradeResult = { ok: true } | { ok: false; reason: 'no-tower' | 'invalid-branch' | 'branch-locked' | 'max-level' | 'insufficient-funds' | 'game-ended' };

export type GameStatus = 'playing' | 'defeat' | 'victory';

/** Authoritative game state & rules. No rendering/DOM dependencies. */
export class World {
  private towers = new Map<string, PlacedTower>();
  private nextId = 1;
  private startCredits: number;
  flow: FlowField;
  /** Bumped whenever towers or routes change; lets the renderer/UI know to refresh. */
  version = 0;

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  kills = 0;
  coreHealth = CORE_HEALTH;
  readonly coreMax = CORE_HEALTH;
  status: GameStatus = 'playing';
  spawning = true;
  time = 0;
  readonly waves: WaveController;

  constructor(
    readonly grid: Grid,
    public credits: number,
    waves: WaveDef[] = WAVES,
  ) {
    this.startCredits = credits;
    this.waves = new WaveController(waves);
    this.flow = this.computeFlow();
  }

  get spawns(): Tile[] {
    return this.grid.find('spawn');
  }

  towerAt(x: number, y: number): PlacedTower | undefined {
    return this.towers.get(`${x},${y}`);
  }

  allTowers(): PlacedTower[] {
    return [...this.towers.values()];
  }

  isOccupied = (x: number, y: number) => this.towers.has(`${x},${y}`);

  /** True if an enemy is standing on, or walking to/from, this tile. */
  private enemyTouches(x: number, y: number): boolean {
    return this.enemies.some((e) => (e.from.x === x && e.from.y === y) || (e.to.x === x && e.to.y === y));
  }

  /** Every spawn and every live enemy must still reach an objective if (x,y) were occupied. */
  wouldBlockPath(x: number, y: number): boolean {
    const flow = computeFlowField(this.grid, this.grid.find('objective'), (px, py) => (px === x && py === y) || this.isOccupied(px, py));
    return this.spawns.some((s) => !flow.reachable(s)) || this.enemies.some((e) => !flow.reachable(e.to));
  }

  /** Placement check ignoring cost. */
  checkPlacement(x: number, y: number): Exclude<PlaceFailure, 'insufficient-funds'> | null {
    const tile = this.grid.get(x, y);
    if (!tile) return 'out-of-bounds';
    if (tile.type !== 'buildable') return 'not-buildable';
    if (this.isOccupied(x, y)) return 'occupied';
    if (this.enemyTouches(x, y)) return 'enemy-in-way';
    if (this.wouldBlockPath(x, y)) return 'blocks-path';
    return null;
  }

  placeTower(defId: string, x: number, y: number): PlaceResult {
    const def = getTowerDef(defId);
    const bad = this.checkPlacement(x, y);
    if (bad) return { ok: false, reason: bad };
    if (this.credits < def.cost) return { ok: false, reason: 'insufficient-funds' };
    this.credits -= def.cost;
    const tower: PlacedTower = { id: this.nextId++, defId, x, y, invested: def.cost, branch: null, level: 0, priority: 'first', cooldown: 0, targetId: null, aim: 0, firing: false };
    this.towers.set(`${x},${y}`, tower);
    this.refresh();
    return { ok: true, tower };
  }

  upgradeTower(x: number, y: number, branchId: string): UpgradeResult {
    if (this.status !== 'playing') return { ok: false, reason: 'game-ended' };
    const tower = this.towerAt(x, y);
    if (!tower) return { ok: false, reason: 'no-tower' };
    const branch = getUpgradeBranches(tower.defId).find((b) => b.id === branchId);
    if (!branch) return { ok: false, reason: 'invalid-branch' };
    if (tower.branch !== null && tower.branch !== branchId) return { ok: false, reason: 'branch-locked' };
    const next = branch.levels[tower.level];
    if (!next) return { ok: false, reason: 'max-level' };
    if (this.credits < next.cost) return { ok: false, reason: 'insufficient-funds' };
    this.credits -= next.cost;
    tower.invested += next.cost;
    tower.branch = branchId;
    tower.level++;
    this.version++;
    return { ok: true };
  }

  /** Sells the tower at (x,y); returns the refund, or null if none. */
  sellTower(x: number, y: number): number | null {
    const t = this.towerAt(x, y);
    if (!t) return null;
    const refund = Math.floor(t.invested * getTowerDef(t.defId).sellRatio);
    this.credits += refund;
    this.towers.delete(`${x},${y}`);
    this.refresh();
    return refund;
  }

  /** Current route from each spawn to the objective. */
  routes(): Point[][] {
    return this.spawns.map((s) => this.flow.path(s));
  }

  spawnEnemy(defId: string, at: Point, healthMult = 1): Enemy {
    const def = getEnemyDef(defId);
    const hp = Math.round(def.health * healthMult);
    const e: Enemy = {
      id: this.nextId++,
      defId,
      health: hp,
      maxHealth: hp,
      from: { x: at.x, y: at.y },
      to: { x: at.x, y: at.y },
      t: 1,
      len: 1,
      x: at.x,
      y: at.y,
      heading: 0,
      lastHit: -1,
    };
    this.enemies.push(e);
    return e;
  }

  /** Advance the simulation by dt seconds. */
  update(dt: number) {
    if (this.status !== 'playing') return;
    this.time += dt;

    const arrived: Enemy[] = [];
    for (const e of this.enemies) if (this.moveEnemy(e, getEnemyDef(e.defId).speed * dt)) arrived.push(e);

    if (arrived.length) {
      for (const e of arrived) this.coreHealth = Math.max(0, this.coreHealth - getEnemyDef(e.defId).objectiveDamage);
      this.enemies = this.enemies.filter((e) => !arrived.includes(e));
      if (this.coreHealth <= 0) this.status = 'defeat';
    }

    updateCombat(this, dt);
    sweepDead(this);

    if (this.spawning && this.status === 'playing') {
      const bonus = this.waves.update(dt, this.enemies.length, (id, mult) => {
        for (const s of this.spawns) this.spawnEnemy(id, s, mult);
      });
      if (bonus !== null) {
        this.credits += bonus;
        if (this.waves.phase === 'done') this.status = 'victory';
      }
    }
  }

  /** Skip the countdown and launch the next wave now. */
  callNextWave() {
    this.waves.start();
  }

  nextEntityId() {
    return this.nextId++;
  }

  setPriority(x: number, y: number, p: TargetPriority) {
    const t = this.towerAt(x, y);
    if (t) t.priority = p;
  }

  /** Hands pending render events to the caller and clears them. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Restart the level. */
  reset() {
    this.towers.clear();
    this.enemies = [];
    this.projectiles = [];
    this.events = [];
    this.kills = 0;
    this.credits = this.startCredits;
    this.coreHealth = this.coreMax;
    this.status = 'playing';
    this.time = 0;
    this.waves.reset();
    this.refresh();
  }

  /** Moves an enemy; returns true if it reached the objective. */
  private moveEnemy(e: Enemy, distance: number): boolean {
    for (let guard = 0; guard < 64; guard++) {
      if (e.t >= 1) {
        // Arrived at `to`; this is where routes are re-evaluated against the current flow field.
        if (this.grid.get(e.to.x, e.to.y)?.type === 'objective') return true;
        const next = this.flow.next(e.to);
        if (!next) break; // stranded; placement rules should prevent this
        e.from = e.to;
        e.to = next;
        e.t = 0;
        const dx = next.x - e.from.x;
        const dy = next.y - e.from.y;
        e.len = Math.hypot(dx, dy);
        e.heading = Math.atan2(dx, dy);
      }
      if (distance <= 0) break;
      const step = Math.min(distance, (1 - e.t) * e.len);
      e.t += step / e.len;
      distance -= step;
    }
    e.x = e.from.x + (e.to.x - e.from.x) * Math.min(e.t, 1);
    e.y = e.from.y + (e.to.y - e.from.y) * Math.min(e.t, 1);
    return false;
  }

  private refresh() {
    this.flow = this.computeFlow();
    this.version++;
  }

  private computeFlow() {
    return computeFlowField(this.grid, this.grid.find('objective'), this.isOccupied);
  }
}
