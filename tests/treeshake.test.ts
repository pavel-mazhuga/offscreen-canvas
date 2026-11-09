import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

async function bundle(source: string, external: string[] = []): Promise<string> {
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: process.cwd(),
      sourcefile: 'entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external,
  });

  return result.outputFiles[0]?.text ?? '';
}

describe('package entries', () => {
  it('tree-shakes the core entry without react or three', async () => {
    const text = await bundle(`import { attachCanvas } from './src/index.ts'; export { attachCanvas };`);

    expect(text).toContain('attachCanvas');
    expect(text).not.toContain('useOffscreenCanvas');
    expect(text).not.toContain('from "react"');
    expect(text).not.toContain('three');
  });

  it('keeps the react entry on its own import', async () => {
    const text = await bundle(
      `import { useOffscreenCanvas } from './src/react.tsx'; export { useOffscreenCanvas };`,
      ['react', 'react/jsx-runtime'],
    );

    expect(text).toContain('useOffscreenCanvas');
    expect(text).toContain('from "react"');
  });
});
