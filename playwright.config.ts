import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  webServer: {
    command: 'npm run build && npm run demo',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 800, height: 600 },
    launchOptions: {
      args: ['--use-angle=swiftshader'],
    },
  },
});
