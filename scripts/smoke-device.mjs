// End-to-end test of on-device mode (WebLLM in the browser, no cloud AI for the text).
//   node scripts/smoke-device.mjs [baseUrl] [outDir]
// Env: MODEL (default the lighter Qwen2.5 1.5B), TOPIC, PROFILE (browser profile dir, keeps the model cached).
// The first run downloads the model (~0.9 GB for 1.5B), so allow several minutes.

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'smoke-device-shots';
const model = process.env.MODEL ?? 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const topic = process.env.TOPIC ?? 'How bubble sort works';
const profile = process.env.PROFILE ?? '.device-profile';
await mkdir(out, { recursive: true });

const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const ctx = await chromium.launchPersistentContext(profile, {
  channel: process.env.BROWSER ?? 'msedge',
  headless: process.env.HEADLESS !== '0',
  viewport: { width: 1440, height: 900 },
  // FORCE_DGPU=1 makes the browser use the discrete GPU on dual-GPU laptops (like Windows' 'High performance' graphics setting).
  args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', ...(process.env.FORCE_DGPU === '1' ? ['--force-high-performance-gpu'] : [])],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => console.log(`  REQUEST FAILED ${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url().slice(0, 160)}`); });
ctx.on('requestfailed', (r) => console.log(`  (ctx) REQUEST FAILED ${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [console.${m.type()}] ${m.text().slice(0, 400)}`); });

await page.goto(base);
await page.getByRole('radio', { name: /My device/ }).click();
await page.locator('.device-panel select').evaluate((el, m) => { if (![...el.options].some((o) => o.value === m)) el.add(new Option(m, m)); }, model);
await page.locator('.device-panel select').selectOption(model);
await page.locator('#topic').fill(topic);
const t0 = Date.now();
await page.getByRole('button', { name: 'Teach me' }).click();

// Report progress while the model downloads and writes.
let last = '';
const ticker = setInterval(async () => {
  const txt = (await page.locator('.loading-steps').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
  if (txt && txt !== last) console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
  last = txt;
}, 15000);

const outcome = await Promise.race([
  page.getByRole('button', { name: 'Start lesson', exact: true }).waitFor({ timeout: 25 * 60_000 }).then(() => 'ready'),
  page.locator('.field-error').waitFor({ timeout: 25 * 60_000 }).then(() => 'error'),
]);
clearInterval(ticker);
const secs = Math.round((Date.now() - t0) / 1000);
if (outcome === 'error') {
  console.log('Home error:', await page.locator('.field-error').innerText());
}
check(outcome === 'ready', `on-device lesson prepared in ${secs}s`);

if (outcome === 'ready') {
  const badges = await page.locator('.bar-meta').innerText();
  check(/On-device AI lesson/i.test(badges), `lesson is labelled as on-device (${badges.replace(/\s+/g, ' ')})`);
  const parts = await page.locator('.transcript-step').count();
  const lines = await page.locator('.transcript-line').count();
  console.log(`  lesson: ${parts} parts, ${lines} sentences`);
  await page.getByRole('button', { name: 'Start lesson', exact: true }).click();
  await page.waitForTimeout(8000);
  const items = await page.locator('.board-svg > g').count();
  check(items > 0, `board draws ${items} items after 8s`);
  await page.screenshot({ path: `${out}/device-lesson.png` });

  // Follow-up question answered by the on-device model.
  await page.getByRole('tab', { name: /Ask tutor/ }).click();
  await page.locator('#ask-input').fill('Can you explain that again more simply?');
  const ta = Date.now();
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.locator('.msg-tutor:not(.msg-typing), .msg-error').first().waitFor({ timeout: 5 * 60_000 });
  const answer = await page.locator('.msg-tutor:not(.msg-typing), .msg-error').first().innerText();
  check(!(await page.locator('.msg-error').count()), `on-device answer in ${Math.round((Date.now() - ta) / 1000)}s: "${answer.slice(0, 140)}"`);
  await page.screenshot({ path: `${out}/device-ask.png` });
}

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await ctx.close();
