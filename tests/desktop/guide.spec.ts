import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import { desktopFixture } from './journey-fixture.js';

test('intent-only setup opens on the Chat tab, saves web settings, and keeps the draft across pages', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  const server = createServer((request, response) => {
    response.statusCode = request.url === '/unavailable' ? 503 : 200;
    response.end('Synthetic test app');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  const url = `http://127.0.0.1:${address.port}`;
  const reply = async (type: string, text: string) =>
    writeFile(
      fixture.control,
      JSON.stringify({
        guideDelayMs: 1500,
        guideReply: {
          reply: text,
          widgets: [
            { type, recommended: type === 'verify-options' ? 'web' : null, url: null, link: null },
          ],
          actions: [],
        },
      }),
    );
  await reply('confirm-requirements', 'Synthetic setup playback. Check these requirements.');
  const desktop = await fixture.launch(info);
  try {
    const { page } = desktop;
    await page.getByLabel('What are you building?').fill('Users can list and create books.');
    await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
    const chat = page.getByRole('tabpanel', { name: 'Chat' });
    await expect(chat).toBeVisible();
    await expect(chat.getByRole('list', { name: 'Setup' })).toBeVisible();
    await expect(chat.getByRole('status', { name: 'Setup status' })).toHaveText(
      'Setup not complete',
    );
    await expect(chat.getByLabel('Message the Guide')).toBeInViewport();
    const thinking = chat.getByRole('status', { name: 'Aiden is thinking' });
    await expect(thinking).toHaveText('Thinking');
    const label = thinking.locator('span');
    await expect(label).toHaveCSS('animation-name', 'guide-thinking-shimmer');
    const initialPosition = await label.evaluate(
      (element) => getComputedStyle(element).backgroundPosition,
    );
    await expect
      .poll(() => label.evaluate((element) => getComputedStyle(element).backgroundPosition))
      .not.toBe(initialPosition);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(label).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.screenshot({ path: info.outputPath('00-thinking.png') });
    await expect(
      chat.getByText('Synthetic setup playback. Check these requirements.'),
    ).toBeVisible();
    await expect(thinking).not.toBeVisible();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Go to Chat', exact: true }).click();
    await expect(chat.getByRole('button', { name: 'Looks right' })).toBeVisible();
    await expect(chat.getByRole('region', { name: 'Change project scope' })).toHaveCount(0);
    // Each step's explanation is in plain view, not behind an info icon.
    await expect(
      chat.getByText(/Review the requirements and resolve any open questions/).first(),
    ).toBeVisible();
    await chat.getByText('What each step involves').click();
    await expect(chat.getByText(/Choose code, web, API, or manual checks/)).toBeVisible();
    await page.screenshot({
      path: info.outputPath('setup-step-explanations.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(chat.getByLabel('Message the Guide')).toBeInViewport();
    expect(await chat.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath('setup-step-explanations-narrow.png'),
      animations: 'disabled',
    });
    await chat.getByText('What each step involves').click();
    await expect(chat).toBeVisible();
    await page.setViewportSize({ width: 1320, height: 868 });
    await page.screenshot({ path: info.outputPath('01-setup-chat.png') });
    await reply('verify-options', 'Synthetic verification choice. How should I check the work?');
    await chat.getByRole('button', { name: 'Looks right' }).click();
    await page.screenshot({ path: info.outputPath('02-checklist.png') });
    await chat.getByRole('checkbox', { name: /Web app/ }).click();
    await chat.getByLabel('Where does the app run?').fill(`${url}/unavailable`);
    await chat.getByRole('button', { name: 'Check access' }).click();
    await expect(chat.getByRole('alert')).toContainText('HTTP 503');
    await expect(chat.getByRole('button', { name: 'Confirm setup' })).toBeDisabled();
    await chat.getByLabel('Where does the app run?').fill(url);
    await chat.getByRole('button', { name: 'Check access' }).click();
    await expect(chat.getByText(/Access checked\. You can confirm/)).toBeVisible();
    await reply('run-check', 'Synthetic setup saved. Ready for the first check.');
    await chat.getByRole('button', { name: 'Confirm setup', exact: true }).click();
    await chat.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(chat.getByText(/Setup complete/)).toBeVisible();
    await chat.getByRole('button', { name: 'Setup details' }).click();
    await expect(chat.getByText('What each step involves')).toBeVisible();
    await chat.getByRole('button', { name: 'Setup details' }).click();
    await chat.getByLabel('Message the Guide').fill('Keep this draft');
    await page.screenshot({ path: info.outputPath('02-setup-complete.png') });
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(chat).not.toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit verification in chat' }).click();
    await expect(chat.getByLabel('Where does the app run?')).toHaveValue(`${url}/`);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: /Application settings/ })).toBeVisible();
    await page.getByRole('button', { name: 'Ask Aiden about this project' }).click();
    await expect(chat.getByLabel('Message the Guide')).toHaveValue('Keep this draft');
    expect(await fixture.calls()).not.toContain('assess');
    await reply('choose-folder', 'Synthetic reply: connect the project folder here.');
    await page.getByRole('button', { name: 'Ask Aiden about this project' }).click();
    await chat.getByLabel('Message the Guide').fill('Connect my code');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await desktop.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, fixture.root);
    await chat.getByRole('button', { name: 'Choose the folder', exact: true }).click();
    await expect(chat.getByText(/Found 2 repositories/)).toBeVisible();
    await reply(
      'confirm-requirements',
      'Synthetic reply: code connected, review the updated requirements.',
    );
    await chat.getByRole('button', { name: 'Check access' }).click();
    await chat.getByRole('button', { name: 'Confirm setup' }).click();
    await expect.poll(async () => (await fixture.calls()).includes('assess')).toBe(true);
    await expect(chat.getByRole('region', { name: 'Code check results' })).toBeVisible();
    await expect(chat).toBeVisible();
    await expect(chat.getByRole('button', { name: 'View progress' })).toHaveCount(0);
    await expect(chat.getByRole('button', { name: 'View results' })).toHaveCount(0);
    const result = chat
      .getByRole('region', { name: 'Code check results' })
      .locator('summary')
      .first();
    await result.click();
    await expect(result.locator('..')).toHaveAttribute('open', '');
    await expect(chat.getByRole('status', { name: 'Setup status' })).toContainText(
      'Setup complete',
    );
    await expect(chat.getByLabel('Message the Guide')).toBeInViewport();
    await page.screenshot({
      path: info.outputPath('03-check-results-in-chat.png'),
      animations: 'disabled',
    });
    // The finished check is saved in the thread, and the Overview links back to it.
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'View results in chat', exact: true }).click();
    await expect(chat.getByRole('region', { name: 'Code check results' })).toBeInViewport();
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('clarification is a conversation with one composer and review comes before checks', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser engine', description: browserName });
  const fixture = await desktopFixture();
  await writeFile(
    fixture.control,
    JSON.stringify({
      guideDelayMs: 1500,
      understanding: {
        overview: fixture.f.product.overview,
        milestones: fixture.f.product.milestones,
        requirements: fixture.f.product.requirements.map((r) => ({
          id: r.id,
          text: r.text,
          edgeCases: [],
        })),
        repositories: [],
        calls: [
          {
            question: 'Which views should the calendar include?',
            options: ['Day', 'Week', 'Month'],
            selectionMode: 'multiple',
            requirementId: null,
            edgeCaseId: null,
            blocking: true,
            assumption: 'Access awaits your choice.',
            owner: 'you',
          },
        ],
      },
      guideReply: {
        reply: 'Synthetic clarification: let’s settle access first.',
        widgets: [{ type: 'confirm-requirements', recommended: null, url: null, link: null }],
        actions: [],
      },
    }),
  );
  const desktop = await fixture.launch(info);
  try {
    const { page } = desktop;
    await page.getByLabel('What are you building?').fill('Users can list and create books.');
    await page.getByRole('button', { name: /Hand it to Aiden/ }).click();
    const chat = page.getByRole('tabpanel', { name: 'Chat' });
    await expect(chat.getByRole('status', { name: 'Aiden is thinking' })).toBeVisible();
    await expect(chat.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
    await expect(
      chat.getByText('Synthetic clarification: let’s settle access first.'),
    ).toBeVisible();
    await expect(chat.getByText('Which views should the calendar include?')).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Looks right' })).toHaveCount(0);
    await expect(chat.getByRole('textbox')).toHaveCount(1);
    await expect(chat.getByRole('button', { name: 'Answer', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('clarification-chat.png') });
    await chat.getByRole('button', { name: 'Day', exact: true }).click();
    await chat.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(chat.getByLabel('Message the Guide')).toHaveValue('');
    await expect(chat.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chat.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('tab', { name: 'Scope', exact: true }).click();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await expect(chat.getByLabel('Message the Guide')).toHaveValue('');
    await expect(chat.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chat.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The next synthetic understanding incorporates the saved answer and raises no new questions.
    await page.screenshot({
      path: info.outputPath('selected-answers.png'),
      animations: 'disabled',
    });
    await writeFile(
      fixture.control,
      JSON.stringify({
        guideReply: {
          reply: 'Synthetic review ready.',
          widgets: [],
          actions: [],
        },
      }),
    );
    await chat.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(chat.locator('.chat-you')).toContainText('Day');
    await expect(chat.locator('.chat-you')).toContainText('Week');
    await expect(chat.getByRole('button', { name: 'Looks right' })).toBeVisible();
    await expect(
      chat.getByText('Which views should the calendar include?', { exact: true }),
    ).toBeVisible();
    await expect(chat.getByRole('group', { name: 'Answer choices' })).toHaveCount(0);
    expect((await fixture.calls()).filter((call) => call === 'understand')).toHaveLength(2);
    expect(await fixture.calls()).not.toContain('assess');
    expect(await fixture.calls()).not.toContain('triage');
    await page.screenshot({ path: info.outputPath('clarified-review.png') });
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});
