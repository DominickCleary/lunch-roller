import { expect, test } from '@playwright/test';
test('landing page reports readiness and explains scaffold status', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'All hailthe lunch wheel.',
  );
  await expect(page.getByRole('status')).toHaveText('Web + database ready');
  await expect(
    page.getByText('Scaffold ready.', { exact: false }),
  ).toBeVisible();
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    database: 'ok',
    service: 'web',
  });
});
