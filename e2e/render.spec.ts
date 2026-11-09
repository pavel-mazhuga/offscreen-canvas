import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

function countClearPixels(buffer: Buffer): number {
  const png = PNG.sync.read(buffer);
  let hits = 0;

  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;
    const a = png.data[i + 3] ?? 0;

    if (a > 200 && r > 200 && g < 90 && b > 70 && b < 140) {
      hits += 1;
    }
  }

  return hits;
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

test('worker path paints, resizes the buffer, and terminate stops the worker', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe('worker');
  expect(page.workers().length).toBeGreaterThan(0);

  const transferred = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');

    if (!canvas) {
      return 'missing';
    }

    try {
      canvas.getContext('2d');

      return 'context';
    } catch (error) {
      return error instanceof Error ? error.name : 'threw';
    }
  });
  expect(transferred).toBe('InvalidStateError');

  const shot = await page.locator('canvas').screenshot();
  expect(countClearPixels(shot)).toBeGreaterThan(10);

  const before = await page.evaluate(() => window.__buffer());
  await page.setViewportSize({ width: 400, height: 300 });
  await expect
    .poll(async () => {
      const next = await page.evaluate(() => window.__buffer());

      return next.width !== before.width || next.height !== before.height;
    })
    .toBe(true);

  const after = await page.evaluate(() => window.__buffer());
  expect(after.width).toBeGreaterThan(0);
  expect(after.height).toBeGreaterThan(0);

  await page.evaluate(() => window.__dispose());
  await expect.poll(() => page.workers().length).toBe(0);

  const rejected = await page.evaluate(async () => {
    try {
      await window.__buffer();

      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
});

test('main-thread fallback paints without a worker', async ({ page }) => {
  await page.goto('/?main=1');
  await waitReady(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe('main');
  expect(page.workers()).toHaveLength(0);

  const live = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');

    return Boolean(canvas && canvas.width > 0);
  });
  expect(live).toBe(true);

  const shot = await page.locator('canvas').screenshot();
  expect(countClearPixels(shot)).toBeGreaterThan(10);
});
