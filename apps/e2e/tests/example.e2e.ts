import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the server is up and redirects visitors to sign in', { tags: ['smoke'] }, async ({ app, browser }) => {
  await app.open('/');
  await expect(browser).toHaveURL('/login/');
});
