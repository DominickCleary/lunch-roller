import { expect, test } from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const database = createDatabase(process.env.TEST_DATABASE_URL!);
const game = new GameService(database);
let economy: Awaited<ReturnType<GameService['getEconomy']>>;
let preferences: Awaited<ReturnType<GameService['getPreferences']>>;
let health: Awaited<ReturnType<GameService['getHealthRule']>>;

test.beforeAll(async () => {
  economy = await game.getEconomy();
  preferences = await game.getPreferences();
  health = await game.getHealthRule();
  await game.setEconomy({
    ...economy,
    attendanceReward: 13,
    boostCost: 7,
    reduceCost: 11,
    addPlaceCost: 23,
    removePlaceCost: 41,
    boostMultiplier: 1.4,
    reduceMultiplier: 0.6,
    newPlaceMultiplier: 1.2,
  });
  await game.setPreferences({
    ...preferences,
    wheelSpinSeconds: 9,
    bettingCloseMinutes: 9,
    wheelSwitchTime: '16:45',
  });
  await game.setHealthRule({ enabled: true, multiplier: 1.6 });
});
test.afterAll(async () => {
  try {
    await game.setEconomy(economy);
    await game.setPreferences(preferences);
    await game.setHealthRule(health);
  } finally {
    await database.close();
  }
});

test('navbar Help explains current rules, refreshes changed settings, and works on mobile and with a keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByTestId('name-picker')).toBeVisible();
  const help = page.getByRole('button', { name: 'Help', exact: true });
  const modal = page.getByRole('dialog', {
    name: 'Gambling about lunch rules',
  });
  await help.click();
  await expect(modal).toBeVisible();
  const tokens = modal.getByRole('region', { name: 'Tokens and places' });
  await expect(tokens).toContainText('+13 tokens');
  await expect(tokens).toContainText('7 tokens · ×1.4 weight');
  await expect(tokens).toContainText('11 tokens · ×0.6 weight');
  await expect(tokens).toContainText('23 tokens');
  await expect(tokens).toContainText('41 tokens');
  await expect(tokens).toContainText('Banish ×');
  await expect(tokens).toContainText('×1.2 the average active weight');
  await expect(tokens).toContainText('New markets close 9 minutes');
  await expect(tokens).toContainText('Boosting −2 makes it −1');
  await expect(
    modal.getByRole('region', { name: 'Health balance' }),
  ).toContainText('×1.6 weight');
  await expect(modal.getByRole('region', { name: 'The wheel' })).toContainText(
    '9 seconds',
  );
  await expect(modal.getByRole('region', { name: 'The wheel' })).toContainText(
    'After each roll, the wheel shows live odds for the next scheduled spin.',
  );
  await expect(
    modal.getByRole('button', { name: 'Close rules' }),
  ).toBeFocused();
  await page.screenshot({ path: '/tmp/lunch-rules-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(help).toBeFocused();
  await game.setEconomy({ ...(await game.getEconomy()), boostCost: 17 });
  await game.setHealthRule({ enabled: false, multiplier: 1.6 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await help.click();
  await expect(tokens).toContainText('17 tokens · ×1.4 weight');
  await expect(
    modal.getByRole('region', { name: 'Health balance' }),
  ).toContainText('health bonus is currently disabled');
  await expect(modal).toHaveCSS('background-color', 'rgb(27, 34, 37)');
  const bounds = (await modal.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '/tmp/lunch-rules-mobile.png' });
  await modal.getByRole('button', { name: 'Close rules' }).click();
  await expect(help).toBeFocused();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
