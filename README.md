# offscreen-canvas

Run one canvas world in a worker on an `OffscreenCanvas`, or on the main thread when that transfer is not available. The world module is the same in both places.

## Install

Pin a commit. The package resolves `exports` from `dist/` in that commit.

```bash
pnpm add github:pavel-mazhuga/offscreen-canvas#<sha>
```

`<sha>` is the commit you want, for example the head of the pull request that added the library.

`three` stays in your app. This package does not import it. The React entry is optional: install `react` only if you import `offscreen-canvas/react`.

## Add a world to a Vite page

The world module must not touch `window` or `document`. Pass data in `props`. Pass callbacks by closing over them inside `createWorld`, on each side.

```ts
// world.ts
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { World, WorldContext } from 'offscreen-canvas';

export function createWorld(context: WorldContext): World {
  const renderer = new WebGLRenderer({ canvas: context.canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(context.dpr);
  renderer.setSize(Math.max(context.width, 1), Math.max(context.height, 1), false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, context.width / Math.max(context.height, 1), 0.1, 10);
  camera.position.z = 2;
  const geometry = new BoxGeometry(0.4, 0.4, 0.4);
  const material = new MeshBasicMaterial({ color: 0xffffff });
  scene.add(new Mesh(geometry, material));

  return {
    frame() {
      renderer.render(scene, camera);
    },
    resize(width, height, dpr) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
    },
    pointer(x, y) {
      camera.position.x = x;
      camera.position.y = y;
    },
    command(payload: unknown) {
      return payload;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
```

Keep the worker entry static. Vite only bundles a module as a worker when `new Worker(new URL(...), { type: 'module' })` is written at the call site.

```ts
// worker.ts
import { runCanvasWorker } from 'offscreen-canvas';
import { createWorld } from './world';

runCanvasWorker(createWorld);
```

```ts
// main.ts
import { attachCanvas } from 'offscreen-canvas';
import { createWorld } from './world';

const canvas = document.querySelector('canvas');

if (!canvas) {
  throw new Error('canvas missing');
}

const session = attachCanvas({
  canvas,
  createWorld,
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  onReady({ mode }) {
    console.log(mode); // 'worker' or 'main'
  },
});

session.send({ type: 'set-color', color: '#fff' });
const buffer = await session.request({ type: 'buffer-size' });
session.dispose();
```

`createWorld` handles `command(payload)` for `send` and `request`. `request` resolves with the return value. `send` does not wait. A payload passed before the worker is ready is delivered after `ready`, in order. Do not mutate that object while it is waiting.

Pointer moves, wheel deltas, and element resizes are folded into one message per frame. A hidden document flushes immediately and the worker stops its animation callback until the document is visible again. Wheel and keyboard listeners are off until you pass `wheel: true` or `keyboard: true`. `maxDpr` caps `devicePixelRatio` when you set it.

`mode: 'main'` skips the worker. `mode: 'auto'` is the default: transfer the canvas when `transferControlToOffscreen` exists, otherwise call `createWorld` on the main thread. If the worker cannot create a WebGL context, the session replaces the canvas element and runs the world on the main thread. `onCanvas` receives the replacement. `session.canvas` is the element currently on the page.

`dispose()` removes the listeners and the resize observer, stops the animation callback, calls `world.dispose()`, and terminates the worker after the worker has disposed its renderer. A second `dispose()` does nothing.

## Use it from Next.js

Load the session from a client component. The worker URL has to be written in that component so the bundler can see it. Do not call `attachCanvas` during render: the canvas is not in the document yet, and `window` is missing on the server.

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { attachCanvas } from 'offscreen-canvas';
import { createWorld } from './world';

export function Scene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;

    if (!canvas) {
      return;
    }

    const session = attachCanvas({
      canvas,
      createWorld,
      createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    });

    return () => {
      session.dispose();
    };
  }, []);

  return <canvas ref={ref} />;
}
```

`offscreen-canvas/react` exports `useOffscreenCanvas` and `OffscreenCanvas` for the same mount. Pass a stable `options` object, or the hook reads the first one and keeps it until unmount.

## Commands

From the package root:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run bench
```

`npm run demo` serves `examples/vite` at `http://127.0.0.1:4173`. `/?main=1` forces the main thread.
