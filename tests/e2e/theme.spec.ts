import { expect, test } from '@playwright/test';

const themeKey = 'lunch-roller.theme';

test('follows system theme until a choice is saved, persists it and syncs tabs', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('button', { name: 'Switch to light mode' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(17, 23, 25)',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(231, 223, 205)',
  );
  await expect(page.locator('.setup-card')).toHaveCSS(
    'background-color',
    'rgb(246, 240, 226)',
  );
  await expect(page.locator('.topbar .brand-title')).toHaveCSS(
    'font-family',
    /Georgia/,
  );
  await expect(page.locator('body')).toHaveCSS(
    'font-family',
    /Arial|sans-serif/,
  );
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), themeKey),
  ).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(17, 23, 25)',
  );
  await expect(page.locator('html')).toHaveCSS('color', 'rgb(217, 217, 202)');
  await expect(page.locator('.topbar .brand-title')).toHaveCSS(
    'color',
    'rgb(239, 231, 211)',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    page.getByRole('button', { name: 'Switch to dark mode' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await second.close();
  expect(errors).toEqual([]);
});

test('dark mode covers the name picker, wheel, admin forms and removal dialog on mobile', async ({
  page,
}) => {
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Praise the Wheel', exact: true }),
    async (button) => {
      await button.click();
    },
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByTestId('name-picker')).toBeVisible();
  await expect(page.locator('.setup-card')).toHaveCSS(
    'background-color',
    'rgb(27, 34, 37)',
  );
  await page.getByLabel('Your name').selectOption({ label: 'Alex' });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.wheel')).toBeVisible();
  await page
    .locator('.top-actions')
    .getByText('Admin', { exact: true })
    .click();
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByTestId('admin-preferences')).toHaveCSS(
    'background-color',
    'rgb(27, 34, 37)',
  );
  await expect(
    page.getByLabel('Reopen activity this many minutes after the roll'),
  ).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({
    path: 'test-results/dark-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/dark-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Remove Alex', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCSS(
    'background-color',
    'rgb(27, 34, 37)',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('invalid and blocked theme storage fall back safely and still allow toggling', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'invalid-theme');
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new DOMException('Blocked', 'SecurityError');
      return read.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Blocked', 'SecurityError');
      return write.call(this, name, value);
    };
  }, themeKey);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
