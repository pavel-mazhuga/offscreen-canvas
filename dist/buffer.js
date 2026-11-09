export function applyBufferSize(canvas, width, height, dpr) {
    const bufferWidth = Math.max(1, Math.floor(width * dpr));
    const bufferHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== bufferWidth) {
        canvas.width = bufferWidth;
    }
    if (canvas.height !== bufferHeight) {
        canvas.height = bufferHeight;
    }
}
//# sourceMappingURL=buffer.js.map