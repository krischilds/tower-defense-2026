export type TileType = 'buildable' | 'blocked' | 'spawn' | 'objective';

export interface Tile {
  x: number;
  y: number;
  type: TileType;
}

export interface MapDefinition {
  id: string;
  name: string;
  /** One string per row; chars: '.' buildable, '#' blocked, 'S' spawn, 'O' objective. */
  rows: string[];
}

const CHAR_TO_TYPE: Record<string, TileType> = {
  '.': 'buildable',
  '#': 'blocked',
  S: 'spawn',
  O: 'objective',
};

/** Pure simulation grid. No rendering or DOM dependencies. */
export class Grid {
  readonly width: number;
  readonly height: number;
  private tiles: Tile[];

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Grid dimensions must be positive');
    this.width = width;
    this.height = height;
    this.tiles = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.tiles.push({ x, y, type: 'buildable' });
    }
  }

  static fromMap(map: MapDefinition): Grid {
    const height = map.rows.length;
    const width = map.rows[0]?.length ?? 0;
    const grid = new Grid(width, height);
    map.rows.forEach((row, y) => {
      if (row.length !== width) throw new Error(`Map row ${y} has inconsistent width`);
      [...row].forEach((ch, x) => {
        const type = CHAR_TO_TYPE[ch];
        if (!type) throw new Error(`Unknown map character '${ch}' at ${x},${y}`);
        grid.tiles[y * width + x].type = type;
      });
    });
    return grid;
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Tile | undefined {
    return this.inBounds(x, y) ? this.tiles[y * this.width + x] : undefined;
  }

  all(): readonly Tile[] {
    return this.tiles;
  }

  find(type: TileType): Tile[] {
    return this.tiles.filter((t) => t.type === type);
  }
}
