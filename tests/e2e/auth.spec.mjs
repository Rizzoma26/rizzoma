import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const bootstrap = await readFile(new URL('../../docker/bootstrap.js', import.meta.url), 'utf8');
test.beforeEach(async ({page}) => {
  await page.route('https://telegram.org/**', route => route.fulfill({body:'',contentType:'text/javascript'}));
  await page.route('**/bootstrap.js', route => route.fulfill({body:bootstrap,contentType:'text/javascript'}));
});

test('ordinary browser and fake Telegram metadata stay on the public shell', async ({page}) => {
  let registrations=0;
  await page.route('**/api/v1/registrations/telegram', route => { registrations++; return route.fulfill({status:401}); });
  await page.goto('/docker/bootstrap.html');
  await expect(page.locator('#status')).toHaveText('Откройте приложение через бота.');
  await page.addInitScript(()=>{window.Telegram={WebApp:{platform:'android',initDataUnsafe:{user:{id:42}}}};});
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Откройте приложение через бота.');
  expect(registrations).toBe(0);
});

test('denied server exchange never navigates to protected UI', async ({page}) => {
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'synthetic-invalid-data'}};});
  await page.route('**/api/v1/registrations/telegram', route=>route.fulfill({status:403}));
  await page.goto('/docker/bootstrap.html');
  await expect(page.locator('#status')).toContainText('Вход недоступен');
  expect(new URL(page.url()).pathname).toBe('/docker/bootstrap.html');
});

test('successful exchange preserves launch fragment and referral on navigation', async ({page}) => {
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'start_param=ref_ABC123&hash=synthetic'}};});
  await page.route('**/api/v1/registrations/telegram', async route=>{
    expect(route.request().postDataJSON()).toEqual({initData:'start_param=ref_ABC123&hash=synthetic',referralCode:'ABC123'});
    await route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  // This checks bootstrap navigation, not nginx or the real session exchange.
  await page.route('**/app.html?*', route=>route.fulfill({contentType:'text/html',body:'<p>protected fixture</p>'}));
  await page.goto('/docker/bootstrap.html?mode=admin#tgWebAppData=synthetic');
  await expect(page).toHaveURL(/\/app\.html\?mode=admin#tgWebAppData=synthetic$/);
});
