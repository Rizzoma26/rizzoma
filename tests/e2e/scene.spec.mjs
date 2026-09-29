/* Статические данные сцены: дерево из заранее посчитанного ресурса
   (assets/generated/scene-data.js) и из запасного расчёта на месте
   совпадает до пикселя. Ресурс недоступен или посчитан для других
   входов — приложение не ломается, а считает сцену само. */
import { test, expect } from '@playwright/test';
import { open, boot } from './helpers.mjs';

/* отпечаток готового дерева: пиксели канвы и экранные позиции узлов */
async function treePrint(page){
  await page.waitForTimeout(600);                          // логотип-SVG грузится отдельно
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(200);
  return page.evaluate(async () => {
    const c = document.querySelector('#tree');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', px))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return {hash, w: c.width, h: c.height,
            nodes: [0,1,2,3,4,5,6,7,8,9].map(i => window.__RZ.node(i))};
  });
}

async function openTree(page, route){
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if(route) await page.route('**/assets/generated/scene-data.js*', route);
  await open(page, {query: '&reduce=1'});
  await boot(page);
  return errors;
}

test('сцена из ресурса совпадает с расчётом на месте до пикселя', async ({page, browser}) => {
  const errors = await openTree(page);
  expect(await page.evaluate(() => window.__RZ.scene())).toBe('resource');
  // расчёт в браузере даёт ровно числа генератора из Node
  expect(await page.evaluate(() => JSON.stringify(
    window.RIZZOMA_SCENE_GEOMETRY.build(window.RIZZOMA_ECONOMY)) === JSON.stringify(window.RIZZOMA_SCENE))).toBe(true);
  const fromResource = await treePrint(page);

  const other = await browser.newPage({viewport: page.viewportSize(), deviceScaleFactor: 2});
  const otherErrors = await openTree(other, r => r.fulfill({status: 404, body: ''}));
  expect(await other.evaluate(() => window.__RZ.scene())).toBe('computed');
  const computed = await treePrint(other);
  await other.close();

  expect(computed).toEqual(fromResource);
  expect([...errors, ...otherErrors]).toEqual([]);
});

test('ресурс для других входов не используется — сцена считается на месте', async ({page}) => {
  const errors = await openTree(page, async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/"version":"[0-9a-f]{8}"/, '"version":"00000000"');
    await route.fulfill({response: res, body});
  });
  expect(await page.evaluate(() => window.__RZ.scene())).toBe('computed');
  await expect.poll(() => page.evaluate(() => window.__RZ.node(0))).not.toBeNull();
  expect(errors).toEqual([]);
});
