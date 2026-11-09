export const PointerEdge = {
  down: 1,
  up: 2,
} as const;

export type WorldContext = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  isWorker: boolean;
  props: unknown;
};

export type World = {
  frame?: (time: number) => void;
  resize?: (width: number, height: number, dpr: number) => void;
  pointer?: (x: number, y: number, buttons: number, pointerId: number, edges: number) => void;
  wheel?: (dx: number, dy: number) => void;
  key?: (code: string, down: boolean) => void;
  visibility?: (visible: boolean) => void;
  command?: (payload: unknown) => unknown;
  dispose: () => void;
};

export type CreateWorld = (context: WorldContext) => World;

export type CanvasMode = 'auto' | 'worker' | 'main';

export type ReadyInfo = {
  mode: 'worker' | 'main';
  canvas: HTMLCanvasElement;
};

export type AttachOptions = {
  canvas: HTMLCanvasElement;
  createWorld: CreateWorld;
  createWorker?: () => Worker;
  mode?: CanvasMode;
  props?: unknown;
  maxDpr?: number;
  wheel?: boolean;
  preventWheel?: boolean;
  keyboard?: boolean;
  onReady?: (info: ReadyInfo) => void;
  onCanvas?: (canvas: HTMLCanvasElement) => void;
};

export type Session<Req, Res> = {
  send(payload: Req, transfer?: Transferable[]): void;
  request(payload: Req, transfer?: Transferable[]): Promise<Res>;
  dispose(): void;
  readonly canvas: HTMLCanvasElement;
};
