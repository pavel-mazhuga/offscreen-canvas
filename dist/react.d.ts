import { type RefObject } from 'react';
import type { AttachOptions, Session } from './types';
export type OffscreenOptions = Omit<AttachOptions, 'canvas'>;
export declare function useOffscreenCanvas<Req = unknown, Res = unknown>(options: OffscreenOptions): {
    ref: RefObject<HTMLCanvasElement | null>;
    session: RefObject<Session<Req, Res> | null>;
};
export type OffscreenCanvasProps<Req, Res> = {
    options: OffscreenOptions;
    className?: string;
    sessionRef?: RefObject<Session<Req, Res> | null>;
};
export declare function OffscreenCanvas<Req = unknown, Res = unknown>(props: OffscreenCanvasProps<Req, Res>): import("react").JSX.Element;
//# sourceMappingURL=react.d.ts.map