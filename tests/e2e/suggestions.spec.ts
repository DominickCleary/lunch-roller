import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  );

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin;
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password';
const suffix = randomUUID().slice(0, 8);
const authorName = `LR-SUG-${suffix} Author`;
const voterName = `LR-SUG-${suffix} Voter`;
const firstTitle = `LR-SUG-${suffix} Approve idea`;
const secondTitle = `LR-SUG-${suffix} Deny idea`;
const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
let authorId = '';
let voterId = '';

test.beforeAll(async () => {
  authorId = (await game.saveParticipant({ name: authorName })).id;
  voterId = (await game.saveParticipant({ name: voterName })).id;
});

test.afterAll(async () => {
  try {
    if (authorId) {
      await database.client`
        DELETE FROM suggestion_votes
        WHERE participant_id = ${authorId}::uuid
           OR suggestion_id IN (
             SELECT id FROM suggestions WHERE participant_id = ${authorId}::uuid
           )
      `;
    }
    if (voterId)
      await database.client`DELETE FROM suggestion_votes WHERE participant_id = ${voterId}::uuid`;
    if (authorId)
      await database.client`DELETE FROM suggestions WHERE participant_id = ${authorId}::uuid`;
    if (authorId && voterId)
      await database.client`DELETE FROM participants WHERE id IN (${authorId}::uuid, ${voterId}::uuid)`;
  } finally {
    await database.close();
  }
});

test('submits suggestions, permits one vote per request, and lets admins review them', async ({
  page,
  request,
}) => {
  await page.goto(origin);
  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    authorId,
  );
  await page.reload();
  await page.getByRole('link', { name: 'Suggestion board' }).click();
  await expect(
    page.getByRole('heading', { name: 'Suggestion board' }),
  ).toBeVisible();

  const form = page.locator('.suggestion-form');
  await form.getByLabel('Title').fill(firstTitle);
  await form
    .getByLabel('Description')
    .fill('A small change that would make lunch better.');
  await form.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByRole('heading', { name: firstTitle })).toBeVisible();

  await form.getByLabel('Title').fill(secondTitle);
  await form
    .getByLabel('Description')
    .fill('A second request for the administrator to review.');
  await form.getByRole('button', { name: 'Add to board' }).click();
  await expect(page.getByRole('heading', { name: secondTitle })).toBeVisible();

  const firstCard = page
    .locator('.suggestion-card')
    .filter({ hasText: firstTitle });
  const secondCard = page
    .locator('.suggestion-card')
    .filter({ hasText: secondTitle });
  const list = (await (await request.get('/api/v1/suggestions')).json()) as {
    suggestions: Array<{ id: string; title: string }>;
  };
  const firstSuggestion = list.suggestions.find(
    (item) => item.title === firstTitle,
  );
  const secondSuggestion = list.suggestions.find(
    (item) => item.title === secondTitle,
  );
  expect(firstSuggestion).toBeTruthy();
  expect(secondSuggestion).toBeTruthy();

  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    voterId,
  );
  await page.reload();
  const firstVoterCard = page
    .locator('.suggestion-card')
    .filter({ hasText: firstTitle });
  const secondVoterCard = page
    .locator('.suggestion-card')
    .filter({ hasText: secondTitle });
  await firstVoterCard
    .getByRole('button', { name: new RegExp(`Upvote ${firstTitle}`) })
    .click();
  await expect(
    firstVoterCard.getByRole('button', {
      name: new RegExp(`Upvote ${firstTitle}`),
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    firstVoterCard.getByRole('button', {
      name: new RegExp(`Downvote ${firstTitle}`),
    }),
  ).toBeDisabled();
  await secondVoterCard
    .getByRole('button', { name: new RegExp(`Downvote ${secondTitle}`) })
    .click();
  await expect(
    secondVoterCard.getByRole('button', {
      name: new RegExp(`Downvote ${secondTitle}`),
    }),
  ).toHaveAttribute('aria-pressed', 'true');

  const voteHeaders = { Origin: origin, 'X-Participant-Id': voterId };
  const beforeDuplicate = await request.get('/api/v1/suggestions', {
    headers: voteHeaders,
  });
  const beforeDuplicateSuggestions = (await beforeDuplicate.json())
    .suggestions as Array<{ id: string; yourVote: number | null }>;
  expect(
    beforeDuplicateSuggestions.find((item) => item.id === firstSuggestion!.id)
      ?.yourVote,
  ).toBe(1);
  const duplicateVote = await request.put(
    `/api/v1/suggestions/${firstSuggestion!.id}/vote`,
    { data: { value: -1 }, headers: voteHeaders },
  );
  expect(
    duplicateVote.status(),
    `Duplicate vote response: ${JSON.stringify(await duplicateVote.json())}`,
  ).toBe(409);
  expect((await duplicateVote.json()).error.code).toBe('ALREADY_VOTED');

  await page.reload();
  await expect(
    page
      .locator('.suggestion-card')
      .filter({ hasText: firstTitle })
      .getByRole('button', { name: new RegExp(`Upvote ${firstTitle}`) }),
  ).toHaveAttribute('aria-pressed', 'true');

  const votedResponse = await request.get('/api/v1/suggestions', {
    headers: { 'X-Participant-Id': voterId },
  });
  const votedRequests = (await votedResponse.json()).suggestions as Array<{
    id: string;
    upvotes: number;
    downvotes: number;
  }>;
  expect(votedResponse.ok()).toBe(true);
  expect(
    votedRequests.find((item) => item.id === firstSuggestion!.id),
  ).toMatchObject({
    upvotes: 1,
    downvotes: 0,
  });
  expect(
    votedRequests.find((item) => item.id === secondSuggestion!.id),
  ).toMatchObject({
    upvotes: 0,
    downvotes: 1,
  });
  await expect(
    page
      .locator('.suggestion-card')
      .filter({ hasText: secondTitle })
      .getByRole('button', { name: new RegExp(`Downvote ${secondTitle}`) }),
  ).toHaveAttribute('aria-pressed', 'true');

  const unauthorized = await request.patch(
    `/api/v1/admin/suggestions/${firstSuggestion!.id}`,
    { data: { status: 'approved' }, headers: { Origin: origin } },
  );
  expect(unauthorized.status()).toBe(401);

  await page.goto(origin);
  await page.getByText('Admin tools', { exact: true }).click();
  await page.getByLabel('Administrator password').fill(adminPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Administrator tools unlocked.')).toBeVisible();
  await page.getByRole('link', { name: 'Suggestion board' }).click();
  await expect(
    page.getByRole('button', { name: 'Approve' }).first(),
  ).toBeVisible();

  await firstCard
    .locator('.suggestion-admin-actions')
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(firstCard.locator('.suggestion-status')).toHaveText('Approved');
  await secondCard
    .locator('.suggestion-admin-actions')
    .getByRole('button', { name: 'Deny' })
    .click();
  await expect(secondCard.locator('.suggestion-status')).toHaveText('Denied');
  await page.reload();
  await expect(
    page
      .locator('.suggestion-card')
      .filter({ hasText: firstTitle })
      .locator('.suggestion-status'),
  ).toHaveText('Approved');
  await expect(
    page
      .locator('.suggestion-card')
      .filter({ hasText: secondTitle })
      .locator('.suggestion-status'),
  ).toHaveText('Denied');
});
