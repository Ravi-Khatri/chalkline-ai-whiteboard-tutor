// Layout check of the lesson page across desktop sizes (no page scrollbar,
// panel aligned with the board, layout centred).
//   node scripts/layout-check.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173';
const shotDir = process.argv[3];
const b = await chromium.launch({ channel: 'msedge' });
const sizes = [[3840, 2160], [2560, 1440], [1920, 1080], [1920, 900], [1536, 864], [1440, 900], [1366, 768], [1280, 720], [1100, 700]];
for (const [w, h] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(base);
  await p.locator('.sample-card').nth(1).click();
  await p.getByRole('button', { name: 'Start lesson', exact: true }).waitFor({ timeout: 60000 });
  const m = await p.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const board = r('.board-wrap'), side = r('.side'), foot = r('.stage-foot');
    return {
      scroll: document.documentElement.scrollHeight, view: innerHeight,
      boardW: Math.round(board.width), boardH: Math.round(board.height),
      leftGap: Math.round(board.left), rightGap: Math.round(innerWidth - side.right),
      panelW: Math.round(side.width), alignDiff: Math.round(side.bottom - foot.bottom),
      fill: Math.round(((foot.bottom - board.top) / (innerHeight - 72)) * 100),
    };
  });
  const ok = m.scroll <= m.view && Math.abs(m.alignDiff) <= 2 && Math.abs(m.leftGap - m.rightGap) <= 4;
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${w}x${h}: board ${m.boardW}x${m.boardH}, panel ${m.panelW}w, margins L${m.leftGap}/R${m.rightGap}, panel-vs-board bottom ${m.alignDiff}px, height used ${m.fill}%, page ${m.scroll}/${m.view}`);
  if (shotDir && (w === 2560 || w === 1920 && h === 1080)) await p.screenshot({ path: `${shotDir}/fit-${w}x${h}.png` });
  await p.close();
}
await b.close();
