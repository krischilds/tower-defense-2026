export interface SpawnGroup {
  enemy: string;
  count: number;
  /** Seconds between spawns within the group. */
  interval: number;
  /** Seconds after the wave starts before the group begins. */
  delay?: number;
}

export interface WaveDef {
  groups: SpawnGroup[];
  /** Credits awarded when the wave is cleared. */
  bonus: number;
  /** Multiplier applied to enemy health for this wave. */
  healthMult?: number;
  boss?: boolean;
}

export const WAVES: WaveDef[] = [
  { groups: [{ enemy: 'basic', count: 8, interval: 1.4 }], bonus: 25 },
  { groups: [{ enemy: 'basic', count: 10, interval: 1.2 }, { enemy: 'runner', count: 3, interval: 1, delay: 6 }], bonus: 30 },
  { groups: [{ enemy: 'swarm', count: 20, interval: 0.5 }, { enemy: 'basic', count: 6, interval: 1.2, delay: 8 }], bonus: 35 },
  { groups: [{ enemy: 'runner', count: 10, interval: 0.8 }, { enemy: 'tank', count: 2, interval: 3, delay: 4 }], bonus: 40 },
  { groups: [{ enemy: 'armored', count: 5, interval: 1.8 }, { enemy: 'basic', count: 10, interval: 1, delay: 3 }], bonus: 45, healthMult: 1.1 },
  { groups: [{ enemy: 'boss', count: 1, interval: 1 }, { enemy: 'swarm', count: 15, interval: 0.5, delay: 6 }], bonus: 100, boss: true },
  { groups: [{ enemy: 'swarm', count: 30, interval: 0.35 }, { enemy: 'runner', count: 10, interval: 0.7, delay: 5 }], bonus: 50, healthMult: 1.2 },
  { groups: [{ enemy: 'tank', count: 6, interval: 2.2 }, { enemy: 'armored', count: 6, interval: 1.5, delay: 4 }], bonus: 55, healthMult: 1.25 },
  { groups: [{ enemy: 'runner', count: 16, interval: 0.6 }, { enemy: 'armored', count: 8, interval: 1.2, delay: 3 }, { enemy: 'basic', count: 15, interval: 0.8, delay: 6 }], bonus: 60, healthMult: 1.3 },
  { groups: [{ enemy: 'tank', count: 8, interval: 1.8 }, { enemy: 'swarm', count: 30, interval: 0.3, delay: 5 }], bonus: 65, healthMult: 1.4 },
  { groups: [{ enemy: 'armored', count: 12, interval: 1.1 }, { enemy: 'runner', count: 16, interval: 0.5, delay: 4 }], bonus: 70, healthMult: 1.5 },
  { groups: [{ enemy: 'boss', count: 2, interval: 8 }, { enemy: 'tank', count: 6, interval: 2, delay: 3 }, { enemy: 'swarm', count: 40, interval: 0.3, delay: 8 }], bonus: 200, healthMult: 1.5, boss: true },
];
