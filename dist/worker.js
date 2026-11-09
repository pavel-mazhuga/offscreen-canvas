import { applyBufferSize } from './buffer';
import { driveWorld } from './drive';
import { workerCanUseWebGL } from './gl';
import { errorText, isPromise, readMainMessage } from './protocol';
function isPagePost(value) {
    if (typeof document !== 'undefined') {
        return false;
    }
    if (!('postMessage' in value) || typeof value.postMessage !== 'function') {
        return false;
    }
    if (!('close' in value) || typeof value.close !== 'function') {
        return false;
    }
    return true;
}
function readPagePost(value) {
    if (!isPagePost(value)) {
        return null;
    }
    return value;
}
function workerGlobalScope() {
    const workerGlobal = readPagePost(globalThis);
    if (!workerGlobal) {
        throw new Error('runCanvasWorker must run inside a worker');
    }
    return {
        postMessage(message, transfer) {
            if (transfer && transfer.length > 0) {
                workerGlobal.postMessage(message, transfer);
                return;
            }
            workerGlobal.postMessage(message);
        },
        get onmessage() {
            return workerGlobal.onmessage;
        },
        set onmessage(handler) {
            workerGlobal.onmessage = handler;
        },
        close() {
            workerGlobal.close();
        },
    };
}
export function runCanvasWorker(createWorld, scope) {
    const bound = scope ?? workerGlobalScope();
    let driver = null;
    let world = null;
    let stopped = false;
    const post = (message) => {
        bound.postMessage(message);
    };
    const fail = () => {
        try {
            if (driver) {
                driver.dispose();
            }
            else {
                world?.dispose();
            }
        }
        catch {
            driver = null;
            world = null;
        }
        driver = null;
        world = null;
        post({ t: 'gl-error' });
    };
    const handleRpc = (message) => {
        let result;
        try {
            result = driver ? driver.command(message.payload) : undefined;
        }
        catch (error) {
            if (message.id !== 0) {
                post({ t: 'rpc-result', id: message.id, ok: false, value: errorText(error) });
            }
            return;
        }
        if (message.id === 0) {
            if (isPromise(result)) {
                void result.catch(() => undefined);
            }
            return;
        }
        Promise.resolve(result).then((value) => {
            post({ t: 'rpc-result', id: message.id, ok: true, value });
        }, (error) => {
            post({ t: 'rpc-result', id: message.id, ok: false, value: errorText(error) });
        });
    };
    bound.onmessage = (event) => {
        const message = readMainMessage(event.data);
        if (!message) {
            return;
        }
        if (message.t === 'dispose') {
            stopped = true;
            driver?.dispose();
            driver = null;
            world = null;
            post({ t: 'disposed' });
            bound.close?.();
            return;
        }
        if (stopped) {
            return;
        }
        if (message.t === 'init') {
            if (driver) {
                return;
            }
            try {
                if (!workerCanUseWebGL()) {
                    post({ t: 'gl-error' });
                    return;
                }
                applyBufferSize(message.canvas, message.width, message.height, message.dpr);
                world = createWorld({
                    canvas: message.canvas,
                    width: message.width,
                    height: message.height,
                    dpr: message.dpr,
                    isWorker: true,
                    props: message.props,
                });
                if (typeof world.dispose !== 'function') {
                    throw new Error('createWorld must return an object with dispose()');
                }
                const created = world;
                driver = driveWorld(created, message.canvas, {
                    visible: message.visible === 1,
                    onContextLost() {
                        post({ t: 'gl-error' });
                    },
                });
                post({ t: 'ready' });
            }
            catch {
                fail();
            }
            return;
        }
        if (message.t === 'input') {
            driver?.apply(message);
            return;
        }
        if (message.t === 'key') {
            driver?.key(message.code, message.down === 1);
            return;
        }
        if (message.t === 'rpc') {
            handleRpc(message);
            return;
        }
        const _exhaustive = message;
        return _exhaustive;
    };
}
//# sourceMappingURL=worker.js.map