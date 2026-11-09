import { driveWorld, type Driver } from './drive';
import { createInputMessage, errorText, isPromise, readWorkerMessage } from './protocol';
import { PointerEdge, type AttachOptions, type Session, type World } from './types';

type Phase =
  | { kind: 'worker-pending'; worker: Worker }
  | { kind: 'worker'; worker: Worker }
  | { kind: 'main'; driver: Driver }
  | { kind: 'closing'; worker: Worker }
  | { kind: 'disposed' };

type PendingRpc = {
  id: number;
  payload: unknown;
  transfer: Transferable[] | null;
};

type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function canTransfer(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.transferControlToOffscreen === 'function';
}

function releaseTransfer(transfer: Transferable[] | null): void {
  if (!transfer) {
    return;
  }

  for (const item of transfer) {
    if (typeof VideoFrame !== 'undefined' && item instanceof VideoFrame) {
      item.close();
    }
  }
}

function holdPayload(payload: unknown, transfer: Transferable[] | null): unknown {
  if (transfer && transfer.length > 0) {
    return payload;
  }

  try {
    return structuredClone(payload);
  } catch {
    return payload;
  }
}

function replaceCanvas(current: HTMLCanvasElement): HTMLCanvasElement {
  const next = document.createElement('canvas');

  for (const attr of current.attributes) {
    if (attr.name === 'width' || attr.name === 'height') {
      continue;
    }

    next.setAttribute(attr.name, attr.value);
  }

  current.replaceWith(next);

  return next;
}

function watchDpr(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  let media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);

  const onMedia = () => {
    media.removeEventListener('change', onMedia);
    media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    media.addEventListener('change', onMedia);
    onChange();
  };

  media.addEventListener('change', onMedia);

  return () => {
    media.removeEventListener('change', onMedia);
  };
}

