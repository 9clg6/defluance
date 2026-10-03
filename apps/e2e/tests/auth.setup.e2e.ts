import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { openInEnglish } from './support.ts';

// Sign in once; tests that declare { session: 'admin' } start already signed in.
test.setup('sign in as the admin', { sessions: ['admin'] }, async ({ app, screen, session, browser }) => {
  const admin = credentials.user('admin');
  await openInEnglish(app, browser, '/login/');
  await screen.getByLabel('Access token').fill(admin.password);
  await screen.getByRole('button', 'Sign in with token').tap();
  await expect(screen.getByRole('heading', { name: 'Defluance', level: 1 })).toBeVisible();
  await expect(browser).toHaveURL('/');
  await session.save('admin');
});
