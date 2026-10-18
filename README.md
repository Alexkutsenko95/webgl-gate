# webgl-gate

Skip your WebGL bundle when the page is drawn by the CPU.

Lighthouse and PageSpeed Insights measure mobile pages on **SwiftShader**, a software rasterizer. So do many
virtual machines and remote desktops, and so does any browser with hardware acceleration switched off. There a
PixiJS or three.js scene doesn't just run slowly. Downloading and parsing its bundle alone costs main-thread time,
and your Total Blocking Time goes with it. `webgl-gate` answers one question before you load that bundle: **is
there a real GPU behind this page?**

- **Under 1 kB:** 745 B gzip for the core, 223 B for the React hook.
- **No network, no benchmark tables, no dependencies.**
- **Checks the renderer name, not only `failIfMajorPerformanceCaveat`.** Headless Chrome on SwiftShader still hands
  out a context with that flag set.
- **Off the critical path:** probes after `load`, when the browser is idle.

## Install

```bash
npm install webgl-gate
```

## Use

Load the scene only on a real GPU. On the CPU the import is never called, so the bundle is never downloaded:

```ts
import { loadIfFastWebGL } from 'webgl-gate';

const scene = await loadIfFastWebGL(() => import('./scene'));
if (scene) scene.mount(canvas);
// otherwise keep the static image that is already on the page
```

With React (SSR-safe: `null` on the server and on the first client render, so hydration matches):

```tsx
import { useFastWebGL } from 'webgl-gate/react';

export function Hero() {
  const fast = useFastWebGL();
  return fast ? <LiveScene /> : <img src="/hero.avif" alt="" width={1200} height={630} />;
}
```

`LiveScene` should itself be lazy (`next/dynamic`, `React.lazy`), so its WebGL code stays in a separate chunk.

### API

| Export | What it does |
|---|---|
| `loadIfFastWebGL(load)` | Waits for an idle moment after `load`, then calls `load()` only on a real GPU. Returns the module or `null`. |
| `probeWebGLWhenIdle(timeout?)` | The verdict, `{ fast, reason, renderer }`, probed after `load` in `requestIdleCallback`. |
| `probeWebGL()` | The same verdict, synchronously. Memoized: one probe per page. On the server returns `fast: false` without caching. |
| `hasFastWebGL()` | `probeWebGL().fast`. |
| `isSoftwareRenderer(gl)`, `rendererName(gl)` | For a context you already have. |
| `SOFTWARE_RENDERER` | The regular expression: SwiftShader, llvmpipe, softpipe, "Software", "Basic Render". |
| `resetWebGLProbe()` | Forget the memoized verdict. |

`reason` is one of `gpu`, `software` (a context exists but the CPU draws it), `no-context` (WebGL is off or blocked,
or the browser reported a major performance caveat), `error`, `no-dom` (server).

## What it costs, measured

The same page in headless Chrome 155 on an Apple M2 Pro, three runs each:

| Renderer | Verdict | Probe time | Scene bundle requested |
|---|---|---|---|
| ANGLE Metal (Apple M2 Pro) | `gpu` | 10–24 ms | yes |
| ANGLE SwiftShader (`--use-angle=swiftshader`) | `software` | 1.41–1.73 s | **no** |

Read the second row carefully. On a CPU rasterizer, creating even one WebGL context is expensive, and that is
exactly where the answer is "no". That is why the default entry points wait for `load` and an idle callback
instead of probing during page load. If you call the synchronous `probeWebGL()` yourself, keep it off the critical
path too.

## Where it came from

This is the gate from [kutsikgames.com](https://kutsikgames.com), a game studio site with live PixiJS covers.
Together with inlined critical CSS and responsive AVIF covers, it took the site's mobile PageSpeed score from 78
(LCP 4.2 s) to 100 (LCP 1.7 s, TBT 0 ms). The gate is one of those changes, not all of them.

## When to use something else

`webgl-gate` answers "GPU or not". If you need to know *how strong* the GPU is, to pick quality tiers,
use [`detect-gpu`](https://github.com/pmndrs/detect-gpu): it classifies GPUs by benchmark scores and is much larger.

Browsers that hide the real renderer name (fingerprinting protection) may report a generic one,
so the gate sees a GPU. If that matters to you, time a real frame of your scene after mounting and fall back when
it is too slow.

## Not yet

The verdict is not cached across visits. A cached "software" answer can outlive the hardware it describes: the
user turns hardware acceleration back on, or a driver leaves a blocklist. Audit tools always start with a clean
profile anyway.

## License

MIT © Oleksandr Kutsenko
