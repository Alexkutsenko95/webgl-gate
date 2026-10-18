/**
 * webgl-gate: decide, before you download a WebGL bundle, whether this page is drawn by a real GPU.
 *
 * Software rasterizers (SwiftShader, llvmpipe, softpipe, "Microsoft Basic Render Driver") run WebGL on the CPU.
 * Lighthouse and PageSpeed Insights measure mobile pages on exactly that kind of renderer, and so do many
 * virtual machines, remote desktops and browsers with hardware acceleration turned off. There a WebGL scene
 * costs main-thread time and Total Blocking Time, and the user gets a slideshow instead of an effect.
 *
 * `failIfMajorPerformanceCaveat` is not enough on its own: headless Chrome with SwiftShader still hands out a
 * context with that flag set. So the verdict also reads the renderer name.
 */

/** Renderer names of known CPU rasterizers. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

type TGL = WebGLRenderingContext | WebGL2RenderingContext;

/** The most specific renderer name the browser exposes: unmasked when allowed, otherwise `RENDERER`. */
export function rendererName(gl: TGL): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
}

/** True when this context is rasterized on the CPU. */
export function isSoftwareRenderer(gl: TGL): boolean {
  return SOFTWARE_RENDERER.test(rendererName(gl));
}

/**
 * Why the gate decided as it did. `no-context`: WebGL is off or blocked, or the browser itself reported a major
 * performance caveat. `software`: a context exists, but a CPU rasterizer draws it.
 */
export type TGateReason = 'no-dom' | 'no-context' | 'software' | 'error' | 'gpu';

export interface IGateResult {
  /** A real GPU draws this page: loading the WebGL bundle is worth it. */
  readonly fast: boolean;
  readonly reason: TGateReason;
  /** Renderer name, when a context was created. */
  readonly renderer: string;
}

let cached: IGateResult | undefined;

/**
 * Probe once per page with a throwaway canvas and release the context right away. The result is memoized:
 * call it from as many components as you like. On the server (no `document`) it answers `fast: false`
 * without caching, so the client still gets its own probe.
 */
export function probeWebGL(): IGateResult {
  if (cached) return cached;
  if (typeof document === 'undefined') return { fast: false, reason: 'no-dom', renderer: '' };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
    if (!gl) return (cached = { fast: false, reason: 'no-context', renderer: '' });
    const renderer = rendererName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const software = SOFTWARE_RENDERER.test(renderer);
    return (cached = { fast: !software, reason: software ? 'software' : 'gpu', renderer });
  } catch {
    return (cached = { fast: false, reason: 'error', renderer: '' });
  }
}

/**
 * The probe is cheap on a GPU (10–25 ms in headless Chrome on Apple M2 Pro) but expensive exactly where it
 * answers "no": creating the first context on SwiftShader took 1.4–1.7 s of main thread in the same Chrome.
 * So run it off the critical path: after `load`, when the browser is idle. This is what the React hook and
 * `loadIfFastWebGL` do.
 */
export function probeWebGLWhenIdle(timeout = 3000): Promise<IGateResult> {
  if (cached || typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(probeWebGL());
  return new Promise((done) => {
    const run = () => done(probeWebGL());
    const idle = () => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout });
      else setTimeout(run, 1);
    };
    if (document.readyState === 'complete') idle();
    else window.addEventListener('load', idle, { once: true });
  });
}

/** Shorthand: `true` when a real GPU draws this page. Probes synchronously; prefer the idle form on load. */
export const hasFastWebGL = (): boolean => probeWebGL().fast;

/**
 * Load a module only on a real GPU, after the page has loaded. Pass a dynamic import so the bundler splits it out:
 *
 *   const scene = await loadIfFastWebGL(() => import('./scene'));
 *   if (scene) scene.mount(canvas); else keepStaticImage();
 *
 * On the CPU the import is never called, so the bundle is never downloaded or parsed.
 */
export async function loadIfFastWebGL<T>(load: () => Promise<T>): Promise<T | null> {
  return (await probeWebGLWhenIdle()).fast ? load() : null;
}

/** Forget the memoized verdict (tests, or after the user toggles a quality setting). */
export function resetWebGLProbe(): void {
  cached = undefined;
}
