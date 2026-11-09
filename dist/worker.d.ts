import type { CreateWorld } from './types';
export type WorkerScope = {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((this: WorkerScope, event: MessageEvent) => void) | null;
    close?: () => void;
};
export declare function runCanvasWorker(createWorld: CreateWorld, scope?: WorkerScope): void;
//# sourceMappingURL=worker.d.ts.map