export function attachCanvas<Req = unknown, Res = unknown>(options: AttachOptions): Session<Req, Res> {
  let currentCanvas = options.canvas;
  let phase: Phase = { kind: 'disposed' };
  let usedFallback = false;
  let inputDirty = false;
  let flushScheduled = false;
  let flushHandle = 0;
  let clientX = 0;
  let clientY = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 1;
  let nextId = 1;

  const inputMsg = createInputMessage();
  const pending = new Map<number, Waiter>();
  const rpcQueue: PendingRpc[] = [];
  const keyQueue: { code: string; down: number }[] = [];
  const keyMsg = { t: 'key' as const, code: '', down: 0 };
  const wheelOptions: AddEventListenerOptions = { passive: options.preventWheel !== true };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => noteSize()) : null;

  const currentDpr = () => {
    const raw = window.devicePixelRatio || 1;

    if (options.maxDpr === undefined) {
      return raw;
    }

    return Math.min(raw, options.maxDpr);
  };

  const readSize = () => {
    lastWidth = currentCanvas.clientWidth;
    lastHeight = currentCanvas.clientHeight;
    lastDpr = currentDpr();
  };

  function noteSize() {
    const width = currentCanvas.clientWidth;
    const height = currentCanvas.clientHeight;
    const dpr = currentDpr();

    if (width === lastWidth && height === lastHeight && dpr === lastDpr) {
      return;
    }

    lastWidth = width;
    lastHeight = height;
    lastDpr = dpr;
    inputMsg.width = width;
    inputMsg.height = height;
    inputMsg.dpr = dpr;
    inputMsg.hasSize = 1;
    markInput();
  }

  function cancelFlush() {
    if (flushHandle !== 0) {
      cancelAnimationFrame(flushHandle);
      flushHandle = 0;
    }

    flushScheduled = false;
  }

  function schedule() {
    if (flushScheduled) {
      return;
    }

    if (typeof requestAnimationFrame !== 'function') {
      flushInput();

      return;
    }

    flushScheduled = true;
    flushHandle = requestAnimationFrame(() => {
      flushHandle = 0;
      flushScheduled = false;
      flushInput();
    });
  }

  function markInput() {
    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      return;
    }

    inputDirty = true;

    if (phase.kind === 'worker-pending') {
      return;
    }

    if (document.visibilityState === 'hidden') {
      cancelFlush();
      flushInput();

      return;
    }

    schedule();
  }

  function flushInput() {
    if (!inputDirty) {
      return;
    }

    if (phase.kind === 'worker-pending') {
      return;
    }

    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      inputDirty = false;

      return;
    }

    if (inputMsg.hasPointer) {
      const rect = currentCanvas.getBoundingClientRect();
      inputMsg.x = clientX - rect.left;
      inputMsg.y = clientY - rect.top;
    }

    if (phase.kind === 'worker') {
      phase.worker.postMessage(inputMsg);
    } else {
      phase.driver.apply(inputMsg);
    }

    inputDirty = false;
    inputMsg.hasPointer = 0;
    inputMsg.edges = 0;
    inputMsg.hasSize = 0;
    inputMsg.hasVisible = 0;
    inputMsg.hasWheel = 0;
    inputMsg.wheelX = 0;
    inputMsg.wheelY = 0;
  }

  function rejectOne(id: number, error: Error) {
    const waiter = pending.get(id);

    if (!waiter) {
      return;
    }

    pending.delete(id);
    waiter.reject(error);
  }

  function resolveOne(id: number, value: unknown) {
    const waiter = pending.get(id);

    if (!waiter) {
      return;
    }

    pending.delete(id);
    waiter.resolve(value);
  }

  function rejectAll(error: Error) {
    for (const id of pending.keys()) {
      rejectOne(id, error);
    }
  }

  function settleMain(driver: Driver, id: number, payload: unknown) {
    let result: unknown;

    try {
      result = driver.command(payload);
    } catch (error) {
      if (id !== 0) {
        rejectOne(id, new Error(errorText(error)));
      }

      return;
    }

    if (id === 0) {
      if (isPromise(result)) {
        void result.catch(() => undefined);
      }

      return;
    }

    Promise.resolve(result).then(
      (value) => {
        resolveOne(id, value);
      },
      (error: unknown) => {
        rejectOne(id, new Error(errorText(error)));
      },
    );
  }

  function postRpc(id: number, payload: unknown, transfer: Transferable[] | null) {
    const message = { t: 'rpc' as const, id, payload };

    if (phase.kind !== 'worker') {
      return;
    }

    if (transfer && transfer.length > 0) {
      phase.worker.postMessage(message, transfer);

      return;
    }

    phase.worker.postMessage(message);
  }

  function enqueueOrSendRpc(id: number, payload: unknown, transfer: Transferable[] | null) {
    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      releaseTransfer(transfer);

      if (id !== 0) {
        rejectOne(id, new Error('disposed'));
      }

      return;
    }

    if (phase.kind === 'worker-pending') {
      rpcQueue.push({ id, payload: holdPayload(payload, transfer), transfer });

      return;
    }

    if (phase.kind === 'worker') {
      postRpc(id, payload, transfer);

      return;
    }

    settleMain(phase.driver, id, payload);
  }

  function postKey(code: string, down: number) {
    if (phase.kind !== 'worker') {
      return;
    }

    keyMsg.code = code;
    keyMsg.down = down;
    phase.worker.postMessage(keyMsg);
  }

  function flushQueues() {
    const keys = keyQueue.splice(0);
    const rpcs = rpcQueue.splice(0);

    for (const key of keys) {
      if (phase.kind === 'worker') {
        postKey(key.code, key.down);
      } else if (phase.kind === 'main') {
        phase.driver.key(key.code, key.down === 1);
      }
    }

    for (const rpc of rpcs) {
      if (phase.kind === 'worker') {
        postRpc(rpc.id, rpc.payload, rpc.transfer);
      } else if (phase.kind === 'main') {
        settleMain(phase.driver, rpc.id, rpc.payload);
      } else {
        releaseTransfer(rpc.transfer);

        if (rpc.id !== 0) {
          rejectOne(rpc.id, new Error('disposed'));
        }
      }
    }

    flushInput();
  }

  function requireWorld(value: World): World {
    if (typeof value.dispose !== 'function') {
      throw new Error('createWorld must return an object with dispose()');
    }

    return value;
  }

  function startMain(canvas: HTMLCanvasElement) {
    const world = requireWorld(
      options.createWorld({
        canvas,
        width: lastWidth,
        height: lastHeight,
        dpr: lastDpr,
        isWorker: false,
        props: options.props ?? null,
      }),
    );
    const driver = driveWorld(world, canvas);
    phase = { kind: 'main', driver };
    flushQueues();
    options.onReady?.({ mode: 'main', canvas });
  }

  function detachWorker(worker: Worker) {
    worker.removeEventListener('message', onWorkerMessage);
    worker.removeEventListener('error', onWorkerError);
  }

  function fallbackFromWorker(worker: Worker) {
    detachWorker(worker);
    worker.terminate();

    if (usedFallback) {
      phase = { kind: 'disposed' };

      return;
    }

    usedFallback = true;
    unbindCanvas(currentCanvas);
    const next = replaceCanvas(currentCanvas);
    currentCanvas = next;
    bindCanvas(next);
    readSize();
    options.onCanvas?.(next);
    startMain(next);
  }

  function onWorkerMessage(event: MessageEvent) {
    const message = readWorkerMessage(event.data);

    if (!message) {
      return;
    }

    if (message.t === 'ready') {
      if (phase.kind !== 'worker-pending') {
        return;
      }

      phase = { kind: 'worker', worker: phase.worker };
      flushQueues();
      options.onReady?.({ mode: 'worker', canvas: currentCanvas });

      return;
    }

    if (message.t === 'gl-error') {
      if (phase.kind !== 'worker-pending' && phase.kind !== 'worker') {
        return;
      }

      fallbackFromWorker(phase.worker);

      return;
    }

    if (message.t === 'disposed') {
      if (phase.kind !== 'closing') {
        return;
      }

      const worker = phase.worker;
      detachWorker(worker);
      worker.terminate();
      phase = { kind: 'disposed' };

      return;
    }

    const waiter = pending.get(message.id);

    if (!waiter) {
      return;
    }

    pending.delete(message.id);

    if (message.ok) {
      waiter.resolve(message.value);

      return;
    }

    waiter.reject(new Error(typeof message.value === 'string' ? message.value : 'command failed'));
  }

  function onWorkerError() {
    if (phase.kind === 'worker-pending' || phase.kind === 'worker') {
      fallbackFromWorker(phase.worker);

      return;
    }

    if (phase.kind === 'closing') {
      phase.worker.terminate();
      phase = { kind: 'disposed' };
    }
  }

  function writePointer(event: PointerEvent, edge: number) {
    clientX = event.clientX;
    clientY = event.clientY;
    inputMsg.buttons = event.buttons;
    inputMsg.pointerId = event.pointerId;
    inputMsg.edges |= edge;
    inputMsg.hasPointer = 1;
    markInput();
  }

  function onPointerDown(event: PointerEvent) {
    try {
      currentCanvas.setPointerCapture(event.pointerId);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
        throw error;
      }
    }

    writePointer(event, PointerEdge.down);
  }

  function onPointerMove(event: PointerEvent) {
    writePointer(event, 0);
  }

  function onPointerUp(event: PointerEvent) {
    if (currentCanvas.hasPointerCapture?.(event.pointerId)) {
      currentCanvas.releasePointerCapture(event.pointerId);
    }

    writePointer(event, PointerEdge.up);
  }

  function onWheel(event: WheelEvent) {
    if (options.preventWheel === true) {
      event.preventDefault();
    }

    inputMsg.wheelX += event.deltaX;
    inputMsg.wheelY += event.deltaY;
    inputMsg.hasWheel = 1;
    markInput();
  }

  function onKey(event: KeyboardEvent, down: number) {
    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      return;
    }

    if (phase.kind === 'worker-pending') {
      keyQueue.push({ code: event.code, down });

      return;
    }

    if (phase.kind === 'worker') {
      postKey(event.code, down);

      return;
    }

    phase.driver.key(event.code, down === 1);
  }

  function onKeyDown(event: KeyboardEvent) {
    onKey(event, 1);
  }

  function onKeyUp(event: KeyboardEvent) {
    onKey(event, 0);
  }

  function onVisibility() {
    inputMsg.visible = document.visibilityState === 'visible' ? 1 : 0;
    inputMsg.hasVisible = 1;
    inputDirty = true;

    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      inputDirty = false;

      return;
    }

    if (inputMsg.visible === 0) {
      cancelFlush();
      flushInput();

      return;
    }

    if (phase.kind === 'worker-pending') {
      return;
    }

    schedule();
  }

  function onWindowResize() {
    noteSize();
  }

  function bindCanvas(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    if (options.wheel === true) {
      canvas.addEventListener('wheel', onWheel, wheelOptions);
    }

    if (options.keyboard === true) {
      if (canvas.tabIndex < 0) {
        canvas.tabIndex = 0;
      }

      canvas.addEventListener('keydown', onKeyDown);
      canvas.addEventListener('keyup', onKeyUp);
    }

    resizeObserver?.observe(canvas);
  }

  function unbindCanvas(canvas: HTMLCanvasElement) {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);

    if (options.wheel === true) {
      canvas.removeEventListener('wheel', onWheel);
    }

    if (options.keyboard === true) {
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('keyup', onKeyUp);
    }

    resizeObserver?.unobserve(canvas);
  }

  function dispose() {
    if (phase.kind === 'disposed' || phase.kind === 'closing') {
      return;
    }

    unbindCanvas(currentCanvas);
    resizeObserver?.disconnect();
    stopDpr();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onWindowResize);
    cancelFlush();
    inputDirty = false;

    for (const rpc of rpcQueue) {
      releaseTransfer(rpc.transfer);
    }

    rpcQueue.length = 0;
    keyQueue.length = 0;
    rejectAll(new Error('disposed'));

    if (phase.kind === 'main') {
      phase.driver.dispose();
      phase = { kind: 'disposed' };

      return;
    }

    const worker = phase.worker;
    phase = { kind: 'closing', worker };
    worker.postMessage({ t: 'dispose' });
  }

  function start() {
    readSize();
    const createWorker = options.createWorker;

    if (options.mode === 'main' || createWorker === undefined || !canTransfer(currentCanvas)) {
      startMain(currentCanvas);

      return;
    }

    const worker = createWorker();
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', onWorkerError);

    let offscreen: OffscreenCanvas;

    try {
      offscreen = currentCanvas.transferControlToOffscreen();
    } catch {
      detachWorker(worker);
      worker.terminate();
      startMain(currentCanvas);

      return;
    }

    phase = { kind: 'worker-pending', worker };
    const init = {
      t: 'init' as const,
      canvas: offscreen,
      width: lastWidth,
      height: lastHeight,
      dpr: lastDpr,
      visible: document.visibilityState === 'visible' ? 1 : 0,
      props: options.props ?? null,
    };

    try {
      worker.postMessage(init, [offscreen]);
    } catch {
      fallbackFromWorker(worker);
    }
  }

  const stopDpr = watchDpr(() => {
    noteSize();
  });

  bindCanvas(currentCanvas);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onWindowResize);
  start();

  return {
    send(payload, transfer) {
      enqueueOrSendRpc(0, payload, transfer ?? null);
    },
    request(payload, transfer) {
      const id = nextId;
      nextId += 1;
      const promise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      enqueueOrSendRpc(id, payload, transfer ?? null);

      return promise as Promise<Res>;
    },
    dispose,
    get canvas() {
      return currentCanvas;
    },
  };
}
