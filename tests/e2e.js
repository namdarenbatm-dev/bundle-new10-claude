'use strict';
/* Optional browser test (needs Playwright + Chromium). Usage: node tests/e2e.js <baseUrl> [screenshotDir]
 * Example: serve the project under a sub-path, e.g. http://localhost:8080/techno-bundle/ */
const { chromium } = require('playwright');
const path = require('path');

const base = process.argv[2];
const shotDir = process.argv[3];
if (!base) { console.error('usage: node tests/e2e.js <baseUrl> [screenshotDir]'); process.exit(2); }

let failures = 0;
const log = (ok, msg) => { if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };
const digits = (s) => s.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const consoleProblems = [];
  const failedRequests = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleProblems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleProblems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url()); });

  /* --- splash --- */
  const t0 = Date.now();
  await page.goto(base);
  const splashText = await page.locator('#splash').innerText();
  log(splashText.includes('سامانه طراحی مدل فروش محصولات کارتخوان توسن تکنو') && splashText.includes('مهدی نامدار · نسخه ۱۰'), 'splash shows title and credit');
  log(await page.locator('#splash img').evaluate((i) => i.complete && i.naturalWidth > 0), 'splash logo loaded');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'splash.png') });
  await sleep(4200 - (Date.now() - t0));
  log(await page.locator('#splash').isVisible(), 'splash still visible at ~4.2s');
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 3000 });
  const gone = Date.now() - t0;
  log(gone >= 4800 && gone <= 5900, 'splash gone after ' + gone + ' ms (target ~5000)');

  /* --- admin defaults --- */
  const rows = await page.locator('#bundleRows tr').count();
  log(rows === 35, 'default bundle count = 35 (got ' + rows + ')');
  const first = (await page.locator('#bundleRows tr').first().innerText()).replace(/\s+/g, ' ');
  log(digits(first).replace(/\s/g, '').startsWith('1104'), 'rank 1 is 10 POS + 4 driver (same floor price as 10+5, fewer drivers): ' + digits(first).slice(0, 60));
  const r52 = digits((await page.locator('tr[data-id="5x2"]').innerText()).replace(/\s+/g, ' '));
  log(r52.includes('15,000,000') && r52.includes('159,000,000'), 'row 5x2 has price 15,000,000 and total 159,000,000');
  log(digits(await page.locator('#derived').innerText()).includes('15,000,000'), 'derived driver contribution 15,000,000 shown');
  log(digits(await page.inputValue('#f-bundlePrice')) === '21,000,000', 'bundle POS price box auto-fills 21,000,000 (20,000,000 + 1,000,000)');
  log(await page.locator('#f-bundlePrice').evaluate((i) => i.readOnly), 'bundle POS price box is read-only (computed)');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'admin.png'), fullPage: false });

  /* --- details modal --- */
  await page.click('#tab-bundles');
  const tr = page.locator('tr[data-id="5x2"]');
  const sw = await tr.locator('.switch').boundingBox();
  const det = await tr.locator('[data-act="details"]').boundingBox();
  log(Math.abs(sw.y - det.y) < 12 && Math.abs((sw.x - det.x)) < 220, 'Details button sits next to publish status');
  await tr.locator('[data-act="details"]').click();
  await page.waitForSelector('#detailsDialog[open]');
  const dlg = digits(await page.locator('#detailsDialog').innerText());
  log(['30,000,000', '21,000,000', '6,000,000', '15,000,000', '159,000,000'].every((x) => dlg.includes(x)), 'modal shows discount budget, bundle POS price, discount, final price and total');
  log(!/ذخیره بازاریابی/.test(dlg) && /فقط برای ساخت قیمت باندل/.test(dlg), 'modal presents marketing only as part of the bundle price');
  log(await page.locator('#detailsDialog').evaluate((d) => d.matches(':modal')), 'details open as a true modal dialog');
  await sleep(400);
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'details.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('detailsDialog').open);
  log((await page.locator('#bundleTable').locator('text=محاسبات').count()) === 0, 'details are not left under the table');
  log(dlg.includes('قیمت واقعی کش‌لس در بسته') && dlg.includes('27,000,000') && dlg.includes('فقط گزارش مدیریتی'), 'details modal shows the real cashless price (27,000,000 for 5x2)');
  await page.click('#tab-admin');

  /* --- validation --- */
  await page.fill('#f-posFloor', '25000000');
  log((await page.locator('#e-posFloor').innerText()).includes('کف قیمت'), 'floor > base shows an error');
  log((await page.locator('#bundleRows tr').count()) === 0, 'no bundles while settings invalid');
  await page.fill('#f-posFloor', '12.5');
  log((await page.locator('#e-posFloor').innerText()).includes('عدد صحیح'), 'decimal input rejected');
  await page.fill('#f-posFloor', '۱۵٬۰۰۰٬۰۰۰');
  await page.locator('#f-posFloor').blur();
  log((await page.locator('#bundleRows tr').count()) === 35, 'Persian digits accepted; bundles return');
  await page.fill('#f-marketing', '10000000');
  log(digits(await page.inputValue('#f-bundlePrice')) === '30,000,000', 'bundle POS price box updates live when marketing changes (30,000,000)');
  const rowsBigMk = await page.locator('#bundleRows tr').count();
  const r52mk = digits((await page.locator('tr[data-id="5x2"]').innerText()).replace(/\s+/g, ' '));
  log(rowsBigMk === 35 && r52mk.includes('24,000,000') && r52mk.includes('204,000,000'), 'marketing does not shrink the discount budget: still 35 bundles, 5x2 = 24,000,000 each / 204,000,000 total');
  await page.fill('#f-marketing', '1000000');

  /* --- ranking --- */
  const before = digits(await page.locator('#bundleRows tr').first().getAttribute('data-id'));
  await page.locator('#prioList button[data-i="3"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="2"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="1"][data-move="-1"]').click();
  const after = await page.locator('#bundleRows tr').first().getAttribute('data-id');
  log(before === '10x4' && after !== before, 'reordering priorities changes ranking (' + before + ' -> ' + after + ')');
  log((await page.locator('#prioList li').first().innerText()).includes('مبلغ کل'), 'total moved to first priority');
  await page.reload();
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await page.locator('#prioList li').first().innerText()).includes('مبلغ کل'), 'priority order persisted after reload');
  await page.locator('#resetBtn').click();
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmOk').click();
  await page.waitForFunction(() => document.querySelector('#prioList li').innerText.includes('تعداد کارتخوان'), null, { timeout: 3000 }).catch(() => {});
  log((await page.locator('#prioList li').first().innerText()).includes('تعداد کارتخوان'), 'reset defaults restores default ranking');

  /* --- publish + broker --- */
  await page.click('#tab-broker');
  log((await page.locator('#brokerResult').innerText()).includes('هنوز باندلی منتشر نشده'), 'broker sees nothing before publishing');
  await page.click('#tab-bundles');
  for (const id of ['5x2', '6x2', '7x2', '8x3']) await page.locator(`tr[data-id="${id}"] .switch`).click();
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'publish toggle works');
  await page.locator('tr[data-id="6x2"] .switch').click();
  log((await page.locator('tr[data-id="6x2"] .switch').getAttribute('aria-checked')) === 'false', 'unpublish toggle works');
  await page.click('#tab-broker');
  await page.fill('#brokerBudget', '170000000');
  let txt = digits(await page.locator('#brokerResult').innerText());
  const mainCards = await page.locator('.offer.main').count();
  const upCards = await page.locator('.offer.upgrade').count();
  log(mainCards === 1 && upCards <= 1, 'broker sees exactly 1 main and at most 1 upgrade (' + mainCards + '/' + upCards + ')');
  log(txt.includes('159,000,000') || txt.includes('5 کارتخوان'), 'main recommendation is 5+2 for budget 170M');
  const upText = upCards ? digits(await page.locator('.offer.upgrade').innerText()) : '';
  if (upCards) {
    const m = /پرداخت اضافه نسبت به بودجه شما: ([\d,]+)/.exec(upText);
    log(m && Number(m[1].replace(/,/g, '')) <= 10000000, 'upgrade additional payment within cap: ' + (m && m[1]));
  } else log(true, 'no upgrade offered for this budget');
  await page.fill('#brokerBudget', '230000000');
  const m2 = /پرداخت اضافه نسبت به بودجه شما: ([\d,]+)/.exec(digits(await page.locator('#brokerResult').innerText()));
  log(!m2 || Number(m2[1].replace(/,/g, '')) <= 10000000, 'upgrade within cap at 230M budget' + (m2 ? ' (' + m2[1] + ')' : ' (none)'));
  await page.fill('#brokerBudget', '5000000');
  log((await page.locator('#brokerResult').innerText()).includes('باندلی در دسترس نیست'), 'unaffordable budget shows message');
  await page.fill('#brokerBudget', '170000000');
  const brokerText = await page.locator('#view-broker').innerText();
  log(!/بهای تمام|سود|بازاریابی|کف رقابتی|بودجه تخفیف/.test(brokerText.replace('بودجه شما برای خرید', '')), 'broker view leaks no cost/profit/marketing/floor wording');
  log((await page.locator('#brokerClear').isVisible()), 'broker page has a data-clear button');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'broker.png'), fullPage: true });

  /* --- persistence --- */
  await page.reload();
  await page.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await page.locator('#tab-broker').getAttribute('aria-selected')) === 'true' && (await page.inputValue('#brokerBudget')).length > 0, 'tab and broker budget persisted');
  await page.click('#tab-bundles');
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'published state persisted');

  /* --- CSV --- */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvBtn')]);
  const csvPath = await dl.path();
  const csv = require('fs').readFileSync(csvPath, 'utf8');
  log(csv.charCodeAt(0) === 0xfeff && csv.trim().split('\r\n').length === 36, 'CSV has BOM and 35 data rows; file ' + dl.suggestedFilename());

  /* --- share link -> new broker device --- */
  await page.click('#shareBtn');
  await page.waitForSelector('#shareDialog[open]');
  const link = await page.inputValue('#shareText');
  log(link.includes('#offer=') && !/posFloor|driverCost|marketing/.test(link), 'share link built: ' + link.length + ' chars');
  await page.click('#shareCopy');
  await page.keyboard.press('Escape');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx2.newPage();
  const p2errors = [];
  p2.on('pageerror', (e) => p2errors.push(e.message));
  await p2.goto(link);
  await p2.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await p2.locator('#tab-broker').getAttribute('aria-selected')) === 'true' && !(await p2.locator('.tabs').isVisible()), 'offer link opens broker-only mode');
  log(p2.url().indexOf('#offer') === -1, 'offer hash removed from URL after import');
  await p2.fill('#brokerBudget', '170000000');
  log((await p2.locator('.offer.main').count()) === 1, 'broker device shows recommendation from imported offer');
  const t2 = digits(await p2.locator('.offer.main').innerText());
  log(t2.includes('159,000,000'), 'total recomputed on broker device: 159,000,000');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(overflow <= 1, 'no horizontal page scroll at 390px (overflow ' + overflow + ')');
  if (shotDir) await p2.screenshot({ path: path.join(shotDir, 'broker-mobile.png'), fullPage: true });
  const bad = await p2.goto(base + '#offer=AAAA');
  await sleep(300);
  log(p2errors.length === 0, 'no page errors on broker device');
  await ctx2.close();

  /* --- admin mobile --- */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const mp = await mctx.newPage();
  await mp.goto(base);
  await mp.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  const mo = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(mo <= 1, 'admin: no horizontal page scroll at 390px (overflow ' + mo + ')');
  if (shotDir) await mp.screenshot({ path: path.join(shotDir, 'admin-mobile.png') });
  await mctx.close();

  /* --- service worker / offline --- */
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cache = keys.length ? await (await caches.open(keys[0])).keys() : [];
    return { scope: reg && reg.scope, active: !!(reg && reg.active), keys, count: cache.length, controlled: !!navigator.serviceWorker.controller };
  });
  log(swInfo.active && swInfo.scope === base.replace(/index\.html$/, ''), 'service worker active with scope ' + swInfo.scope);
  log(swInfo.keys.length === 1 && /^techno-bundle-v10/.test(swInfo.keys[0]) && swInfo.count === 13, 'versioned cache ' + swInfo.keys + ' holds ' + swInfo.count + ' files');
  log(swInfo.controlled, 'page is controlled by the service worker');
  await ctx.setOffline(true);
  const off = await ctx.newPage();
  const offErr = [];
  off.on('pageerror', (e) => offErr.push(e.message));
  await off.goto(base);
  await off.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
  log((await off.locator('#bundleRows tr').count()) === 35, 'OFFLINE: app loads and calculates 35 bundles');
  await off.locator('tr[data-id="5x2"] [data-act="details"]').click();
  log(digits(await off.locator('#detailsDialog').innerText()).includes('159,000,000'), 'OFFLINE: core calculation (159,000,000) works');
  const fontOk = await off.evaluate(() => document.fonts.check('16px Yekan'));
  log(fontOk, 'OFFLINE: Yekan font available');
  log(offErr.length === 0, 'OFFLINE: no page errors');
  await ctx.setOffline(false);
  await off.close();

  /* --- bundles page: real cashless column, Excel-style filter/sort, formulas page --- */
  await page.click('#tab-bundles');
  const heads = await page.locator('#headRow th').allInnerTexts();
  log(heads.length === 9 && heads.some((h) => h.trim() === 'قیمت واقعی کش‌لس در بسته'), 'table has the exact column «قیمت واقعی کش‌لس در بسته» (' + heads.length + ' columns)');
  const realCheck = await page.evaluate(() => {
    const C = window.TechnoCore;
    const map = {};
    C.generateBundles(C.DEFAULT_SETTINGS).forEach((b) => { map[b.id] = b.realDriverPrice; });
    const toNum = (t) => Number(t.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[^0-9]/g, ''));
    let bad = 0; const vals = new Set();
    document.querySelectorAll('#bundleRows tr').forEach((tr) => {
      const v = toNum(tr.children[7].textContent); vals.add(v);
      if (v !== map[tr.getAttribute('data-id')]) bad++;
    });
    return { bad, distinct: vals.size };
  });
  log(realCheck.bad === 0 && realCheck.distinct > 1, 'real cashless column matches the core value for every row and differs between bundles (' + realCheck.distinct + ' distinct)');
  const t52 = digits((await page.locator('tr[data-id="5x2"]').innerText()).replace(/\s+/g, ' '));
  log(t52.includes('159,000,000') && t52.includes('15,000,000'), 'recorded POS price and total unchanged by the new column');

  // sort descending by total
  await page.locator('#headRow button[data-col="total"]').click();
  log(await page.locator('#colMenu').isVisible(), 'column menu opens from the header');
  await page.locator('#colMenu button[data-cm="desc"]').click();
  const tots = await page.evaluate(() => [...document.querySelectorAll('#bundleRows tr')].map((tr) => Number(tr.children[5].textContent.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[^0-9]/g, ''))));
  log(tots.length === 35 && tots.every((v, i) => i === 0 || tots[i - 1] >= v), 'sort descending by total works');
  log((await page.locator('#headRow th').nth(5).getAttribute('aria-sort')) === 'descending', 'aria-sort set on the sorted column');
  await page.locator('#colMenu button[data-cm="asc"]').click();
  const tots2 = await page.evaluate(() => [...document.querySelectorAll('#bundleRows tr')].map((tr) => Number(tr.children[5].textContent.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0).replace(/[^0-9]/g, ''))));
  log(tots2.every((v, i) => i === 0 || tots2[i - 1] <= v), 'sort ascending by total works');
  const rk = await page.evaluate(() => [...document.querySelectorAll('#bundleRows tr')].map((tr) => tr.children[0].textContent).join(','));
  log(rk !== [...Array(35).keys()].map((i) => i + 1).join(','), 'rank column keeps the priority rank while sorted');
  await page.keyboard.press('Escape');
  log(!(await page.locator('#colMenu').isVisible()), 'Escape closes the column menu');

  // value filter on POS quantity
  await page.locator('#headRow button[data-col="posQty"]').click();
  await page.locator('#colMenu button[data-cm="none"]').click();
  await page.locator('#colMenu input[data-val="5"]').check();
  const qtys = await page.evaluate(() => [...document.querySelectorAll('#bundleRows tr')].map((tr) => tr.children[1].textContent.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0)));
  log(qtys.length === 4 && qtys.every((q) => q === '5'), 'value filter keeps only 5-POS bundles (' + qtys.length + ' rows)');
  log((await page.locator('#chips .chip').count()) >= 1 && (await page.locator('#clearFilters').isVisible()), 'active-filter chips and clear button shown');
  log(digits(await page.locator('#stats').innerText()).includes('4 از 35'), 'stats show filtered count 4 of 35');
  await page.keyboard.press('Escape');
  const pubBefore6 = await page.locator('tr[data-id="5x1"] .switch').count();
  await page.click('#pubAllBtn');
  log((await page.locator('tr[data-id="5x1"] .switch').getAttribute('aria-checked')) === 'true' && pubBefore6 === 1, 'publish applies to the filtered rows');
  await page.click('#clearFilters');
  log((await page.locator('#bundleRows tr').count()) === 35, 'clear filters restores all 35 rows');
  log((await page.locator('tr[data-id="6x1"] .switch').getAttribute('aria-checked')) === 'false', 'rows outside the filter were not published');
  await page.check('#onlyPub');
  const pubOnly = await page.locator('#bundleRows tr').count();
  const pubSw = await page.locator('#bundleRows .switch[aria-checked="true"]').count();
  log(pubOnly > 0 && pubOnly === pubSw, 'only-published quick filter works (' + pubOnly + ' rows)');
  await page.uncheck('#onlyPub');
  // dashboard changes must not be needed for the admin form: admin page still has no table
  log((await page.locator('#view-admin #bundleTable').count()) === 0, 'admin page no longer embeds the table (separate bundles page)');

  await page.click('#tab-formulas');
  const ft = digits(await page.locator('#view-formulas').innerText());
  log(ft.includes('قیمت واقعی کش‌لس در بسته') && ft.includes('29,500,000') && ft.includes('27,000,000') && ft.includes('2,500,000') && ft.includes('5,000,000'), 'formulas page is in Persian and shows the 29,500,000 worked example');
  await page.click('#tab-admin');

  /* --- clear data --- */
  await page.click('#clearBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmDialog button[value="cancel"]').click();
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'clear-data cancel keeps data');
  await page.click('#clearBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmOk').click();
  await page.waitForFunction(() => document.querySelector('tr[data-id="5x2"] .switch').getAttribute('aria-checked') === 'false', null, { timeout: 3000 }).catch(() => {});
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'false', 'clear-data confirm wipes published state');
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('technoBundle10:')));
  log(left.length === 0, 'localStorage keys cleared (' + left.length + ' left)');

  /* --- broker "clear data" button must only clear the broker page --- */
  await page.fill('#f-posBase', '19000000');
  await page.locator('#prioList button[data-i="3"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="2"][data-move="-1"]').click();
  await page.locator('#prioList button[data-i="1"][data-move="-1"]').click();
  await page.click('#tab-bundles');
  if ((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) !== 'true') await page.locator('tr[data-id="5x2"] .switch').click();
  const adminBefore = await page.evaluate(() => ({ s: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':settings'))), p: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':priorities'))), pub: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':published'))) }));
  await page.click('#tab-broker');
  await page.fill('#brokerBudget', '170000000');
  await page.click('#brokerClear');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmDialog button[value="cancel"]').click();
  await sleep(200);
  log((await page.inputValue('#brokerBudget')).length > 0, 'broker clear: cancel keeps data');
  await page.click('#brokerClear');
  await page.waitForSelector('#confirmDialog[open]');
  await page.locator('#confirmOk').click();
  await page.waitForFunction(() => document.querySelector('#brokerBudget').value === '', null, { timeout: 3000 }).catch(() => {});
  log((await page.inputValue('#brokerBudget')) === '' && (await page.locator('#tab-broker').getAttribute('aria-selected')) === 'true', 'broker clear: broker budget emptied, stays on broker page');
  const adminAfter = await page.evaluate(() => ({ s: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':settings'))), p: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':priorities'))), pub: localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':published'))) }));
  log(adminBefore.s === adminAfter.s && adminBefore.p === adminAfter.p && adminBefore.pub === adminAfter.pub, 'broker clear: stored admin settings, priorities and published flags are byte-identical');
  await page.click('#tab-admin');
  log(digits(await page.inputValue('#f-posBase')) === '19,000,000' && digits(await page.inputValue('#f-bundlePrice')) === '20,000,000', 'broker clear: admin prices unchanged (19,000,000 / 20,000,000)');
  log((await page.locator('#prioList li').first().innerText()).includes('مبلغ کل'), 'broker clear: admin priorities unchanged');
  await page.click('#tab-bundles');
  log((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) === 'true', 'broker clear: published bundles unchanged');
  await page.click('#tab-admin');
  await page.fill('#f-posBase', '20000000');

  /* --- broker clear on a broker-only device (opened from a link) --- */
  {
    await page.click('#tab-bundles');
    if ((await page.locator('tr[data-id="5x2"] .switch').getAttribute('aria-checked')) !== 'true') await page.locator('tr[data-id="5x2"] .switch').click();
    await page.click('#shareBtn');
    await page.waitForSelector('#shareDialog[open]');
    const link2 = await page.inputValue('#shareText');
    await page.keyboard.press('Escape');
    const c3 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const p3 = await c3.newPage();
    await p3.goto(link2);
    await p3.waitForSelector('#splash', { state: 'hidden', timeout: 8000 });
    await p3.fill('#brokerBudget', '170000000');
    log((await p3.locator('.offer.main').count()) === 1, 'broker device: offer loaded');
    await p3.click('#brokerClear');
    await p3.waitForSelector('#confirmDialog[open]');
    await p3.locator('#confirmOk').click();
    await p3.waitForFunction(() => !document.body.classList.contains('broker-mode'), null, { timeout: 3000 }).catch(() => {});
    log(!(await p3.evaluate(() => document.body.classList.contains('broker-mode'))) && (await p3.locator('.offer.main').count()) === 0 && (await p3.inputValue('#brokerBudget')) === '', 'broker device: clear removes the imported offer and budget');
    await c3.close();
  }
  await page.click('#tab-bundles');

  /* --- print stylesheet --- */
  await page.emulateMedia({ media: 'print' });
  log(!(await page.locator('.settings').isVisible()) && (await page.locator('#bundleTable').isVisible()), 'print media hides settings, keeps table');
  await page.pdf({ path: shotDir ? path.join(shotDir, 'admin.pdf') : undefined, format: 'A4' }).catch(() => {});

  /* --- summary --- */
  const realProblems = consoleProblems.filter((m) => !/Failed to load resource.*(offline|ERR_INTERNET)/i.test(m));
  log(realProblems.length === 0, 'console: no errors/warnings' + (realProblems.length ? ' -> ' + realProblems.join(' | ') : ''));
  const reqs = failedRequests.filter((u) => !/ERR_INTERNET|offline/.test(u));
  log(reqs.length === 0, 'network: no failed requests / 4xx' + (reqs.length ? ' -> ' + reqs.join(' | ') : ''));

  await browser.close();
  console.log(failures ? '\n' + failures + ' e2e check(s) FAILED' : '\nAll e2e checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
