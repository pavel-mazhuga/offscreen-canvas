import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { attachCanvas } from './host';
export function useOffscreenCanvas(options) {
    const ref = useRef(null);
    const session = useRef(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) {
            return;
        }
        const current = optionsRef.current;
        const attached = attachCanvas({
            ...current,
            canvas,
            onCanvas(next) {
                current.onCanvas?.(next);
            },
            onReady(info) {
                current.onReady?.(info);
            },
        });
        session.current = attached;
        return () => {
            attached.dispose();
            session.current = null;
        };
    }, []);
    return { ref, session };
}
export function OffscreenCanvas(props) {
    const hostRef = useRef(null);
    const optionsRef = useRef(props.options);
    optionsRef.current = props.options;
    const sessionRef = props.sessionRef;
    useEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        host.replaceChildren(canvas);
        const current = optionsRef.current;
        const session = attachCanvas({
            ...current,
            canvas,
            onCanvas(next) {
                current.onCanvas?.(next);
            },
            onReady(info) {
                current.onReady?.(info);
            },
        });
        if (sessionRef) {
            sessionRef.current = session;
        }
        return () => {
            session.dispose();
            if (sessionRef) {
                sessionRef.current = null;
            }
            host.replaceChildren();
        };
    }, [sessionRef]);
    return _jsx("div", { ref: hostRef, className: props.className });
}
//# sourceMappingURL=react.js.map