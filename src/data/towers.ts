export type TowerKind = 'projectile' | 'beam' | 'chain';

export interface TowerDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Fraction of cost refunded on sell. */
  sellRatio: number;
  color: number;
  kind: TowerKind;
  /** Damage per hit (projectile/chain) or per second (beam). */
  damage: number;
  /** Shots per second (ignored by beams). */
  fireRate: number;
  /** Tiles. */
  range: number;
  /** Fraction of enemy armor ignored (0..1). */
  armorPierce: number;
  /** Projectile only. */
  projectileSpeed?: number;
  splash?: number;
  /** Chain only. */
  chainCount?: number;
  chainRange?: number;
  /** Damage multiplier per additional chain jump. */
  chainFalloff?: number;
}

export const TOWERS: TowerDef[] = [
  {
    id: 'cannon', name: 'Cannon', description: 'Slow heavy shells with splash; partly ignores armor.',
    cost: 50, sellRatio: 0.7, color: 0xffa84d, kind: 'projectile',
    damage: 25, fireRate: 0.8, range: 3.5, armorPierce: 0.5, projectileSpeed: 9, splash: 0.8,
  },
  {
    id: 'laser', name: 'Laser', description: 'Continuous beam; reliable damage on a single target.',
    cost: 75, sellRatio: 0.7, color: 0xff4d6a, kind: 'beam',
    damage: 14, fireRate: 0, range: 3, armorPierce: 0,
  },
  {
    id: 'tesla', name: 'Tesla', description: 'Lightning that jumps between nearby enemies.',
    cost: 100, sellRatio: 0.7, color: 0x6ad8ff, kind: 'chain',
    damage: 10, fireRate: 1.5, range: 2.8, armorPierce: 0, chainCount: 4, chainRange: 1.8, chainFalloff: 0.8,
  },
];

export const STARTING_CREDITS = 300;

export const getTowerDef = (id: string): TowerDef => {
  const d = TOWERS.find((t) => t.id === id);
  if (!d) throw new Error(`Unknown tower '${id}'`);
  return d;
};

export type CombatStats = Pick<TowerDef, 'damage' | 'fireRate' | 'range' | 'armorPierce' | 'projectileSpeed' | 'splash' | 'chainCount' | 'chainRange' | 'chainFalloff'>;

export interface UpgradeLevel {
  cost: number;
  description: string;
  stats: Partial<CombatStats>;
}

export interface UpgradeBranch {
  id: string;
  name: string;
  color: number;
  levels: UpgradeLevel[];
}

export const TOWER_UPGRADES: Record<string, UpgradeBranch[]> = {
  cannon: [
    { id: 'siege', name: 'Siege', color: 0xffd05a, levels: [
      { cost: 60, description: 'Wider splash and longer range for clustered enemies.', stats: { splash: 1.4, range: 4 } },
      { cost: 110, description: 'Larger blast and stronger shells.', stats: { splash: 1.9, damage: 38 } },
    ] },
  ],
  laser: [
    { id: 'lance', name: 'Lance', color: 0xffa0d4, levels: [
      { cost: 65, description: 'Long-range beam penetrates armor.', stats: { range: 4, armorPierce: 0.6 } },
      { cost: 120, description: 'Extended range and full armor penetration.', stats: { range: 5, armorPierce: 1 } },
    ] },
  ],
  tesla: [
    { id: 'storm', name: 'Storm', color: 0xa999ff, levels: [
      { cost: 75, description: 'Chains to more enemies over longer distances.', stats: { chainCount: 6, chainRange: 2.3 } },
      { cost: 130, description: 'More jumps with reduced damage falloff.', stats: { chainCount: 8, chainFalloff: 0.9 } },
    ] },
  ],
};

export function getUpgradeBranches(defId: string): UpgradeBranch[] {
  getTowerDef(defId);
  return TOWER_UPGRADES[defId] ?? [];
}

export function getEffectiveTowerDef(tower: { defId: string; branch: string | null; level: number }): TowerDef {
  const base = getTowerDef(tower.defId);
  if (tower.level === 0 && tower.branch === null) return base;
  const branch = getUpgradeBranches(tower.defId).find((b) => b.id === tower.branch);
  if (!branch || !Number.isInteger(tower.level) || tower.level < 1 || tower.level > branch.levels.length) {
    throw new Error(`Invalid upgrade state for tower '${tower.defId}'`);
  }
  const result = { ...base, color: branch.color };
  for (const level of branch.levels.slice(0, tower.level)) Object.assign(result, level.stats);
  return result;
}
