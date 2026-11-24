import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Battlefield } from '../src/render/battlefield';
import { Grid } from '../src/sim/grid';

describe('tower placement preview', () => {
  it('reuses the preview when moving and rebuilds it when validity changes', () => {
    const grid = Grid.fromMap({ id: 't', name: 't', rows: ['S..O', '....'] });
    const field = new Battlefield(grid);
    field.showGhost({ x: 1, y: 1 }, 'missile', true);
    const ghost = field.group.children.find(
      (child) => child instanceof THREE.Group && child.children.some((mesh) => mesh.userData.head),
    );
    if (!(ghost instanceof THREE.Group)) throw new Error('Expected a tower preview');
    const first = ghost.children[0];
    const part = first.children.find((child) => child instanceof THREE.Mesh);
    if (!(part instanceof THREE.Mesh)) throw new Error('Expected a tower preview mesh');
    const dispose = vi.spyOn(part.geometry, 'dispose');

    field.showGhost({ x: 2, y: 1 }, 'missile', true);
    expect(ghost.children[0]).toBe(first);
    expect(ghost.position).toEqual(field.tileToWorld(2, 1, 0.2));

    field.showGhost({ x: 2, y: 1 }, 'missile', false);
    expect(ghost.children[0]).not.toBe(first);
    expect(dispose).toHaveBeenCalledOnce();
    field.showGhost(null, null, false);
    expect(ghost.visible).toBe(false);
  });
});
