import { expect, test } from '@playwright/test';
test('landing page reports readiness and shows the lunch wheel', async ({
  page,
  request,
}) => {
  await page.goto(process.env.APP_ORIGIN ?? '/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Lunch sorted.',
  );
  await expect(page.locator('.hero [role="status"]')).toHaveText(
    'Web + database ready',
  );
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    database: 'ok',
    service: 'web',
  });
});
