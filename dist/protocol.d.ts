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
export type WorkerToMain = {
    t: 'ready';
} | {
    t: 'gl-error';
} | {
    t: 'disposed';
} | {
    t: 'rpc-result';
    id: number;
    ok: boolean;
    value: unknown;
};
export declare function createInputMessage(): InputMessage;
export declare function readMainMessage(value: unknown): MainToWorker | null;
export declare function readWorkerMessage(value: unknown): WorkerToMain | null;
export declare function errorText(error: unknown): string;
export declare function isPromise(value: unknown): value is Promise<unknown>;
//# sourceMappingURL=protocol.d.ts.map