// Browser smoke test of the main learner flow, using the system Edge/Chrome.
//   node scripts/smoke.mjs [baseUrl] [screenshotDir]
// Plays a sample lesson, checks the board fills in, seeks backwards and checks
// the board rewinds, opens the Ask and Quiz tabs, and saves screenshots.

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:5180';
const out = process.argv[3] ?? 'smoke-shots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER ?? 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url()}`); });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const boardCount = () => page.locator('.board-svg > g').count();

// Track how many audio nodes are connected to the speakers (catches "plays silently" bugs).
await page.addInitScript(() => {
  window.__mediaEls = [];
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { if (!window.__mediaEls.includes(this)) window.__mediaEls.push(this); return origPlay.call(this); };
  window.__speakerLinks = 0;
  const connect = AudioNode.prototype.connect;
  const disconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      this.__toSpeakers = true;
      window.__speakerLinks++;
    }
    return connect.call(this, dest, ...rest);
  };
  AudioNode.prototype.disconnect = function (...args) {
    if (this.__toSpeakers) {
      this.__toSpeakers = false;
      window.__speakerLinks--;
    }
    return disconnect.apply(this, args);
  };
});

await page.goto(base);
await page.getByRole('heading', { level: 1 }).waitFor();
await page.screenshot({ path: `${out}/1-home.png`, fullPage: true });
const sampleCards = await page.locator('.sample-card').count();
check(sampleCards > 0, `home lists ${sampleCards} sample lessons`);

await page.locator('.sample-card').first().click();
await page.getByRole('button', { name: 'Start lesson', exact: true }).waitFor({ timeout: 60000 });
check(true, 'sample narration loaded');
await page.getByRole('button', { name: 'Start lesson', exact: true }).click();
await page.waitForTimeout(9000);
const audible = await page.evaluate(() => [...document.querySelectorAll('audio'), ...(window.__mediaEls ?? [])].some((a) => !a.paused && !a.muted && a.volume > 0 && a.currentTime > 0));
check(audible, 'narration audio element is playing, unmuted, during playback');
const n1 = await boardCount();
check(n1 > 0, `board has ${n1} items after 9s of playback`);
await page.screenshot({ path: `${out}/2-playing.png` });

check((await page.locator('.board-wrap .video-chrome .player').count()) === 1, 'playback controls are overlaid on the board');
// Click pause then play with the mouse (leaves focus on the button), then rest the pointer on the board.
const hoverBox = await page.locator('.board-wrap').boundingBox();
await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.getByRole('button', { name: 'Play', exact: true }).click();
const restBox = await page.locator('.board-wrap').boundingBox();
await page.mouse.move(restBox.x + restBox.width * 0.7, restBox.y + restBox.height * 0.3);
await page.waitForTimeout(3200);
const playerOpacity = await page.locator('.video-chrome .player').evaluate((el) => getComputedStyle(el).opacity);
check(playerOpacity === '0', `controls fade out after clicking play and resting the mouse on the board (opacity ${playerOpacity})`);
check(await page.locator('.board-wrap').evaluate((el) => el.classList.contains('is-idle')), 'controls auto-hide while playing and idle');
await page.screenshot({ path: `${out}/2b-idle.png` });
const wrapBox = await page.locator('.board-wrap').boundingBox();
await page.mouse.move(wrapBox.x + wrapBox.width / 2, wrapBox.y + wrapBox.height - 30);
check(!(await page.locator('.board-wrap').evaluate((el) => el.classList.contains('is-idle'))), 'moving the pointer over the board shows the controls');

// Captions toggle (CC button), like YouTube.
await page.mouse.move(wrapBox.x + wrapBox.width / 2, wrapBox.y + wrapBox.height / 2);
const capsBefore = await page.locator('.video-caption').count();
await page.getByRole('button', { name: 'Captions' }).click();
await page.waitForTimeout(200);
const capsOff = await page.locator('.video-caption').count();
await page.getByRole('button', { name: 'Captions' }).click();
await page.waitForTimeout(200);
check(capsBefore === 1 && capsOff === 0 && (await page.locator('.video-caption').count()) === 1, 'CC button hides and shows captions');

const scrub = page.getByRole('slider', { name: 'Seek' });
await page.keyboard.press('Space'); // pause
const pausedAt = Number(await scrub.inputValue());
await page.waitForTimeout(1500);
check(Math.abs(Number(await scrub.inputValue()) - pausedAt) < 0.05, 'pause freezes the clock');

await scrub.fill('0.5');
await page.waitForTimeout(300);
const n0 = await boardCount();
check(n0 < n1, `seeking back to 0.5s rewinds the board (${n1} -> ${n0} items)`);

await scrub.fill(String(pausedAt));
await page.waitForTimeout(300);
check((await boardCount()) === n1, 'seeking forward again restores the same board');

const max = Number(await scrub.getAttribute('max'));
await scrub.fill(String(max * 0.6));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-midway.png` });

await page.getByRole('tab', { name: /Ask tutor/ }).click();
await page.screenshot({ path: `${out}/4-ask.png` });
await page.getByRole('tab', { name: /Quiz/ }).click();
const qs = await page.locator('.quiz-q').count();
check(qs > 0, `quiz shows ${qs} questions`);
await page.locator('.quiz-q').first().locator('.quiz-opt').first().click();
await page.screenshot({ path: `${out}/5-quiz.png` });

// Learner pen: draw a loop around the middle of the board, then ask about it.
await page.getByRole('button', { name: /^Draw/ }).click();
const box = await page.locator('.board-wrap').boundingBox();
const cx = box.x + box.width * 0.3;
const cy = box.y + box.height * 0.45;
await page.mouse.move(cx - 60, cy);
await page.mouse.down();
for (let a = 0; a <= 360; a += 20) {
  await page.mouse.move(cx + Math.cos((a * Math.PI) / 180) * 120, cy + Math.sin((a * Math.PI) / 180) * 60);
}
await page.mouse.up();
check((await page.locator('.pen-stroke').count()) === 1, 'learner can draw a stroke on the board');
await page.screenshot({ path: `${out}/6-pen.png` });
await page.getByRole('button', { name: 'Ask about my drawing' }).click();
const draft = await page.locator('#ask-input').inputValue();
check(draft.length > 0 && (await page.getByRole('tab', { name: /Ask tutor/ }).getAttribute('aria-selected')) === 'true', 'ask-about-drawing opens the question box with a prompt');
await page.getByRole('button', { name: 'Undo' }).click();
check((await page.locator('.pen-stroke').count()) === 0, 'undo removes the stroke');

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/7-mobile.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!overflow, 'no horizontal scroll at 390px');

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
