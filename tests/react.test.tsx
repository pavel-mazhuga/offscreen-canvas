import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OffscreenCanvas, useOffscreenCanvas, type OffscreenOptions } from '../src/react';
import type { Session } from '../src/types';
import { createSpy, installClock, installMatchMedia } from './harness';

describe('react adapter', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.replaceChildren();
    installMatchMedia();
    installClock();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it('mounts a canvas and disposes the world on unmount', () => {
    const spy = createSpy();
    const sessionRef = { current: null as Session<unknown, unknown> | null };

    act(() => {
      root.render(
        createElement(OffscreenCanvas, {
          options: { createWorld: spy.createWorld, mode: 'main' },
          sessionRef,
        }),
      );
    });

    expect(host.querySelector('canvas')).not.toBeNull();
    expect(spy.contexts[0]?.isWorker).toBe(false);
    expect(sessionRef.current).not.toBeNull();

    act(() => {
      root.unmount();
    });

    expect(spy.disposed).toBe(1);
    expect(sessionRef.current).toBeNull();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('attaches through the hook and disposes on unmount', () => {
    const spy = createSpy();

    function Probe(props: { options: OffscreenOptions }) {
      const { ref } = useOffscreenCanvas(props.options);

      return createElement('canvas', { ref });
    }

    act(() => {
      root.render(createElement(Probe, { options: { createWorld: spy.createWorld, mode: 'main' } }));
    });

    expect(spy.contexts).toHaveLength(1);

    act(() => {
      root.unmount();
    });

    expect(spy.disposed).toBe(1);
  });
});
