import * as THREE from 'three/webgpu';

const PRESET_YAW = THREE.MathUtils.degToRad(0.28);
const PRESET_PITCH = THREE.MathUtils.degToRad(79.54);
const PRESET_DISTANCE = 25.56;
const PRESET_DURATION = 0.8;

/** Orbit-style RTS camera: yaw/pitch/distance around a pan target on the ground plane. */
export class CameraController {
  target = new THREE.Vector3();
  yaw = PRESET_YAW;
  pitch = PRESET_PITCH;
  distance = PRESET_DISTANCE;

  minDistance = 8;
  maxDistance = 45;
  minPitch = THREE.MathUtils.degToRad(25);
  maxPitch = THREE.MathUtils.degToRad(80);
  panLimit = 10;

  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'none' | 'pan' | 'rotate' = 'none';
  private dragMoved = 0;
  private keys = new Set<string>();
  private pinchPrev: { dist: number; angle: number; cx: number; cy: number } | null = null;
  private transition: { target: THREE.Vector3; yaw: number; yawDelta: number; pitch: number; distance: number; elapsed: number } | null = null;

  /** Called for a click/tap that wasn't a drag. */
  onTap: (clientX: number, clientY: number) => void = () => {};
  onHover: (clientX: number, clientY: number) => void = () => {};

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.apply();
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
    this.el.removeEventListener('wheel', this.wheel);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
  }

  rotate(dYaw: number, dPitch = 0) {
    this.transition = null;
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, this.minPitch, this.maxPitch);
  }

  topDownView() {
    const yawDelta = PRESET_YAW - this.yaw;
    this.transition = {
      target: this.target.clone(),
      yaw: this.yaw,
      yawDelta: Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)),
      pitch: this.pitch,
      distance: this.distance,
      elapsed: 0,
    };
  }

  zoom(factor: number) {
    this.transition = null;
    this.distance = THREE.MathUtils.clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  /** Pan in screen-space pixels, converted to ground-plane movement. */
  pan(dxPx: number, dyPx: number) {
    const scale = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / Math.max(this.el.clientHeight, 1);
    this.move2D(-dxPx * scale, dyPx * scale);
  }

  /** Move target in camera-relative ground axes (right, forward). */
  private move2D(right: number, forward: number) {
    this.transition = null;
    this.target.x += Math.cos(this.yaw) * right - Math.sin(this.yaw) * forward;
    this.target.z += -Math.sin(this.yaw) * right - Math.cos(this.yaw) * forward;
    this.clampTarget();
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -this.panLimit, this.panLimit);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -this.panLimit, this.panLimit);
  }

  update(dt: number) {
    const speed = this.distance * 0.7 * dt;
    let dx = 0;
    let dz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (dx || dz) this.move2D(dx * speed, dz * speed);
    if (this.keys.has('KeyQ')) this.rotate(-1.8 * dt);
    if (this.keys.has('KeyE')) this.rotate(1.8 * dt);
    if (this.transition) {
      const transition = this.transition;
      transition.elapsed += dt;
      const progress = Math.min(transition.elapsed / PRESET_DURATION, 1);
      const eased = progress * progress * (3 - 2 * progress);
      this.target.copy(transition.target).multiplyScalar(1 - eased);
      this.yaw = transition.yaw + transition.yawDelta * eased;
      this.pitch = THREE.MathUtils.lerp(transition.pitch, PRESET_PITCH, eased);
      this.distance = THREE.MathUtils.lerp(transition.distance, PRESET_DISTANCE, eased);
      if (progress === 1) {
        this.target.set(0, 0, 0);
        this.yaw = PRESET_YAW;
        this.transition = null;
      }
    }
    this.apply();
  }

  apply() {
    const { yaw, pitch, distance, target } = this;
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(target);
  }

  getDebugInfo() {
    const formatVector = (v: THREE.Vector3) => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
    return [
      `Position (x, y, z): ${formatVector(this.camera.position)}`,
      `Target (x, y, z): ${formatVector(this.target)}`,
      `Yaw: ${THREE.MathUtils.radToDeg(this.yaw).toFixed(2)}°  Pitch: ${THREE.MathUtils.radToDeg(this.pitch).toFixed(2)}°`,
      `Distance: ${this.distance.toFixed(2)}  FOV: ${this.camera.fov.toFixed(2)}°  Aspect: ${this.camera.aspect.toFixed(2)}`,
    ].join('\n');
  }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragMoved = 0;
      this.dragMode = e.button === 2 || e.button === 1 ? 'rotate' : 'pan';
    } else if (this.pointers.size === 2) {
      this.dragMode = 'none';
      this.dragMoved = 999; // never a tap
      this.pinchPrev = this.pinchState();
    }
  };

  private move = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      this.onHover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.dragMoved < 6) return;
      if (this.dragMode === 'rotate') this.rotate(-dx * 0.006, dy * 0.005);
      else if (this.dragMode === 'pan') this.pan(dx, dy);
      if (e.pointerType === 'mouse') this.onHover(e.clientX, e.clientY);
    } else if (this.pointers.size === 2 && this.pinchPrev) {
      const cur = this.pinchState();
      this.zoom(this.pinchPrev.dist / Math.max(cur.dist, 1));
      let dA = cur.angle - this.pinchPrev.angle;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      this.rotate(-dA);
      this.pan(cur.cx - this.pinchPrev.cx, cur.cy - this.pinchPrev.cy);
      this.pinchPrev = cur;
    }
  };

  private up = (e: PointerEvent) => {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (wasSingle && e.type === 'pointerup' && e.button === 0 && this.dragMoved < 6) {
      this.onTap(e.clientX, e.clientY);
    }
    if (this.pointers.size < 2) this.pinchPrev = null;
    if (this.pointers.size === 0) this.dragMode = 'none';
  };

  private pinchState() {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.001));
  };

  private keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
}
