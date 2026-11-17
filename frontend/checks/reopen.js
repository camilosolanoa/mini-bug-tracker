// Run with Playwright CLI against the local app. Creates one synthetic bug.
async (page) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
    throw new Error('Run against the local app');
  }
  const api = path => new URL(`/api${path}`, page.url()).href;
  await page.request.post(api('/auth/login'), { data: { username: 'demo', password: 'bugtracker-demo' } });
  const title = `Reopening check ${Date.now()}`;
  const created = await page.request.post(api('/bugs'), {
    data: { title, description: 'Synthetic browser test.', severity: 'High' },
  });
  if (created.status() !== 201) throw new Error('Creation failed');
  const bug = await created.json();
  for (const status of ['In Progress', 'Ready for QA', 'Done']) {
    const result = await page.request.patch(api(`/bugs/${bug.id}/status`), { data: { status } });
    if (!result.ok()) throw new Error('Could not prepare Done bug');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const reason = card.getByLabel('Reason for reopening');
  await reason.waitFor();
  await card.getByRole('button', { name: 'Reopen bug', exact: true }).click();
  if (await reason.evaluate(element => element.validity.valid)) throw new Error('Blank reason was accepted');
  await reason.fill('   ');
  await card.getByRole('button', { name: 'Reopen bug', exact: true }).click();
  await page.getByRole('alert').getByText('A reason is required to reopen a Done bug.', { exact: true }).waitFor();
  await reason.fill('  Checkout still fails on Safari.  ');
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/bugs/${bug.id}/status`) && response.request().method() === 'PATCH');
  await card.getByRole('button', { name: 'Reopen bug', exact: true }).click();
  if ((await saved).status() !== 200) throw new Error('Reopening failed');
  await card.getByRole('button', { name: 'Move to In Progress', exact: true }).waitFor();
  await page.reload();
  await card.getByRole('button', { name: 'View history', exact: true }).click();
  await card.getByText('Done → Open', { exact: true }).waitFor();
  await card.getByText('Checkout still fails on Safari.', { exact: true }).waitFor();
  if (await card.locator('li').count() !== 5) throw new Error('Unexpected history count');
  const entries = await (await page.request.get(api(`/bugs/${bug.id}/history`))).json();
  if (entries.at(-1).reason !== 'Checkout still fails on Safari.') throw new Error('Reason was not persisted and trimmed');
  await card.screenshot({ path: 'output/playwright/reopen.png' });
  return 'PASS: empty/blank rejection, reopen, persisted history after refresh, mobile UI';
}
