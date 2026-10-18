import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOFTWARE_RENDERER, hasFastWebGL, isSoftwareRenderer, loadIfFastWebGL, probeWebGL, probeWebGLWhenIdle, rendererName, resetWebGLProbe } from '../src/index';

/** Renderer strings as browsers report them. */
const SOFTWARE = [
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  'Google SwiftShader',
  'llvmpipe (LLVM 15.0.7, 256 bits)',
  'softpipe',
  'Microsoft Basic Render Driver',
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Apple Software Renderer',
];
const HARDWARE = [
  'Apple GPU',
  'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Adreno (TM) 740',
  'Mali-G78',
  'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
];

function fakeGl(renderer: string, { debugInfo = true } = {}) {
  const lose = vi.fn();
  const gl = {
    RENDERER: 0x1f01,
    getExtension: (name: string) => name === 'WEBGL_debug_renderer_info' ? (debugInfo ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null)
      : name === 'WEBGL_lose_context' ? { loseContext: lose } : null,
    getParameter: (key: number) => key === 0x9246 ? renderer : key === 0x1f01 ? (debugInfo ? 'WebKit WebGL' : renderer) : null,
  };
  return { gl: gl as unknown as WebGLRenderingContext, lose };
}

function withDocument(getContext: (type: string, options: unknown) => unknown) {
  const createElement = vi.fn(() => ({ getContext: vi.fn(getContext) }));
  vi.stubGlobal('document', { createElement });
  return createElement;
}

afterEach(() => { vi.unstubAllGlobals(); resetWebGLProbe(); });

describe('renderer name', () => {
  it.each(SOFTWARE)('recognises a CPU rasterizer: %s', (name) => {
    expect(SOFTWARE_RENDERER.test(name)).toBe(true);
    expect(isSoftwareRenderer(fakeGl(name).gl)).toBe(true);
  });

  it.each(HARDWARE)('leaves a real GPU alone: %s', (name) => {
    expect(isSoftwareRenderer(fakeGl(name).gl)).toBe(false);
  });

  it('reads RENDERER when the unmasked name is not exposed (Firefox, Safari)', () => {
    expect(rendererName(fakeGl('llvmpipe', { debugInfo: false }).gl)).toBe('llvmpipe');
  });
});

describe('probe', () => {
  it('a real GPU opens the gate, asks for the caveat flag and releases the probe context', () => {
    const { gl, lose } = fakeGl('Apple GPU');
    let options: unknown;
    withDocument((type, opts) => { options = opts; return type === 'webgl' ? gl : null; });
    expect(probeWebGL()).toEqual({ fast: true, reason: 'gpu', renderer: 'Apple GPU' });
    expect(options).toEqual({ failIfMajorPerformanceCaveat: true });
    expect(lose).toHaveBeenCalledOnce();
  });

  it('SwiftShader that ignores the caveat flag still keeps the gate closed', () => {
    withDocument(() => fakeGl('Google SwiftShader').gl);
    expect(probeWebGL()).toMatchObject({ fast: false, reason: 'software' });
  });

  it('no context (WebGL off, blocked, or caveat refused) keeps the gate closed', () => {
    withDocument(() => null);
    expect(probeWebGL()).toEqual({ fast: false, reason: 'no-context', renderer: '' });
  });

  it('a throwing browser keeps the gate closed instead of breaking the page', () => {
    withDocument(() => { throw new Error('blocked'); });
    expect(probeWebGL()).toEqual({ fast: false, reason: 'error', renderer: '' });
  });

  it('probes once per page', () => {
    const create = withDocument(() => fakeGl('Apple GPU').gl);
    probeWebGL(); probeWebGL(); hasFastWebGL();
    expect(create).toHaveBeenCalledOnce();
  });

  it('on the server answers "not fast" without caching, so the client probes for itself', () => {
    expect(probeWebGL()).toEqual({ fast: false, reason: 'no-dom', renderer: '' });
    withDocument(() => fakeGl('Apple GPU').gl);
    expect(probeWebGL().fast).toBe(true);
  });
});

describe('loadIfFastWebGL', () => {
  it('never calls the import on the CPU, so the bundle is not downloaded', async () => {
    withDocument(() => fakeGl('llvmpipe').gl);
    const load = vi.fn(async () => ({ mount: () => {} }));
    expect(await loadIfFastWebGL(load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads on a real GPU', async () => {
    withDocument(() => fakeGl('Apple GPU').gl);
    const scene = { mount: () => {} };
    expect(await loadIfFastWebGL(async () => scene)).toBe(scene);
  });
});

describe('probeWebGLWhenIdle', () => {
  it('waits for load, then probes in an idle callback, not during page load', async () => {
    const create = withDocument(() => fakeGl('Apple GPU').gl);
    let onLoad: (() => void) | undefined;
    let onIdle: (() => void) | undefined;
    (document as unknown as { readyState: string }).readyState = 'loading';
    vi.stubGlobal('window', {
      addEventListener: (_: string, fn: () => void) => { onLoad = fn; },
      requestIdleCallback: (fn: () => void) => { onIdle = fn; },
    });
    const pending = probeWebGLWhenIdle();
    expect(create).not.toHaveBeenCalled();
    onLoad!();
    expect(create).not.toHaveBeenCalled();
    onIdle!();
    expect((await pending).fast).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });
});
