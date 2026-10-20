import { expect, test } from '@playwright/test';
test('landing page reports readiness and shows the lunch wheel', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(process.env.APP_ORIGIN ?? '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Lunch Roller',
  );
  await expect(page.getByText('Web + database ready')).toBeVisible();
  const wheel = page.locator('.wheel');
  await expect(wheel).toBeVisible();
  const desktopBounds = await wheel.boundingBox();
  expect(desktopBounds).not.toBeNull();
  expect(desktopBounds!.width).toBeGreaterThan(600);
  await page.screenshot({ path: 'test-results/wheel-desktop.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(wheel).toBeVisible();
  const mobileBounds = await wheel.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join in' })).toBeVisible();
  await expect(page.locator('.wheel-footer strong')).toBeVisible();
  await expect(page.locator('.top-actions').getByText('Admin')).toBeVisible();
  await page.screenshot({ path: 'test-results/wheel-mobile.png' });

  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    database: 'ok',
    service: 'web',
  });
});
