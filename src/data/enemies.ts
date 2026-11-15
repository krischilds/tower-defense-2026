export interface EnemyDef {
  id: string;
  name: string;
  health: number;
  /** Tiles per second. */
  speed: number;
  armor: number;
  /** Core damage when it reaches the objective. */
  objectiveDamage: number;
  reward: number;
  color: number;
  /** Visual size multiplier. */
  scale: number;
}

export const ENEMIES: EnemyDef[] = [
  { id: 'basic', name: 'Drone', health: 30, speed: 1.6, armor: 0, objectiveDamage: 1, reward: 5, color: 0xff5a5a, scale: 0.6 },
  { id: 'runner', name: 'Runner', health: 18, speed: 3.2, armor: 0, objectiveDamage: 1, reward: 4, color: 0xffe14d, scale: 0.45 },
  { id: 'tank', name: 'Tank', health: 140, speed: 0.9, armor: 2, objectiveDamage: 3, reward: 15, color: 0xa66bff, scale: 0.85 },
  { id: 'armored', name: 'Plated Walker', health: 80, speed: 1.2, armor: 4, objectiveDamage: 2, reward: 10, color: 0x7fa8c9, scale: 0.7 },
  { id: 'swarm', name: 'Swarmling', health: 8, speed: 2.2, armor: 0, objectiveDamage: 1, reward: 1, color: 0x6bff9a, scale: 0.3 },
  { id: 'boss', name: 'Dreadnought', health: 1400, speed: 0.7, armor: 3, objectiveDamage: 10, reward: 150, color: 0xff3df0, scale: 1.3 },
];

export const getEnemyDef = (id: string): EnemyDef => {
  const d = ENEMIES.find((e) => e.id === id);
  if (!d) throw new Error(`Unknown enemy '${id}'`);
  return d;
};
