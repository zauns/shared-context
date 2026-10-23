import { expect, test } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('M7 smoke: setup, issue, attachment, settings, trash, backup, export, token', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/projects\/SHC\/board$/);

  await page.getByRole('button', { name: 'New Issue', exact: true }).first().click();
  await page.getByLabel('Title').fill('UI smoke issue');
  await page.getByRole('button', { name: 'Create Issue' }).click();
  await expect(page.getByRole('dialog', { name: 'Issue SHC-1' })).toBeVisible();

  await page
    .locator('[data-testid="attachments-section"] input[type="file"]')
    .setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('smoke.png', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close Issue' }).click();
  await expect(page.getByRole('dialog', { name: 'Issue SHC-1' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Project settings' }).click();
  await expect(page.getByTestId('project-settings')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('Shared Context UI');
  await page.getByRole('button', { name: 'Save identity' }).click();
  await expect(page.getByText('Project settings saved.')).toBeVisible();

  await page.getByLabel('Doc allowlist').fill('README.md\ndocs/**/*.md');
  await page.getByRole('button', { name: 'Save allowlist' }).click();
  await expect(page.getByText('Doc allowlist saved.')).toBeVisible();

  await page.getByLabel('New Module').fill('UI');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Name for UI')).toHaveValue('UI');

  await page.getByRole('link', { name: 'Back to board' }).click();
  await page.getByRole('link', { name: /SHC-1/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Issue SHC-1' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Issue' }).first().click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete SHC-1?' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete Issue' }).click();
  await expect(page).toHaveURL(/\/projects\/SHC\/board$/);

  await page.getByRole('link', { name: 'Project settings' }).click();
  await page.getByRole('button', { name: 'Restore batch' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Restored 1 Issue.')).toBeVisible();

  await page.getByRole('button', { name: 'Backup now' }).click();
  await expect(page.getByText(/Backup created:/)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Markdown zip' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^export-SHC-.*\.zip$/);

  await page.getByRole('link', { name: 'Global settings' }).click();
  await expect(page.getByTestId('global-settings')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await expect(page.getByTestId('mcp-token')).not.toHaveText(/•/);

  await page.getByRole('button', { name: 'Regenerate' }).click();
  await page.getByRole('button', { name: 'Regenerate token' }).click();
  await expect(page.getByText(/Token regenerated/)).toBeVisible();
});