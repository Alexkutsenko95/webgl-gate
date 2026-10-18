import { useEffect, useState } from 'react';
import { probeWebGLWhenIdle } from './index.js';

/**
 * `null` during server rendering, the first client render (so hydration matches) and until the page has loaded
 * and the browser is idle; then `true` on a real GPU and `false` on a CPU rasterizer or without WebGL. Render your
 * static fallback while it is not `true`.
 *
 *   const fast = useFastWebGL();
 *   return fast ? <LiveScene /> : <img src="/cover.avif" alt="" />;
 */
export function useFastWebGL(): boolean | null {
  const [fast, setFast] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void probeWebGLWhenIdle().then((result) => { if (alive) setFast(result.fast); });
    return () => { alive = false; };
  }, []);
  return fast;
}
