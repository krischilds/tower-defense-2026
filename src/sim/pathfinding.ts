import type { Grid } from './grid';

export interface Point {
  x: number;
  y: number;
}

export type BlockedFn = (x: number, y: number) => boolean;

const SQRT2 = Math.SQRT2;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Minimal binary min-heap keyed by priority. */
class MinHeap {
  private items: { k: number; v: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(v: number, k: number) {
    const a = this.items;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Distance-to-goal field (Dijkstra from the goals outward). Movement is 8-directional;
 * diagonals may not cut corners. Unreachable tiles have Infinity distance.
 * One field serves every enemy: each steps to its lowest-distance neighbour,
 * so routes update for all enemies whenever the field is recomputed.
 */
export class FlowField {
  constructor(
    readonly grid: Grid,
    readonly dist: Float64Array,
  ) {}

  distanceAt(x: number, y: number): number {
    return this.grid.inBounds(x, y) ? this.dist[y * this.grid.width + x] : Infinity;
  }

  reachable(p: Point): boolean {
    return Number.isFinite(this.distanceAt(p.x, p.y));
  }

  /** Next tile to step to from `from`, or null if at a goal or unreachable. */
  next(from: Point): Point | null {
    const here = this.distanceAt(from.x, from.y);
    if (!Number.isFinite(here)) return null;
    let best: Point | null = null;
    let bestD = here;
    for (const [dx, dy] of DIRS) {
      const nx = from.x + dx;
      const ny = from.y + dy;
      const d = this.distanceAt(nx, ny);
      if (d >= bestD) continue;
      if (dx !== 0 && dy !== 0 && (this.distanceAt(from.x + dx, from.y) === Infinity || this.distanceAt(from.x, from.y + dy) === Infinity)) continue;
      bestD = d;
      best = { x: nx, y: ny };
    }
    return best;
  }

  /** Full route from `from` to the goal (inclusive), or [] if unreachable. */
  path(from: Point): Point[] {
    if (!this.reachable(from)) return [];
    const out: Point[] = [from];
    let cur: Point | null = from;
    for (let guard = this.dist.length; guard > 0; guard--) {
      cur = this.next(cur);
      if (!cur) break;
      out.push(cur);
    }
    return out;
  }
}

export function computeFlowField(grid: Grid, goals: Point[], blocked: BlockedFn): FlowField {
  const { width: w, height: h } = grid;
  const dist = new Float64Array(w * h).fill(Infinity);
  const heap = new MinHeap();
  for (const g of goals) {
    dist[g.y * w + g.x] = 0;
    heap.push(g.y * w + g.x, 0);
  }
  const passable = (x: number, y: number) => grid.inBounds(x, y) && grid.get(x, y)!.type !== 'blocked' && !blocked(x, y);

  while (heap.size) {
    const { v, k } = heap.pop();
    if (k > dist[v]) continue;
    const x = v % w;
    const y = (v / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
      const nd = k + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      const ni = ny * w + nx;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  return new FlowField(grid, dist);
}
