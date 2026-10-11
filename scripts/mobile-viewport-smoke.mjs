import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.MERMAID_BASE_URL ?? 'http://127.0.0.1:4173/';
const output = process.env.MERMAID_SCREENSHOTS ?? 'artifacts/mobile-viewport';
const browser = await chromium.launch({ headless: true });
const widths = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

const diagram = 'flowchart TD\nA[Start] --> B{Ready?}\nB -->|Yes| C[Done]\nB -->|No| D[Retry]';

async function overflow(page, width, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  console.log(label, JSON.stringify(metrics));
  assert.ok(metrics.documentWidth <= width + 2, label + ': horizontal document overflow');
  assert.ok(metrics.bodyWidth <= width + 2, label + ': horizontal body overflow');
}

async function rendered(page) {
  await page.waitForFunction(() => {
    const visible = document.querySelector('[data-testid="workspace-preview"]');
    if (!visible) return false;
    return Array.from(visible.querySelectorAll('svg')).some(
      (svg) => svg.textContent?.includes('Start') && svg.textContent?.includes('Done'),
    );
  }, null, { timeout: 20_000 });
}

try {
  await mkdir(output, { recursive: true });
  for (const viewport of widths) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const group = page.getByRole('group', { name: 'Workspace view' });
      await group.waitFor({ state: 'visible', timeout: 35_000 });
      assert.equal(await group.getByRole('button', { name: 'Simple' }).getAttribute('aria-pressed'), 'true');
      await overflow(page, viewport.width, 'initial ' + viewport.width);

      await group.getByRole('button', { name: 'Studio' }).click();
      // Persistence is project-scoped: make an explicit new local project before editing.
      await page.getByRole('button', { name: 'New', exact: true }).click();
      const mobile = viewport.width < 768;
      const nav = page.getByRole('navigation', { name: 'Mobile Studio panes' });
      if (mobile) {
        assert.equal(await nav.isVisible(), true);
        await nav.getByRole('button', { name: 'Code' }).click();
      } else {
        assert.equal(await nav.isVisible(), false);
      }
      const editor = page.getByTestId('workspace-code');
      await editor.waitFor({ state: 'visible', timeout: 10_000 });
      const textarea = editor.locator('textarea').first();
      await textarea.fill(diagram);
      if (mobile) {
        await nav.getByRole('button', { name: 'Preview' }).click();
        await page.getByTestId('workspace-preview').waitFor({ state: 'visible' });
      }
      await rendered(page);
      await overflow(page, viewport.width, 'preview ' + viewport.width);
      if (mobile) {
        await nav.getByRole('button', { name: 'Code' }).click();
        assert.equal(await textarea.inputValue(), diagram);
        await nav.getByRole('button', { name: 'Chat' }).click();
        assert.equal(await page.getByTestId('workspace-chat').isVisible(), true);
        await overflow(page, viewport.width, 'chat ' + viewport.width);
      }

      await group.getByRole('button', { name: 'Simple' }).click();
      await page.getByTestId('workspace-preview').waitFor({ state: 'visible' });
      await rendered(page);
      await overflow(page, viewport.width, 'simple ' + viewport.width);
      await page.screenshot({ path: output + '/simple-' + viewport.width + '.png', fullPage: true });
      await page.waitForTimeout(1500);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await group.getByRole('button', { name: 'Simple' }).waitFor({ state: 'visible', timeout: 35_000 });
      assert.equal(await group.getByRole('button', { name: 'Simple' }).getAttribute('aria-pressed'), 'true');
      await rendered(page);
      await overflow(page, viewport.width, 'reload ' + viewport.width);
      await page.screenshot({ path: output + '/reload-' + viewport.width + '.png', fullPage: true });
      assert.equal(errors.length, 0, 'uncaught browser errors: ' + errors.join('; '));
      console.log('PASS viewport', viewport.width, 'x', viewport.height);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
