export type InputMessage = {
  t: 'input';
  hasPointer: number;
  x: number;
  y: number;
  buttons: number;
  pointerId: number;
  edges: number;
  hasSize: number;
  width: number;
  height: number;
  dpr: number;
  hasVisible: number;
  visible: number;
  hasWheel: number;
  wheelX: number;
  wheelY: number;
};

export type InitMessage = {
  t: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  visible: number;
  props: unknown;
};

export type RpcMessage = {
  t: 'rpc';
  id: number;
  payload: unknown;
};

export type KeyMessage = {
  t: 'key';
  code: string;
  down: number;
};

export type DisposeMessage = {
  t: 'dispose';
};

export type MainToWorker = InitMessage | InputMessage | RpcMessage | KeyMessage | DisposeMessage;

export type WorkerToMain =
  | { t: 'ready' }
  | { t: 'gl-error' }
  | { t: 'disposed' }
  | { t: 'rpc-result'; id: number; ok: boolean; value: unknown };

export function createInputMessage(): InputMessage {
  return {
    t: 'input',
    hasPointer: 0,
    x: 0,
    y: 0,
    buttons: 0,
    pointerId: 0,
    edges: 0,
    hasSize: 0,
    width: 0,
    height: 0,
    dpr: 1,
    hasVisible: 0,
    visible: 1,
    hasWheel: 0,
    wheelX: 0,
    wheelY: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInputMessage(value: Record<string, unknown>): value is InputMessage {
  return (
    value.t === 'input' &&
    isFiniteNumber(value.hasPointer) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.buttons) &&
    isFiniteNumber(value.pointerId) &&
    isFiniteNumber(value.edges) &&
    isFiniteNumber(value.hasSize) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.dpr) &&
    isFiniteNumber(value.hasVisible) &&
    isFiniteNumber(value.visible) &&
    isFiniteNumber(value.hasWheel) &&
    isFiniteNumber(value.wheelX) &&
    isFiniteNumber(value.wheelY)
  );
}

function readInit(value: Record<string, unknown>): InitMessage | null {
  const canvas = value.canvas;
  if (typeof OffscreenCanvas === 'undefined' || !(canvas instanceof OffscreenCanvas)) {
    return null;
  }

  if (
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.dpr) ||
    !isFiniteNumber(value.visible)
  ) {
    return null;
  }

  return {
    t: 'init',
    canvas,
    width: value.width,
    height: value.height,
    dpr: value.dpr,
    visible: value.visible,
    props: value.props,
  };
}

export function readMainMessage(value: unknown): MainToWorker | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.t === 'dispose') {
    return { t: 'dispose' };
  }

  if (value.t === 'init') {
    return readInit(value);
  }

  if (value.t === 'input') {
    return isInputMessage(value) ? value : null;
  }

  if (value.t === 'key') {
    if (typeof value.code !== 'string' || !isFiniteNumber(value.down)) {
      return null;
    }

    return { t: 'key', code: value.code, down: value.down };
  }

  if (value.t === 'rpc') {
    if (!isFiniteNumber(value.id)) {
      return null;
    }

    return { t: 'rpc', id: value.id, payload: value.payload };
  }

  return null;
}

export function readWorkerMessage(value: unknown): WorkerToMain | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.t === 'ready') {
    return { t: 'ready' };
  }

  if (value.t === 'gl-error') {
    return { t: 'gl-error' };
  }

  if (value.t === 'disposed') {
    return { t: 'disposed' };
  }

  if (value.t === 'rpc-result') {
    if (!isFiniteNumber(value.id) || typeof value.ok !== 'boolean') {
      return null;
    }

    return { t: 'rpc-result', id: value.id, ok: value.ok, value: value.value };
  }

  return null;
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'command failed';
}

export function isPromise(value: unknown): value is Promise<unknown> {
  if (typeof value !== 'object' || value === null || !('then' in value)) {
    return false;
  }

  return typeof value.then === 'function';
}
