import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachCanvas } from '../src/host';
import { PointerEdge } from '../src/types';
import { runCanvasWorker, type WorkerScope } from '../src/worker';
import {
  DeadOffscreen,
  FakeWorker,
  RecordingResizeObserver,
  TestOffscreen,
  connect,
  createSpy,
  fireDprChange,
  installClock,
  installMatchMedia,
  installOffscreen,
  makeCanvas,
  messageTag,
  setClientSize,
} from './harness';

describe('canvas session', () => {
  let clock: ReturnType<typeof installClock>;

  beforeEach(() => {
    document.body.replaceChildren();
    RecordingResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
    installOffscreen();
    installMatchMedia();
    clock = installClock();
    window.devicePixelRatio = 1;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends init on a transferred canvas and runs the world in the worker', () => {
    const canvas = makeCanvas(120, 40);
    const worker = new FakeWorker();
    const spy = createSpy();
    const modes: string[] = [];
    connect(worker, spy.createWorld);

    const session = attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
      props: { hue: 2 },
      onReady(info) {
        modes.push(info.mode);
      },
    });

    expect(modes).toEqual(['worker']);
    expect(spy.contexts).toHaveLength(1);
    expect(spy.contexts[0]?.isWorker).toBe(true);
    expect(spy.contexts[0]?.props).toEqual({ hue: 2 });
    expect(spy.contexts[0]?.width).toBe(120);
    expect(spy.contexts[0]?.height).toBe(40);
    expect(messageTag(worker.messages[0])).toBe('init');
    expect(worker.transfers[0]?.[0]).toBeInstanceOf(TestOffscreen);
    expect((worker.transfers[0]?.[0] as TestOffscreen).width).toBe(120);
    expect(session.canvas).toBe(canvas);
  });

  it('coalesces 1000 pointer moves into one message per frame', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    for (let i = 0; i < 1000; i += 1) {
      canvas.dispatchEvent(
        new PointerEvent('pointermove', { clientX: i, clientY: 4, buttons: 1, pointerId: 7 }),
      );
    }

    expect(worker.messages.filter((message) => messageTag(message) === 'input')).toHaveLength(0);

    clock.flush();

    const inputs = worker.messages.filter((message) => messageTag(message) === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ x: 999, y: 4, buttons: 1, pointerId: 7, hasPointer: 1 });
    expect(spy.pointers).toEqual([[999, 4, 1, 7, 0]]);
  });

  it('keeps pointer down and up that land in the same frame', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 2, buttons: 1, pointerId: 3 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 8, clientY: 9, buttons: 0, pointerId: 3 }));
    clock.flush();

    expect(spy.pointers).toEqual([[8, 9, 0, 3, PointerEdge.down | PointerEdge.up]]);
  });

  it('holds input until the worker is ready, then sends the latest sample once', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();

    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    for (let i = 0; i < 1000; i += 1) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: i, clientY: 1, buttons: 0, pointerId: 1 }));
    }

    expect(worker.messages.filter((message) => messageTag(message) === 'input')).toHaveLength(0);

    worker.emit({ t: 'ready' });

    const inputs = worker.messages.filter((message) => messageTag(message) === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ x: 999, y: 1, hasPointer: 1 });
  });

  it('sums wheel deltas from the same frame', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
      wheel: true,
      preventWheel: true,
    });

    const first = new WheelEvent('wheel', { deltaX: 1, deltaY: 2, cancelable: true });
    const second = new WheelEvent('wheel', { deltaX: 4, deltaY: -1, cancelable: true });
    canvas.dispatchEvent(first);
    canvas.dispatchEvent(second);
    expect(first.defaultPrevented).toBe(true);
    clock.flush();

    expect(spy.wheels).toEqual([[5, 1]]);
  });

  it('resizes the drawing buffer from element size and devicePixelRatio', () => {
    const canvas = makeCanvas(100, 50);
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    const surface = worker.transfers[0]?.[0] as TestOffscreen;
    expect(surface.width).toBe(100);
    expect(surface.height).toBe(50);

    setClientSize(canvas, 80, 40);
    RecordingResizeObserver.instances[0]?.fire();
    clock.flush();

    expect(surface.width).toBe(80);
    expect(surface.height).toBe(40);
    expect(spy.resizes.at(-1)).toEqual([80, 40, 1]);

    window.devicePixelRatio = 2;
    fireDprChange();
    clock.flush();

    expect(surface.width).toBe(160);
    expect(surface.height).toBe(80);
    expect(spy.resizes.at(-1)).toEqual([80, 40, 2]);
  });

  it('caps devicePixelRatio when maxDpr is set', () => {
    window.devicePixelRatio = 3;
    const canvas = makeCanvas(10, 10);
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
      maxDpr: 2,
    });

    expect(spy.contexts[0]?.dpr).toBe(2);
    expect((worker.transfers[0]?.[0] as TestOffscreen).width).toBe(20);
  });

  it('pauses the worker frame loop when the document is hidden', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    connect(worker, spy.createWorld);
    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    clock.flush();
    expect(spy.frames).toBe(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(spy.visible).toEqual([false]);
    expect(worker.messages.filter((message) => messageTag(message) === 'input').length).toBeGreaterThan(0);
    clock.flush();
    expect(spy.frames).toBe(1);
  });

  it('resolves request with the world result and rejects after dispose', async () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    const link = connect(worker, spy.createWorld);
    const session = attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
      keyboard: true,
    });

    await expect(session.request({ type: 'ping' })).resolves.toEqual({ echo: { type: 'ping' } });

    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(spy.keys).toEqual([{ code: 'KeyW', down: true }]);

    session.dispose();
    expect(spy.disposed).toBe(1);
    expect(worker.terminated).toBe(1);
    expect(link.closed()).toBe(true);
    expect(RecordingResizeObserver.instances[0]?.disconnected).toBe(true);

    session.dispose();
    expect(spy.disposed).toBe(1);
    expect(worker.terminated).toBe(1);

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 }));
    clock.flush();
    expect(spy.pointers).toHaveLength(0);

    await expect(session.request({ type: 'ping' })).rejects.toThrow('disposed');
  });

  it('queues rpc until ready', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    const session = attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    const queued = session.request({ n: 1 });
    void queued.catch(() => undefined);
    expect(worker.messages.filter((message) => messageTag(message) === 'rpc')).toHaveLength(0);

    worker.emit({ t: 'ready' });

    const rpcs = worker.messages.filter((message) => messageTag(message) === 'rpc');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toMatchObject({ payload: { n: 1 } });
    session.dispose();
  });

  it('runs the same world on the main thread when transfer is unavailable', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 30, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 16, configurable: true });
    Object.defineProperty(canvas, 'transferControlToOffscreen', { value: undefined, configurable: true });
    document.body.append(canvas);
    const spy = createSpy();
    let workers = 0;
    const modes: string[] = [];

    const session = attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => {
        workers += 1;
        throw new Error('worker should not start');
      },
      onReady(info) {
        modes.push(info.mode);
      },
    });

    expect(workers).toBe(0);
    expect(modes).toEqual(['main']);
    expect(spy.contexts[0]?.isWorker).toBe(false);
    expect(spy.contexts[0]?.width).toBe(30);

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 6, clientY: 7, buttons: 0, pointerId: 1 }));
    clock.flush();
    expect(spy.pointers).toEqual([[6, 7, 0, 1, 0]]);
    expect(spy.frames).toBe(1);

    session.dispose();
    expect(spy.disposed).toBe(1);
    clock.flush();
    expect(spy.frames).toBe(1);
    session.dispose();
    expect(spy.disposed).toBe(1);
  });

  it('stays on the main thread when mode is main', () => {
    const canvas = makeCanvas();
    const spy = createSpy();
    let workers = 0;

    attachCanvas({
      canvas,
      mode: 'main',
      createWorld: spy.createWorld,
      createWorker: () => {
        workers += 1;

        return new FakeWorker() as unknown as Worker;
      },
    });

    expect(workers).toBe(0);
    expect(spy.contexts[0]?.isWorker).toBe(false);
  });

  it('replaces the canvas and runs the world on the main thread when the worker cannot create WebGL', () => {
    installOffscreen(DeadOffscreen);
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();
    const modes: string[] = [];
    connect(worker, spy.createWorld);

    const session = attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
      onReady(info) {
        modes.push(info.mode);
      },
    });

    expect(modes).toEqual(['main']);
    expect(spy.contexts).toHaveLength(1);
    expect(spy.contexts[0]?.isWorker).toBe(false);
    expect(session.canvas).not.toBe(canvas);
    expect(canvas.isConnected).toBe(false);
    expect(session.canvas.isConnected).toBe(true);
    expect(worker.terminated).toBe(1);
  });

  it('falls back when the worker reports an error', () => {
    const canvas = makeCanvas();
    const worker = new FakeWorker();
    const spy = createSpy();

    attachCanvas({
      canvas,
      createWorld: spy.createWorld,
      createWorker: () => worker as unknown as Worker,
    });

    worker.fail();

    expect(spy.contexts[0]?.isWorker).toBe(false);
    expect(worker.terminated).toBe(1);
  });

  it('ignores malformed worker messages and refuses init without a canvas', () => {
    const spy = createSpy();
    const posted: unknown[] = [];
    const scope: WorkerScope = {
      postMessage(message) {
        posted.push(message);
      },
      onmessage: null,
    };
    runCanvasWorker(spy.createWorld, scope);

    scope.onmessage?.({ data: { t: 'nope' } } as MessageEvent);
    scope.onmessage?.({ data: { t: 'init', width: 1, height: 1, dpr: 1, visible: 1 } } as MessageEvent);
    scope.onmessage?.({ data: null } as MessageEvent);

    expect(spy.contexts).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});
