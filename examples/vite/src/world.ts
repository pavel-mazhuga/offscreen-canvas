import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { World, WorldContext } from 'offscreen-canvas';

const CLEAR = 0xff3366;

function drawSize(width: number, height: number) {
  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

export function createWorld(context: WorldContext): World {
  const size = drawSize(context.width, context.height);
  const renderer = new WebGLRenderer({
    canvas: context.canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(context.dpr);
  renderer.setSize(size.width, size.height, false);
  renderer.setClearColor(CLEAR, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, size.width / size.height, 0.1, 10);
  camera.position.z = 3;
  const geometry = new BoxGeometry(0.6, 0.6, 0.6);
  const material = new MeshBasicMaterial({ color: 0x221018 });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  let disposed = false;

  const paint = (time: number) => {
    if (disposed) {
      return;
    }

    mesh.rotation.y = time * 0.001;
    mesh.rotation.x = time * 0.0004;
    renderer.render(scene, camera);
  };

  paint(0);

  return {
    frame: paint,
    resize(width, height, dpr) {
      const next = drawSize(width, height);
      camera.aspect = next.width / next.height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr);
      renderer.setSize(next.width, next.height, false);
    },
    command(payload) {
      if (typeof payload !== 'object' || payload === null || !('type' in payload)) {
        return undefined;
      }

      if (payload.type !== 'buffer') {
        return undefined;
      }

      return { width: context.canvas.width, height: context.canvas.height };
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
