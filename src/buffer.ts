export type Drawable = {
  width: number;
  height: number;
};

export function applyBufferSize(canvas: Drawable, width: number, height: number, dpr: number): void {
  const bufferWidth = Math.max(1, Math.floor(width * dpr));
  const bufferHeight = Math.max(1, Math.floor(height * dpr));

  if (canvas.width !== bufferWidth) {
    canvas.width = bufferWidth;
  }

  if (canvas.height !== bufferHeight) {
    canvas.height = bufferHeight;
  }
}
