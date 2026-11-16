// With the local app running and a Playwright CLI browser open:
// playwright-cli run-code --filename frontend/checks/status-layout.js
async (page) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
    throw new Error('Run this check against the local app; it creates a sample bug');
  }
  const api = path => new URL(`/api${path}`, page.url()).href;
  await page.request.post(api('/auth/login'), { data: { username: 'demo', password: 'bugtracker-demo' } });
  const title = `Status layout check ${Date.now()}`;
  const response = await page.request.post(api('/bugs'), {
    data: { title, description: 'Checkout fails after submitting a valid address.', severity: 'High' },
  });
  if (!response.ok()) throw new Error('Could not create the local test bug');
  const bug = await response.json();
  for (const status of ['In Progress', 'Ready for QA']) {
    const result = await page.request.patch(api(`/bugs/${bug.id}/status`), { data: { status } });
    if (!result.ok()) throw new Error('Could not prepare the QA test bug');
  }
  await page.setViewportSize({ width: 360, height: 844 });
  await page.reload();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: 'View history', exact: true }).click();
  await card.getByText('In Progress → Ready for QA', { exact: true }).waitFor();
  const button = card.getByRole('button', { name: 'Return to In Progress', exact: true });
  await button.scrollIntoViewIfNeeded();
  const measure = () => card.evaluate(element => ({
    top: element.getBoundingClientRect().top + window.scrollY,
    height: element.getBoundingClientRect().height,
    history: element.querySelectorAll('li').length,
  }));
  const before = await measure();
  let releasePatch, releaseGet, getStarted;
  const patchGate = new Promise(resolve => { releasePatch = resolve; });
  const getGate = new Promise(resolve => { releaseGet = resolve; });
  const getRequest = new Promise(resolve => { getStarted = resolve; });
  await page.route('**/api/bugs**', async route => {
    if (route.request().method() === 'PATCH') await patchGate;
    if (route.request().method() === 'GET') { getStarted(); await getGate; }
    await route.continue();
  });
  const failures = [];
  try {
    await button.click();
    await card.locator('.actions button:disabled').first().waitFor();
    const saving = await measure();
    if (Math.abs(saving.height - before.height) > 1) failures.push('Card height changes while saving');
    releasePatch();
    await getRequest;
    await page.waitForFunction(() => document.querySelector('[aria-labelledby=bugs-heading]').getAttribute('aria-busy') === 'true');
    const refreshing = await measure();
    if (Math.abs(refreshing.top - before.top) > 1) failures.push('Card shifts during background refresh');
    if (refreshing.history !== 3) failures.push('Existing history disappears during refresh');
  } finally {
    releasePatch();
    releaseGet();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await card.getByRole('button', { name: 'Move to Ready for QA', exact: true }).waitFor();
  await card.getByText('Ready for QA → In Progress', { exact: true }).waitFor();
  if (await card.locator('li').count() !== 4) failures.push('New history event was not shown');
  if (failures.length) throw new Error(failures.join('; '));
  return 'PASS: stable pending button layout, stable card position, history remains visible and updates';
}

