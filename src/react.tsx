import { useEffect, useRef, type RefObject } from 'react';
import { attachCanvas } from './host';
import type { AttachOptions, Session } from './types';

export type OffscreenOptions = Omit<AttachOptions, 'canvas'>;

export function useOffscreenCanvas<Req = unknown, Res = unknown>(
  options: OffscreenOptions,
): {
  ref: RefObject<HTMLCanvasElement | null>;
  session: RefObject<Session<Req, Res> | null>;
} {
  const ref = useRef<HTMLCanvasElement>(null);
  const session = useRef<Session<Req, Res> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const canvas = ref.current;

    if (!canvas) {
      return;
    }

    const current = optionsRef.current;
    const attached = attachCanvas<Req, Res>({
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

export type OffscreenCanvasProps<Req, Res> = {
  options: OffscreenOptions;
  className?: string;
  sessionRef?: RefObject<Session<Req, Res> | null>;
};

export function OffscreenCanvas<Req = unknown, Res = unknown>(props: OffscreenCanvasProps<Req, Res>) {
  const hostRef = useRef<HTMLDivElement>(null);
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
    const session = attachCanvas<Req, Res>({
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

  return <div ref={hostRef} className={props.className} />;
}
