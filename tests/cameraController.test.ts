import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { CameraController } from '../src/render/cameraController';

afterEach(() => vi.unstubAllGlobals());

describe('CameraController third-person view', () => {
  it('restores the requested centered perspective and remains adjustable', () => {
    vi.stubGlobal('window', new EventTarget());
    const element = Object.assign(new EventTarget(), { style: {}, clientHeight: 600 }) as HTMLElement;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const controls = new CameraController(camera, element);
    controls.rotate(1, 0.2);
    controls.zoom(0.5);
    controls.pan(80, 40);

    controls.update(0);
    const initialPosition = camera.position.clone();
    controls.thirdPersonView();
    expect(camera.position.distanceTo(initialPosition)).toBe(0);
    controls.update(0.4);
    expect(camera.position.distanceTo(initialPosition)).toBeGreaterThan(0);
    expect(controls.distance).not.toBe(25.56);
    controls.update(0.4);
    const position = camera.position.clone();
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(THREE.MathUtils.radToDeg(controls.yaw)).toBeCloseTo(0.28);
    expect(THREE.MathUtils.radToDeg(controls.pitch)).toBeCloseTo(79.54);
    expect(controls.distance).toBe(25.56);
    expect(position.x).toBeCloseTo(0.02, 2);
    expect(position.y).toBeCloseTo(25.14, 2);
    expect(position.z).toBeCloseTo(4.64, 2);
    expect(camera.isPerspectiveCamera).toBe(true);

    controls.rotate(Math.PI / 4, 0.1);
    controls.zoom(0.8);
    controls.pan(20, 10);
    controls.update(0);
    expect(camera.position.distanceTo(position)).toBeGreaterThan(0);
    controls.thirdPersonView();
    controls.update(0.8);
    expect(camera.position.distanceTo(position)).toBeCloseTo(0);
    controls.dispose();
  });

  it('reports the updated camera position, target, angles, and zoom', () => {
    vi.stubGlobal('window', new EventTarget());
    const element = Object.assign(new EventTarget(), { style: {}, clientHeight: 600 }) as HTMLElement;
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 200);
    const controls = new CameraController(camera, element);
    controls.thirdPersonView();
    controls.update(0.8);
    expect(controls.getDebugInfo()).toBe(
      'Position (x, y, z): 0.02, 25.14, 4.64\n' +
      'Target (x, y, z): 0.00, 0.00, 0.00\n' +
      'Yaw: 0.28°  Pitch: 79.54°\n' +
      'Distance: 25.56  FOV: 40.00°  Aspect: 1.50',
    );
    controls.rotate(Math.PI / 2);
    controls.zoom(0.5);
    controls.pan(20, 10);
    controls.update(0);
    const info = controls.getDebugInfo();
    expect(info).toContain('Yaw: 90.28°');
    expect(info).toContain('Distance: 12.78');
    expect(info).not.toContain('Target (x, y, z): 0.00, 0.00, 0.00');
    controls.dispose();
  });

  it('takes the shortest rotation and restarts from the current view', () => {
    vi.stubGlobal('window', new EventTarget());
    const element = Object.assign(new EventTarget(), { style: {}, clientHeight: 600 }) as HTMLElement;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const controls = new CameraController(camera, element);
    controls.rotate(THREE.MathUtils.degToRad(359) - controls.yaw);
    controls.update(0);
    controls.thirdPersonView();
    controls.update(0.4);
    expect(THREE.MathUtils.radToDeg(controls.yaw)).toBeCloseTo(359.64);
    const halfway = camera.position.clone();
    controls.thirdPersonView();
    expect(camera.position.distanceTo(halfway)).toBe(0);
    controls.update(0.8);
    expect(THREE.MathUtils.radToDeg(controls.yaw)).toBeCloseTo(0.28);
    controls.dispose();
  });

  it.each(['rotate', 'zoom', 'pan'] as const)('stops animating when the user uses %s', (action) => {
    vi.stubGlobal('window', new EventTarget());
    const element = Object.assign(new EventTarget(), { style: {}, clientHeight: 600 }) as HTMLElement;
    const controls = new CameraController(new THREE.PerspectiveCamera(40, 1, 0.1, 200), element);
    controls.thirdPersonView();
    controls.update(0.2);
    if (action === 'rotate') controls.rotate(0.1);
    if (action === 'zoom') controls.zoom(0.9);
    if (action === 'pan') controls.pan(20, 10);
    const state = { yaw: controls.yaw, pitch: controls.pitch, distance: controls.distance, target: controls.target.clone() };
    controls.update(1);
    expect(controls.yaw).toBe(state.yaw);
    expect(controls.pitch).toBe(state.pitch);
    expect(controls.distance).toBe(state.distance);
    expect(controls.target.equals(state.target)).toBe(true);
    controls.dispose();
  });

  it('stops animating when the user pans with the keyboard', () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal('window', windowTarget);
    const element = Object.assign(new EventTarget(), { style: {}, clientHeight: 600 }) as HTMLElement;
    const controls = new CameraController(new THREE.PerspectiveCamera(40, 1, 0.1, 200), element);
    controls.thirdPersonView();
    controls.update(0.2);
    windowTarget.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
    controls.update(0.1);
    windowTarget.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
    const target = controls.target.clone();
    controls.update(1);
    expect(controls.target.equals(target)).toBe(true);
    expect(controls.distance).not.toBe(25.56);
    controls.dispose();
  });
});
