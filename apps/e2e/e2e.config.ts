import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';
import { TOKEN } from './tests/support.ts';

const app = {
  // Port 0: the runner picks a free one and expands {port} below.
  url: 'http://127.0.0.1:0',
  command: {
    executable: 'node',
    args: ['scripts/serve.mjs', '{port}'],
    env: { DFL_ADMIN_TOKEN: TOKEN, DFL_RATE_LIMIT: '0', DFL_PUBLIC_URL: 'http://127.0.0.1:{port}' },
    log: '.e2e/logs/app.log',
  },
  readyUrl: 'http://127.0.0.1:{port}/health',
};

export default {
  tests: 'tests/**/*.e2e.ts',
  // One server for all targets, so tests create their own notes and never assume a count of notes.
  targets: [
    { name: 'chromium', engine: web({ browser: 'chromium' }), app },
    { name: 'firefox', engine: web({ browser: 'firefox' }), app },
    { name: 'webkit', engine: web({ browser: 'webkit' }), app },
    { name: 'phone', engine: web({ browser: 'webkit', viewport: { width: 390, height: 844 } }), app },
  ],
  credentials: {
    admin: { username: 'admin', password: TOKEN },
  },
  // Agent steps need a model; without E2E_AGENT_MODEL the deterministic suite runs and `agent` tests are excluded.
  ...(process.env.E2E_AGENT_MODEL
    ? { agents: { default: { model: gateway(process.env.E2E_AGENT_MODEL), system: 'You are a careful QA agent for a Markdown spec tool. Verify every outcome on screen.' } } }
    : {}),
} satisfies E2EConfig;
