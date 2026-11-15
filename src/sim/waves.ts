import type { WaveDef } from '../data/waves';
import { FIRST_WAVE_DELAY, WAVE_DELAY } from '../data/balance';

export type WavePhase = 'countdown' | 'active' | 'done';

interface QueuedSpawn {
  at: number;
  enemy: string;
}

/** Drives automatic waves from data. Pure sim state; the World performs the actual spawning. */
export class WaveController {
  /** Number of waves started so far (1-based index of the current/last wave; 0 before the first). */
  started = 0;
  phase: WavePhase = 'countdown';
  countdown = FIRST_WAVE_DELAY;
  /** Bonus paid for the most recently cleared wave (for UI feedback). */
  lastBonus = 0;
  private clock = 0;
  private queue: QueuedSpawn[] = [];

  constructor(private waves: WaveDef[]) {}

  get total() {
    return this.waves.length;
  }

  get current(): WaveDef | undefined {
    return this.waves[this.started - 1];
  }

  reset() {
    this.started = 0;
    this.phase = 'countdown';
    this.countdown = FIRST_WAVE_DELAY;
    this.lastBonus = 0;
    this.clock = 0;
    this.queue = [];
  }

  /** Begin the next wave immediately (also used when the countdown expires). */
  start() {
    if (this.phase !== 'countdown' || this.started >= this.waves.length) return;
    const wave = this.waves[this.started++];
    this.clock = 0;
    this.queue = wave.groups
      .flatMap((g) => Array.from({ length: g.count }, (_, i) => ({ at: (g.delay ?? 0) + i * g.interval, enemy: g.enemy })))
      .sort((a, b) => a.at - b.at);
    this.phase = 'active';
  }

  /**
   * Advances time. `spawn` is called per enemy due; `alive` is the live enemy count.
   * Returns the cleared wave's bonus when a wave completes, otherwise null.
   */
  update(dt: number, alive: number, spawn: (enemy: string, healthMult: number) => void): number | null {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.start();
      return null;
    }
    if (this.phase !== 'active') return null;

    const wave = this.current!;
    this.clock += dt;
    while (this.queue.length && this.queue[0].at <= this.clock) spawn(this.queue.shift()!.enemy, wave.healthMult ?? 1);

    if (this.queue.length === 0 && alive === 0) {
      this.lastBonus = wave.bonus;
      if (this.started >= this.waves.length) this.phase = 'done';
      else {
        this.phase = 'countdown';
        this.countdown = WAVE_DELAY;
      }
      return wave.bonus;
    }
    return null;
  }
}
