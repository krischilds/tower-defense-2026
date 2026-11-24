import type { Point } from './pathfinding';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest' | 'closest';
export const PRIORITIES: TargetPriority[] = ['first', 'last', 'strongest', 'weakest', 'closest'];

export interface PlacedTower {
  id: number;
  defId: string;
  x: number;
  y: number;
  invested: number;
  branch: string | null;
  level: number;
  priority: TargetPriority;
  /** Seconds until the next shot (projectile/missile/chain towers). */
  cooldown: number;
  targetId: number | null;
  /** Facing in radians (atan2(dx, dy) in tile space). */
  aim: number;
  /** True while a beam tower is damaging its target. */
  firing: boolean;
}

export interface Enemy {
  id: number;
  defId: string;
  health: number;
  maxHealth: number;
  /** Segment currently being walked: from -> to, progress t in [0,1]. */
  from: Point;
  to: Point;
  t: number;
  len: number;
  /** Continuous position in tile coordinates. */
  x: number;
  y: number;
  /** Heading in radians on the ground plane (atan2 of dx, dy in tile space). */
  heading: number;
  /** Sim time of the last damage taken (for hit feedback). */
  lastHit: number;
}

export interface Projectile {
  id: number;
  kind: 'projectile' | 'missile';
  x: number;
  y: number;
  targetId: number;
  /** Last known target position; the shell keeps flying here if the target dies. */
  tx: number;
  ty: number;
  speed: number;
  acceleration: number;
  maxSpeed: number;
  damage: number;
  splash: number;
  pierce: number;
  color: number;
}

/** One-shot notifications for the renderer; drained each frame. */
export type GameEvent =
  | { type: 'shot'; x: number; y: number; color: number }
  | { type: 'hit'; x: number; y: number; color: number; big: boolean }
  | { type: 'death'; x: number; y: number; color: number }
  | { type: 'missileTrail'; id: number; from: Point; to: Point }
  | { type: 'chain'; points: Point[]; color: number };
