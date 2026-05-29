/**
 * E2E test for critical editor flow: New project → create sprite → build level → play → export.
 *
 * This test uses Playwright. Run with: npx playwright test
 * Install with: npx playwright install chromium
 */

import { test, expect } from '@playwright/test';

test.describe('Retro Game Maker Editor Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  test('loads the editor', async ({ page }) => {
    // The app should show the tilemap editor by default
    await expect(page.locator('.app-layout')).toBeVisible();
    await expect(page.locator('.menu-bar')).toBeVisible();
    await expect(page.locator('.toolbar')).toBeVisible();
  });

  test('new project dialog opens and creates project', async ({ page }) => {
    // Click New
    await page.click('.menu-btn:has-text("New")');
    await expect(page.locator('.dialog')).toBeVisible();
    await expect(page.locator('text=New Project')).toBeVisible();

    // Fill name
    await page.fill('#new-proj-name', 'Test Game');
    await page.click('button:has-text("Create")');

    // Dialog should close
    await expect(page.locator('.dialog')).not.toBeVisible();
  });

  test('switches between sprite and tilemap modes', async ({ page }) => {
    // Should start in tilemap mode
    await expect(page.locator('.tilemap-editor')).toBeVisible();

    // Switch to sprite mode
    await page.click('button[title="Sprite Editor"]');
    await expect(page.locator('.sprite-editor')).toBeVisible();

    // Switch back to tilemap mode
    await page.click('button[title="Tilemap Editor"]');
    await expect(page.locator('.tilemap-editor')).toBeVisible();
  });

  test('play mode starts and stops', async ({ page }) => {
    // Click Play button
    await page.click('.play-btn-primary');
    // Should see start screen or game canvas (runtime canvas)
    // Play mode might show a runtime canvas
    await expect(page.locator('.runtime-canvas')).toBeVisible();

    // Click Stop
    await page.click('button:has-text("Stop")');
    await expect(page.locator('.tilemap-editor')).toBeVisible();
  });

  test('export dialog opens', async ({ page }) => {
    // Click Export Game button
    await page.click('.menu-btn:has-text("Export")');
    await expect(page.locator('.dialog')).toBeVisible();
    await expect(page.locator('text=Export Game')).toBeVisible();

    // Close dialog
    await page.click('button:has-text("Cancel")');
    await expect(page.locator('.dialog')).not.toBeVisible();
  });

  test('keyboard shortcut sheet toggles with ? key', async ({ page }) => {
    // Press ? key
    await page.keyboard.press('?');
    // Shortcut sheet should appear
    await expect(page.locator('.shortcuts-sheet')).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.shortcuts-sheet')).not.toBeVisible();
  });

  test('save indicator shows after changes', async ({ page }) => {
    // The save indicator should show the project name
    await expect(page.locator('.save-indicator-name')).toHaveText('Untitled');
  });
});
