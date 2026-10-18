// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetWebGLProbe } from '../src/index';
import { useFastWebGL } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Scene() {
  const fast = useFastWebGL();
  return <p>{fast === null ? 'pending' : fast ? 'live' : 'static'}</p>;
}

function stubRenderer(renderer: string) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    RENDERER: 0x1f01,
    getExtension: () => null,
    getParameter: () => renderer,
  })) as never);
}

async function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => { root.render(<Scene />); });
  // The probe waits for an idle moment (jsdom has no requestIdleCallback: a 1 ms timer).
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const text = host.textContent;
  root.unmount();
  return text;
}

afterEach(() => { vi.restoreAllMocks(); resetWebGLProbe(); });

describe('useFastWebGL', () => {
  it('renders the fallback on the server, so hydration matches', () => {
    expect(renderToString(<Scene />)).toContain('pending');
  });

  it('switches to the live scene on a real GPU', async () => {
    stubRenderer('Apple GPU');
    expect(await mount()).toBe('live');
  });

  it('stays static on SwiftShader', async () => {
    stubRenderer('Google SwiftShader');
    expect(await mount()).toBe('static');
  });
});
