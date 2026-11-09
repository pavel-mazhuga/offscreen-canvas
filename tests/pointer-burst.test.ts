import { afterEach, describe, expect, it } from 'vitest';
import { attachCanvas } from '../src/host';
import type { CreateWorld } from '../src/types';

const events = 1000;
const rounds = 5;

function createCanvas() {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 200, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 100, configurable: true });
  document.body.append(canvas);

  return canvas;
}

function dispatchMoves(canvas: HTMLCanvasElement) {
  for (let i = 0; i < events; i += 1) {
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: i, clientY: 2, buttons: 1, pointerId: 1 }));
  }
}

function runViki() {
  const canvas = createCanvas();
  const sent: { message: string; payload: { x: number; y: number }; transfer: Transferable[] }[] = [];
  let errors = 0;

  canvas.addEventListener('pointermove', (event) => {
    const payload = { x: event.clientX, y: event.clientY };
    sent.push({ message: 'setPointerPosition', payload, transfer: [] });
  });

  const elapsed = time(() => {
    try {
      dispatchMoves(canvas);
    } catch {
      errors += 1;
    }
  });

  canvas.remove();
  const last = sent.at(-1);

  return { posts: sent.length, lastX: last?.payload.x ?? -1, errors, elapsed };
}

function runEmpty() {
  const canvas = createCanvas();
  let seen = 0;
  canvas.addEventListener('pointermove', () => {
    seen += 1;
  });
  const elapsed = time(() => {
    dispatchMoves(canvas);
  });
  canvas.remove();

  return { seen, elapsed };
}

function runLibrary() {
  const queue: FrameRequestCallback[] = [];
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);

    return queue.length;
  };
  globalThis.cancelAnimationFrame = () => {
    queue.length = 0;
  };

  const canvas = createCanvas();
  const listeners = new Set<(event: { data: unknown }) => void>();
  let posts = 0;
  let lastX = -1;
  let errors = 0;

  const worker = {
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === 'message') {
        listeners.add(listener);
      }
    },
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void) {
      listeners.delete(listener);
    },
    terminate() {},
    postMessage(data: unknown) {
      if (typeof data !== 'object' || data === null || !('t' in data)) {
        return;
      }

      const tag = Object.getOwnPropertyDescriptor(data, 't')?.value;

      if (tag === 'init') {
        for (const listener of listeners) {
          listener({ data: { t: 'ready' } });
        }

        return;
      }

      if (tag === 'input') {
        const clone = structuredClone(data);
        posts += 1;

        if (typeof clone === 'object' && clone !== null && 'x' in clone && typeof clone.x === 'number') {
          lastX = clone.x;
        }
      }
    },
  };

  const createWorld: CreateWorld = () => ({
    dispose() {},
  });

  let elapsed = 0;

  try {
    attachCanvas({
      canvas,
      createWorld,
      createWorker: () => worker as unknown as Worker,
    });
    elapsed = time(() => {
      dispatchMoves(canvas);

      const batch = queue.splice(0, queue.length);

      for (const cb of batch) {
        cb(0);
      }
    });
  } catch {
    errors += 1;
  }

  globalThis.requestAnimationFrame = previousRaf;
  globalThis.cancelAnimationFrame = previousCancel;
  canvas.remove();

  return { posts, lastX, errors, elapsed };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1];
  const right = sorted[mid];

  if (sorted.length % 2 === 1) {
    return right ?? 0;
  }

  return ((left ?? 0) + (right ?? 0)) / 2;
}

function time(run: () => void): number {
  const start = performance.now();
  run();

  return performance.now() - start;
}

function summarize(samples: number[]) {
  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

describe('pointer burst', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('posts one input message for 1000 pointer moves', () => {
    runEmpty();
    runViki();
    runLibrary();

    const counts = { viki: runViki(), library: runLibrary() };
    const emptyMs: number[] = [];
    const vikiMs: number[] = [];
    const libraryMs: number[] = [];

    for (let i = 0; i < rounds; i += 1) {
      emptyMs.push(runEmpty().elapsed);
      vikiMs.push(runViki().elapsed);
      libraryMs.push(runLibrary().elapsed);
    }

    const report = {
      events,
      posts: { viki: counts.viki.posts, library: counts.library.posts },
      lastX: { viki: counts.viki.lastX, library: counts.library.lastX },
      errors: { viki: counts.viki.errors, library: counts.library.errors },
      ms: {
        rounds,
        emptyListener: summarize(emptyMs),
        viki: summarize(vikiMs),
        library: summarize(libraryMs),
      },
    };

    process.stdout.write(`BENCH ${JSON.stringify(report)}\n`);

    expect(counts.viki.errors).toBe(0);
    expect(counts.library.errors).toBe(0);
    expect(counts.viki.posts).toBe(events);
    expect(counts.library.posts).toBe(1);
    expect(counts.viki.lastX).toBe(events - 1);
    expect(counts.library.lastX).toBe(events - 1);
  });
});
