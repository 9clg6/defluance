import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('preferences and small screens', { tags: ['preferences'], session: 'admin' }, () => {
  test('the dark theme and French survive a reload', async ({ app, screen, browser }) => {
    await app.open('/');
    const isDark = () => browser.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark();
    await screen.getByRole('button', 'Toggle light and dark theme').tap();
    expect(await isDark()).toBe(!before);
    await app.open('/');
    expect(await isDark()).toBe(!before);

    await screen.getByRole('button', 'Switch language').tap();
    await expect(screen.getByRole('heading', 'Mises à jour récemment')).toBeVisible();
    await app.open('/');
    await expect(screen.getByRole('heading', 'Mises à jour récemment')).toBeVisible();
    expect(await browser.evaluate(() => document.documentElement.lang)).toBe('fr');
  });

  test('no page scrolls sideways', async ({ app, browser }) => {
    for (const path of ['/', '/n/produit/auth-login/', '/graph/', '/settings/', '/audit/']) {
      await app.open(path);
      const overflow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });
});
