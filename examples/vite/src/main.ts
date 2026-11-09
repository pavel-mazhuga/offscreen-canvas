import { attachCanvas } from 'offscreen-canvas';
import { createWorld } from './world';

const canvas = document.querySelector('canvas');

if (!canvas) {
  throw new Error('canvas missing');
}

const main = new URLSearchParams(window.location.search).get('main') === '1';

const session = attachCanvas<{ type: 'buffer' }, { width: number; height: number }>({
  canvas,
  createWorld,
  createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  mode: main ? 'main' : 'auto',
  maxDpr: 1,
  onReady(info) {
    document.documentElement.dataset.mode = info.mode;
    document.documentElement.dataset.ready = '1';
  },
});

window.__buffer = () => session.request({ type: 'buffer' });
window.__dispose = () => {
  session.dispose();
};

export {};

declare global {
  interface Window {
    __buffer: () => Promise<{ width: number; height: number }>;
    __dispose: () => void;
  }
}
