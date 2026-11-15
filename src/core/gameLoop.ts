import { SIM_STEP } from '../data/balance';

export interface Steppable {
  update(dt: number): void;
}

/** Fixed-timestep driver with pause and speed control, decoupled from render frame rate. */
export class GameLoop {
  paused = true;
  speed = 1;
  private acc = 0;

  constructor(private sim: Steppable) {}

  /** Call once per rendered frame with the real elapsed seconds. */
  advance(realDt: number) {
    if (this.paused) return;
    this.acc += realDt * this.speed;
    // Bound catch-up work after a long frame (e.g. a background tab).
    const maxAcc = SIM_STEP * 12;
    if (this.acc > maxAcc) this.acc = maxAcc;
    while (this.acc >= SIM_STEP) {
      this.sim.update(SIM_STEP);
      this.acc -= SIM_STEP;
    }
  }
}
