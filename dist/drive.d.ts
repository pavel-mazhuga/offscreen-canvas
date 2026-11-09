import { type Drawable } from './buffer';
import type { InputMessage } from './protocol';
import type { World } from './types';
export type Surface = Drawable & {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
};
export type Driver = {
    apply(input: InputMessage): void;
    key(code: string, down: boolean): void;
    command(payload: unknown): unknown;
    dispose(): void;
};
export declare function driveWorld(world: World, canvas: Surface, options?: {
    visible?: boolean;
    onContextLost?: () => void;
}): Driver;
//# sourceMappingURL=drive.d.ts.map