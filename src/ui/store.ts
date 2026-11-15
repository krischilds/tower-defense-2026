import { defineStore } from 'pinia';
import type { Tile } from '../sim/grid';

export const useGameStore = defineStore('game', {
  state: () => ({
    currency: 0,
    objectiveHealth: 20,
    objectiveMax: 20,
    wave: 0,
    totalWaves: 0,
    fps: 0,
    backend: 'initialising…',
    hovered: null as Tile | null,
    selected: null as Tile | null,
    placing: null as string | null,
    showPath: true,
    message: '',
    paused: true,
    speed: 1,
    defeated: false,
    enemyCount: 0,
    wavePhase: 'countdown' as 'countdown' | 'active' | 'done',
    countdown: 0,
    lastBonus: 0,
    victory: false,
    /** Bumped when the (non-reactive) sim world changes, so computed UI refreshes. */
    revision: 0,
    error: null as string | null,
  }),
});
