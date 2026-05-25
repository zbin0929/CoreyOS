import { test, expect } from './fixtures/test';

/**
 * Smoke suite — proves the app bundle boots, routes mount, and the global
 * shell (sidebar, palette, theme toggle) still works after any change.
 *
 * If these fail, don't bother running the feature suites — something is
 * catastrophically wrong.
 */

test.describe('shell', () => {
  test('home route loads with nav + tagline', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /CoreyOS/i })).toBeVisible();
    // Sidebar is always mounted — check a couple of nav entries by role.
    await expect(page.getByRole('link', { name: /Home|首页/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Workflows|工作流/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Settings|设置/ })).toBeVisible();
  });

  test('can navigate to chat and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Chat|对话/ }).click();
    await expect(page).toHaveURL(/\/chat$/);
    // SessionsPanel header is chat-specific.
    await expect(page.getByText(/Sessions|会话/).first()).toBeVisible();
    await page.getByRole('link', { name: /Home|首页/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('command palette opens with the shortcut button', async ({ page }) => {
    await page.goto('/');
    // Clicking the topbar trigger is more reliable than synthesising ⌘K.
    await page.getByRole('button', { name: /Open command palette|打开命令面板/i }).click();
    // Palette is a plain overlay — identify it by the cmdk input inside.
    const input = page.getByPlaceholder(/Type a command or search…|输入命令或搜索…/).last();
    await expect(input).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
  });

  test('theme toggle flips html[data-theme]', async ({ page }) => {
    await page.goto('/');
    const root = page.locator('html');
    const before = await root.getAttribute('data-theme');
    // Use the toolbar button instead of the shortcut — click is less flaky
    // than synthesised Meta-combos under Playwright on macOS.
    await page.getByRole('button', { name: /Toggle theme|切换主题/i }).click();
    const expected = before === 'dark' ? 'light' : 'dark';
    await expect(root).toHaveAttribute('data-theme', expected);
  });
});
