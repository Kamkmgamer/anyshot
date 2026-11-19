import { expect, test } from '@playwright/test';
import { type Launched, launch, processTypes, rendererCount, windowKinds } from './harness';

let ctx: Launched;
test.beforeEach(async () => {
  ctx = await launch();
});
test.afterEach(async () => {
  await ctx.close();
});

test('starts tray-only: no windows and no renderer processes', async () => {
  // Give Chromium time to settle its helper processes.
  await new Promise((r) => setTimeout(r, 1500));
  expect(await windowKinds(ctx.app)).toEqual([]);
  const types = await processTypes(ctx.app);
  expect(rendererCount(types)).toBe(0);
  expect(types).toContain('Browser');
  expect(ctx.app.windows()).toHaveLength(0);
});

test('idle main process stays near 0% CPU', async () => {
  await new Promise((r) => setTimeout(r, 1500));
  // percentCPUUsage is measured since the previous getAppMetrics call.
  await ctx.app.evaluate(({ app }) => app.getAppMetrics());
  await new Promise((r) => setTimeout(r, 5000));
  const cpu = await ctx.app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })),
  );
  const browser = cpu.find((m) => m.type === 'Browser');
  expect(browser).toBeDefined();
  // Playwright's own inspector traffic adds a little noise; idle should be well under this.
  expect(browser?.cpu ?? 100).toBeLessThan(2);
});

test('tray menu offers the capture actions', async () => {
  const labels = await ctx.app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label),
  );
  expect(labels).toEqual(
    expect.arrayContaining([
      'Capture area',
      'Capture screen',
      'Record area',
      'Settings…',
      'Quit anyshot',
    ]),
  );
});
