import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { unique } from './support.ts';

// Agent steps: a model reads the screen and acts from a goal. They need E2E_AGENT_MODEL (see README) and are
// excluded from `pnpm test:e2e`; run them with `pnpm test:agent`. Each pins its outcome with a deterministic check.
describe('agent flows', { tags: ['agent'], session: 'admin' }, () => {
  test('finds a note from a description and opens it', async ({ app, agent, browser }) => {
    await app.open('/');
    await agent.act('find the note about how login sessions expire and open it');
    await agent.assert('the page is the note titled Sessions');
    await expect(browser).toHaveURL(/\/n\/tech\/sessions\/?$/);
  });

  test('creates a functional spec in the produit folder', async ({ app, agent, screen, browser }) => {
    const title = unique('Audit trail');
    await app.open('/');
    await agent.act('create a new functional spec titled {title} in the folder produit', { params: { title } });
    await expect(browser).toHaveURL(/tab=edit/);
    await expect(screen.getByRole('textbox', 'Markdown editor')).toBeVisible();
  });

  test('answers a question and cites where it comes from', async ({ app, agent, screen }) => {
    await app.open('/');
    await agent.act('ask how long a password reset link is valid');
    await agent.assert('an answer is shown with at least one numbered source');
    await expect(screen.getByRole('list', 'Sources')).toBeVisible();
  });
});
