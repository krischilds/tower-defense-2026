import * as THREE from 'three/webgpu';

export class WebGPUUnavailableError extends Error {}

/**
 * Creates a WebGPU-only renderer. Never falls back to WebGL/Canvas:
 * if WebGPU isn't usable, throws WebGPUUnavailableError.
 */
export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<THREE.WebGPURenderer> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new WebGPUUnavailableError('This browser does not expose navigator.gpu (WebGPU).');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new WebGPUUnavailableError('No suitable WebGPU adapter was found.');

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
  await renderer.init();

  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  if (!backend.isWebGPUBackend) {
    renderer.dispose();
    throw new WebGPUUnavailableError('Renderer initialised without the WebGPU backend; refusing to run on WebGL.');
  }
  return renderer;
}
