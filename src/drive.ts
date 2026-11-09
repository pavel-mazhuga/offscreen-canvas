import { applyBufferSize, type Drawable } from './buffer';
import type { InputMessage } from './protocol';
import type { World } from './types';

export type Surface = Drawable & {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

export type Driver = {
  apply(input: InputMessage): void;
  key(code: string, down: boolean): void;
  command(payload: unknown): unknown;
  dispose(): void;
};

export function driveWorld(
  world: World,
  canvas: Surface,
  options?: { visible?: boolean; onContextLost?: () => void },
): Driver {
  let visible = options?.visible !== false;
  let disposed = false;
  let raf = 0;

  const stop = () => {
    if (raf === 0) {
      return;
    }

    cancelAnimationFrame(raf);
    raf = 0;
  };

  const loop = (time: number) => {
    raf = 0;

    if (disposed || !visible) {
      return;
    }

    world.frame?.(time);

    if (disposed || !visible) {
      return;
    }

    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (disposed || !visible || raf !== 0) {
      return;
    }

    raf = requestAnimationFrame(loop);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();

    if (disposed) {
      return;
    }

    dispose();
    options?.onContextLost?.();
  };

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    stop();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    world.dispose();
  };

  canvas.addEventListener('webglcontextlost', onContextLost);

  if (!visible) {
    world.visibility?.(false);
  }

  start();

  return {
    apply(input) {
      if (disposed) {
        return;
      }

      if (input.hasSize) {
        applyBufferSize(canvas, input.width, input.height, input.dpr);
        world.resize?.(input.width, input.height, input.dpr);
      }

      if (input.hasPointer) {
        world.pointer?.(input.x, input.y, input.buttons, input.pointerId, input.edges);
      }

      if (input.hasWheel) {
        world.wheel?.(input.wheelX, input.wheelY);
      }

      if (input.hasVisible) {
        const next = input.visible === 1;

        if (next !== visible) {
          visible = next;
          world.visibility?.(next);

          if (next) {
            start();
          } else {
            stop();
          }
        }
      }
    },
    key(code, down) {
      if (disposed) {
        return;
      }

      world.key?.(code, down);
    },
    command(payload) {
      if (disposed) {
        return undefined;
      }

      return world.command?.(payload);
    },
    dispose,
  };
}
