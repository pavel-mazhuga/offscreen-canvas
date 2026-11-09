export function workerCanUseWebGL(): boolean {
  if (typeof OffscreenCanvas === 'undefined') {
    return false;
  }

  try {
    const probe = new OffscreenCanvas(1, 1);
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');

    if (!gl) {
      return false;
    }

    // A live probe context counts against the browser WebGL context limit.
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    return true;
  } catch {
    return false;
  }
}
