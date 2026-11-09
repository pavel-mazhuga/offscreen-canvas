import { vi } from 'vitest';
import { runCanvasWorker, type WorkerScope } from '../src/worker';
import type { CreateWorld, WorldContext } from '../src/types';

export class TestOffscreen extends EventTarget {
  width: number;
  height: number;
  contexts = 0;

  constructor(width = 1, height = 1) {
    super();
    this.width = width;
    this.height = height;
  }

  getContext(kind: string): { getExtension: () => { loseContext: () => void } } | null {
    if (kind !== 'webgl2' && kind !== 'webgl') {
      return null;
    }

    this.contexts += 1;

    return {
      getExtension: () => ({
        loseContext: () => undefined,
      }),
    };
  }
}

export class DeadOffscreen extends EventTarget {
  width = 1;
  height = 1;

  getContext(): null {
    return null;
  }
}

type QueuedFrame = {
  id: number;
  cb: FrameRequestCallback;
};

export function installClock() {
  const queue: QueuedFrame[] = [];
  let next = 1;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = next;
    next += 1;
    queue.push({ id, cb });

    return id;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const index = queue.findIndex((entry) => entry.id === id);

    if (index >= 0) {
      queue.splice(index, 1);
    }
  });

  return {
    pending() {
      return queue.length;
    },
    flush(times = 1) {
      for (let i = 0; i < times; i += 1) {
        const batch = queue.splice(0, queue.length);

        for (const entry of batch) {
          entry.cb(16);
        }
      }
    },
  };
}

export class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  disconnected = false;
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let dprListener: ((event: Event) => void) | null = null;

export function installMatchMedia() {
  dprListener = null;

  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener(_type: string, listener: (event: Event) => void) {
      dprListener = listener;
    },
    removeEventListener(_type: string, listener: (event: Event) => void) {
      if (dprListener === listener) {
        dprListener = null;
      }
    },
  }));
}

export function fireDprChange() {
  dprListener?.(new Event('change'));
}

export function installOffscreen(ctor: typeof TestOffscreen | typeof DeadOffscreen = TestOffscreen) {
  vi.stubGlobal('OffscreenCanvas', ctor);
}

export function makeCanvas(width = 100, height = 50): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });

  const transfer = () => new OffscreenCanvas(width, height);
  Object.defineProperty(canvas, 'transferControlToOffscreen', { value: transfer, configurable: true });

  document.body.append(canvas);

  return canvas;
}

export function setClientSize(canvas: HTMLCanvasElement, width: number, height: number) {
  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
}

export class FakeWorker {
  terminated = 0;
  messages: unknown[] = [];
  transfers: Transferable[][] = [];
  peer: ((data: unknown, transfer?: Transferable[]) => void) | null = null;
  private messageListeners = new Set<(event: MessageEvent) => void>();
  private errorListeners = new Set<() => void>();

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
    }

    if (type === 'error') {
      this.errorListeners.add(listener as () => void);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
    }

    if (type === 'error') {
      this.errorListeners.delete(listener as () => void);
    }
  }

  postMessage(data: unknown, transfer?: Transferable[]): void {
    this.messages.push(snapshotMessage(data));
    this.transfers.push(transfer ?? []);
    this.peer?.(data, transfer);
  }

  terminate(): void {
    this.terminated += 1;
  }

  emit(data: unknown): void {
    const event = { data } as MessageEvent;

    for (const listener of this.messageListeners) {
      listener(event);
    }
  }

  fail(): void {
    for (const listener of this.errorListeners) {
      listener();
    }
  }
}

function snapshotMessage(data: unknown): unknown {
  if (typeof data === 'object' && data !== null && 't' in data) {
    const tag = Object.getOwnPropertyDescriptor(data, 't')?.value;

    if (tag === 'input' || tag === 'key' || tag === 'rpc') {
      return structuredClone(data);
    }
  }

  return data;
}

export function messageTag(message: unknown): string | null {
  if (typeof message !== 'object' || message === null || !('t' in message)) {
    return null;
  }

  const tag = Object.getOwnPropertyDescriptor(message, 't')?.value;

  return typeof tag === 'string' ? tag : null;
}

export type Spy = {
  contexts: WorldContext[];
  pointers: number[][];
  resizes: number[][];
  wheels: number[][];
  keys: { code: string; down: boolean }[];
  visible: boolean[];
  frames: number;
  disposed: number;
  commands: unknown[];
  createWorld: CreateWorld;
};

export function createSpy(): Spy {
  const spy: Spy = {
    contexts: [],
    pointers: [],
    resizes: [],
    wheels: [],
    keys: [],
    visible: [],
    frames: 0,
    disposed: 0,
    commands: [],
    createWorld: () => {
      throw new Error('replaced');
    },
  };

  spy.createWorld = (context) => {
    spy.contexts.push(context);

    return {
      frame() {
        spy.frames += 1;
      },
      resize(width, height, dpr) {
        spy.resizes.push([width, height, dpr]);
      },
      pointer(x, y, buttons, pointerId, edges) {
        spy.pointers.push([x, y, buttons, pointerId, edges]);
      },
      wheel(dx, dy) {
        spy.wheels.push([dx, dy]);
      },
      key(code, down) {
        spy.keys.push({ code, down });
      },
      visibility(visible) {
        spy.visible.push(visible);
      },
      command(payload) {
        spy.commands.push(payload);

        return { echo: payload };
      },
      dispose() {
        spy.disposed += 1;
      },
    };
  };

  return spy;
}

export function connect(worker: FakeWorker, createWorld: CreateWorld): { closed: () => boolean } {
  let closed = false;
  const scope: WorkerScope = {
    postMessage(message) {
      worker.emit(message);
    },
    onmessage: null,
    close() {
      closed = true;
    },
  };

  worker.peer = (data) => {
    scope.onmessage?.({ data } as MessageEvent);
  };

  runCanvasWorker(createWorld, scope);

  return {
    closed: () => closed,
  };
}
