/*
 * Techno Bundle v10 — core business logic (pure, no DOM).
 * All money values are integer toman. Works in the browser (window.TechnoCore)
 * and in Node (require) so the same code is unit-tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TechnoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 10;
  var MAX_MONEY = 1000000000000; // 1e12 toman — keeps all products < 2^53
  var MAX_QTY = 100;

  var FIELDS = [
    'posBase', 'posFloor', 'marketing', 'driverCost', 'driverPrice',
    'driverProfit', 'maxPos', 'maxDriver', 'maxUpgrade'
  ];

  var DEFAULT_SETTINGS = {
    driverType: 'cashless', // 'cashless' | 'used'
    posBase: 20000000,
    posFloor: 15000000,
    marketing: 1000000,
    driverCost: 25000000,
    driverPrice: 42000000,
    driverProfit: 2000000,
    maxPos: 10,
    maxDriver: 5,
    maxUpgrade: 10000000
  };

  var PRIORITY_KEYS = ['posQty', 'posPrice', 'driverQty', 'total', 'remaining'];
  var DEFAULT_PRIORITIES = PRIORITY_KEYS.slice();
  // direction: -1 = larger is better (descending), 1 = smaller is better
  var PRIORITY_DIR = { posQty: -1, posPrice: 1, driverQty: 1, total: 1, remaining: -1 };

  var FIELD_LABELS = {
    posBase: 'قیمت مصوب کارتخوان نو',
    posFloor: 'کف قیمت رقابتی کارتخوان نو',
    marketing: 'بودجه بازاریابی کارتخوان آکبند (هر دستگاه)',
    driverCost: 'بهای تمام‌شده محصول محرک',
    driverPrice: 'قیمت فروش محصول محرک',
    driverProfit: 'سود ثابت هر واحد محصول محرک',
    maxPos: 'حداکثر تعداد کارتخوان نو',
    maxDriver: 'حداکثر تعداد محصول محرک',
    maxUpgrade: 'سقف پرداخت اضافه برای ارتقا'
  };

  /* ---------- numbers ---------- */

  var PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

  function normalizeDigits(str) {
    return String(str)
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); })
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); });
  }

  /** Parse user text to a non-negative integer, or NaN. Accepts Persian digits and separators. */
  function parseAmount(value) {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
    }
    if (typeof value !== 'string') return NaN;
    var s = normalizeDigits(value).replace(/[\s,٬،_]/g, '');
    if (s === '' || !/^\d+$/.test(s)) return NaN;
    var n = Number(s);
    return Number.isSafeInteger(n) ? n : NaN;
  }

  function groupDigits(n) {
    var s = String(Math.abs(n));
    var out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + out;
  }

  function toPersianDigits(s) {
    return String(s).replace(/\d/g, function (d) { return PERSIAN[+d]; });
  }

  /** "۱۵,۰۰۰,۰۰۰" */
  function formatNumber(n) {
    if (!Number.isFinite(n)) return '—';
    return toPersianDigits(groupDigits(n));
  }

  /** "۱۵,۰۰۰,۰۰۰ تومان" */
  function formatToman(n) {
    if (!Number.isFinite(n)) return '—';
    return formatNumber(n) + ' تومان';
  }

  /* ---------- settings ---------- */

  /** Convert raw field strings/numbers to integers. Returns {values, errors}. */
  function parseSettings(raw) {
    var values = { driverType: raw && raw.driverType === 'used' ? 'used' : 'cashless' };
    var errors = [];
    FIELDS.forEach(function (f) {
      var n = parseAmount(raw ? raw[f] : undefined);
      if (Number.isNaN(n)) errors.push({ field: f, message: 'یک عدد صحیح (بدون اعشار) وارد کنید.' });
      values[f] = n;
    });
    return { values: values, errors: errors };
  }

  /** Cross-field validation of integer settings. Returns array of {field,message}. */
  function validateSettings(s) {
    var e = [];
    function add(field, message) { e.push({ field: field, message: message }); }
    FIELDS.forEach(function (f) {
      if (!Number.isSafeInteger(s[f]) || s[f] < 0) add(f, 'یک عدد صحیح نامنفی وارد کنید.');
      else if (f !== 'maxPos' && f !== 'maxDriver' && s[f] > MAX_MONEY) add(f, 'مقدار بیش از حد بزرگ است.');
    });
    if (e.length) return e;
    if (s.posBase <= 0) add('posBase', 'قیمت مصوب باید بیشتر از صفر باشد.');
    if (s.posFloor <= 0) add('posFloor', 'کف قیمت باید بیشتر از صفر باشد.');
    if (s.posFloor > s.posBase + s.marketing) add('posFloor', 'کف قیمت نمی‌تواند از «قیمت کارتخوان نو در باندل» (قیمت مصوب + بودجه بازاریابی) بیشتر باشد.');
    if (s.driverPrice <= 0) add('driverPrice', 'قیمت فروش محصول محرک باید بیشتر از صفر باشد.');
    if (s.driverPrice - s.driverCost - s.driverProfit < 0) {
      add('driverPrice', 'قیمت فروش باید حداقل برابر بهای تمام‌شده + سود ثابت باشد؛ در غیر این صورت سهم محصول محرک منفی است.');
    }
    if (s.maxPos < 2) add('maxPos', 'حداکثر تعداد کارتخوان باید حداقل ۲ باشد (تعداد کارتخوان باید از محصول محرک بیشتر باشد).');
    if (s.maxPos > MAX_QTY) add('maxPos', 'حداکثر مجاز ' + formatNumber(MAX_QTY) + ' است.');
    if (s.maxDriver < 1) add('maxDriver', 'حداکثر تعداد محصول محرک باید حداقل ۱ باشد.');
    if (s.maxDriver > MAX_QTY) add('maxDriver', 'حداکثر مجاز ' + formatNumber(MAX_QTY) + ' است.');
    return e;
  }

  /* ---------- bundle math ---------- */

  function driverContribution(s) { return s.driverPrice - s.driverCost - s.driverProfit; }

  /**
   * "قیمت کارتخوان نو در باندل" = approved POS price + marketing budget per POS.
   * The marketing budget is used ONLY to build this price (it will be spent in a separate project);
   * it is never a discount and is never deducted from the discount budget.
   * This price is the starting point that is compared with the competitive floor.
   */
  function bundlePosPrice(s) { return s.posBase + s.marketing; }

  /**
   * Real cashless price in a bundle (analysis only; never feeds total, POS price, publishing or broker logic).
   * markedUp = cost + fixed profit per unit; remaining = net discount budget - discount allocated to the POS units
   * (computed once); perUnit = floor(remaining / count) so the remaining budget is split, not added in full to every unit;
   * real = markedUp + perUnit. Integer toman: the share is rounded down.
   */
  function realDriverPrice(cost, profit, count, budget, posDiscount) {
    var markedUp = cost + profit;
    var remaining = budget - posDiscount;
    var perUnit = count > 0 ? Math.floor(remaining / count) : 0;
    return { markedUp: markedUp, remaining: remaining, perUnit: perUnit, real: markedUp + perUnit };
  }

  /**
   * Evaluate one bundle. Returns an object with `valid` and `errors`.
   * Rules: 1 contribution, 2 bundle POS price = approved + marketing, 3 discount budget = D x contribution
   * (marketing is NOT deducted), 4 discount<=budget, 5 price>=floor, 6 total, 9 P>D>=1.
   */
  function evaluateBundle(s, posQty, driverQty) {
    var errors = [];
    var settingsErrors = validateSettings(s);
    if (settingsErrors.length) errors.push('تنظیمات نامعتبر است.');
    if (!Number.isSafeInteger(posQty) || !Number.isSafeInteger(driverQty)) errors.push('تعداد باید عدد صحیح باشد.');
    if (errors.length) return { valid: false, errors: errors };

    if (driverQty < 1) errors.push('تعداد محصول محرک باید حداقل ۱ باشد.');
    if (posQty <= driverQty) errors.push('تعداد کارتخوان نو باید از تعداد محصول محرک بیشتر باشد.');
    if (posQty > s.maxPos) errors.push('تعداد کارتخوان از سقف تعریف‌شده بیشتر است.');
    if (driverQty > s.maxDriver) errors.push('تعداد محصول محرک از سقف تعریف‌شده بیشتر است.');

    var contribution = driverContribution(s);                 // rule 1
    var driverContributionTotal = driverQty * contribution;
    var bundleBase = bundlePosPrice(s);                        // rule 2: approved price + marketing
    var budget = driverContributionTotal;                      // rule 3: marketing is not deducted here

    if (budget < 0) errors.push('بودجه تخفیف منفی است (سهم محصول محرک منفی است).');

    var maxDiscountPerPos = bundleBase - s.posFloor;
    var affordablePerPos = budget >= 0 && posQty > 0 ? Math.floor(budget / posQty) : 0;
    var discountPerPos = Math.min(maxDiscountPerPos, affordablePerPos);
    var posPrice = bundleBase - discountPerPos;                // never below floor by construction
    var totalDiscount = discountPerPos * posQty;
    var remaining = budget - totalDiscount;

    if (posPrice < s.posFloor) errors.push('قیمت کارتخوان از کف رقابتی کمتر است.');   // rule 5 (defensive)
    if (totalDiscount > budget) errors.push('تخفیف کل از بودجه تخفیف خالص بیشتر است.'); // rule 4 (defensive)

    var real = realDriverPrice(s.driverCost, s.driverProfit, driverQty, budget, totalDiscount);
    var posSubtotal = posQty * posPrice;
    var driverSubtotal = driverQty * s.driverPrice;
    var total = posSubtotal + driverSubtotal;                  // rule 6

    return {
      valid: errors.length === 0,
      errors: errors,
      id: posQty + 'x' + driverQty,
      posQty: posQty,
      driverQty: driverQty,
      contribution: contribution,
      driverContributionTotal: driverContributionTotal,
      marketing: s.marketing,
      bundleBase: bundleBase,
      budget: budget,
      discountPerPos: discountPerPos,
      totalDiscount: totalDiscount,
      remaining: remaining,
      atFloor: posPrice === s.posFloor,
      posPrice: posPrice,
      driverPrice: s.driverPrice,
      posSubtotal: posSubtotal,
      driverSubtotal: driverSubtotal,
      total: total,
      driverMarkedUp: real.markedUp,
      remainingPerDriver: real.perUnit,
      realDriverPrice: real.real
    };
  }

  /** All valid bundles within the configured limits (unsorted). */
  function generateBundles(s) {
    if (validateSettings(s).length) return [];
    var out = [];
    for (var p = 2; p <= s.maxPos; p++) {
      var dMax = Math.min(s.maxDriver, p - 1);
      for (var d = 1; d <= dMax; d++) {
        var b = evaluateBundle(s, p, d);
        if (b.valid) out.push(b);
      }
    }
    return out;
  }

  /* ---------- ranking ---------- */

  function sanitizePriorities(list) {
    if (!Array.isArray(list)) return DEFAULT_PRIORITIES.slice();
    var seen = {};
    var out = [];
    list.forEach(function (k) {
      if (PRIORITY_DIR[k] !== undefined && !seen[k]) { seen[k] = true; out.push(k); }
    });
    PRIORITY_KEYS.forEach(function (k) { if (!seen[k]) out.push(k); });
    return out;
  }

  function makeComparator(priorities) {
    var order = sanitizePriorities(priorities);
    return function (a, b) {
      for (var i = 0; i < order.length; i++) {
        var k = order[i];
        var diff = (a[k] - b[k]) * PRIORITY_DIR[k];
        if (diff !== 0) return diff < 0 ? -1 : 1;
      }
      if (a.posQty !== b.posQty) return a.posQty - b.posQty;
      return a.driverQty - b.driverQty;
    };
  }

  function rankBundles(bundles, priorities) {
    return bundles.slice().sort(makeComparator(priorities));
  }

  /** Move priority `index` by `delta` (-1 up, +1 down). Returns a new array. */
  function movePriority(priorities, index, delta) {
    var list = sanitizePriorities(priorities);
    var j = index + delta;
    if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list;
    var t = list[index]; list[index] = list[j]; list[j] = t;
    return list;
  }

  /* ---------- broker recommendation ---------- */

  // Broker priority: most new POS first, then lowest POS price, then the admin's remaining order.
  function brokerComparator(priorities) {
    var rest = sanitizePriorities(priorities).filter(function (k) { return k !== 'posQty' && k !== 'posPrice'; });
    return makeComparator(['posQty', 'posPrice'].concat(rest));
  }

  // "Genuinely better": more new POS units, or the same units at a lower POS price without
  // asking the broker to take more driver units than the main bundle has.
  function isBetter(candidate, base) {
    return candidate.posQty > base.posQty ||
      (candidate.posQty === base.posQty && candidate.posPrice < base.posPrice && candidate.driverQty <= base.driverQty);
  }

  /**
   * published: bundles (need posQty, posPrice, total, ...). budget: integer toman.
   * cap: maximum additional payment beyond the broker budget.
   * Returns { main, upgrade, additionalPayment, extraOverMain, status }.
   */
  function recommend(published, budget, cap, priorities) {
    var res = { main: null, upgrade: null, additionalPayment: 0, extraOverMain: 0, status: 'ok' };
    if (!Number.isSafeInteger(budget) || budget < 0) { res.status = 'invalid-budget'; return res; }
    if (!Array.isArray(published) || published.length === 0) { res.status = 'no-published'; return res; }
    var capN = Number.isSafeInteger(cap) && cap >= 0 ? cap : 0;
    var cmp = brokerComparator(priorities);

    var within = published.filter(function (b) { return b.total <= budget; }).sort(cmp);
    res.main = within[0] || null;

    var upgrades = published.filter(function (b) {
      var extra = b.total - budget;
      if (extra <= 0 || extra > capN) return false;
      return res.main ? isBetter(b, res.main) : true;
    }).sort(cmp);

    if (upgrades.length) {
      res.upgrade = upgrades[0];
      res.additionalPayment = res.upgrade.total - budget;
      res.extraOverMain = res.main ? res.upgrade.total - res.main.total : 0;
    }
    if (!res.main && !res.upgrade) res.status = 'none-affordable';
    return res;
  }

  /* ---------- CSV ---------- */

  function toCSV(bundles, publishedMap) {
    var head = ['رتبه', 'وضعیت انتشار', 'تعداد کارتخوان نو', 'تعداد محصول محرک', 'قیمت واحد کارتخوان (تومان)',
      'تخفیف هر کارتخوان (تومان)', 'تخفیف کل (تومان)', 'قیمت کارتخوان نو در باندل - مرجع (تومان)', 'بودجه تخفیف (تومان)',
      'بودجه باقی‌مانده (تومان)', 'جمع کارتخوان (تومان)', 'جمع محصول محرک (تومان)', 'مبلغ کل باندل (تومان)', 'قیمت واقعی کش‌لس در بسته (تومان)'];
    var rows = bundles.map(function (b, i) {
      return [b.rank || i + 1, publishedMap && publishedMap[b.id] ? 'منتشر شده' : 'منتشر نشده', b.posQty, b.driverQty,
        b.posPrice, b.discountPerPos, b.totalDiscount, b.bundleBase, b.budget, b.remaining,
        b.posSubtotal, b.driverSubtotal, b.total, b.realDriverPrice];
    });
    return '﻿' + [head].concat(rows).map(function (r) { return r.join(','); }).join('\r\n') + '\r\n';
  }

  /* ---------- broker offer (shareable, contains no costs/profits) ---------- */

  function b64urlEncode(str) {
    var b = typeof btoa === 'function' ? btoa(str) : Buffer.from(str, 'binary').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  }

  /** Only public selling data: list price, driver price, cap, issue day, and [posQty, driverQty, posPrice] per bundle. */
  function buildOffer(s, published, nowMs) {
    return {
      v: VERSION,
      t: s.driverType,
      pb: s.posBase,
      dp: s.driverPrice,
      cap: s.maxUpgrade,
      i: Math.floor((Number.isFinite(nowMs) ? nowMs : Date.now()) / 86400000), // issue date, days since epoch
      b: published.map(function (x) { return [x.posQty, x.driverQty, x.posPrice]; })
    };
  }

  function encodeOffer(offer) { return b64urlEncode(JSON.stringify(offer)); }

  /** Strictly validate an offer; returns {ok, offer, bundles, error}. Totals are recomputed locally. */
  function decodeOffer(text) {
    try {
      var o = JSON.parse(b64urlDecode(String(text)));
      if (!o || o.v !== VERSION) return { ok: false, error: 'نسخه لینک پشتیبانی نمی‌شود.' };
      if (o.t !== 'cashless' && o.t !== 'used') return { ok: false, error: 'نوع محصول محرک نامعتبر است.' };
      ['pb', 'dp', 'cap'].forEach(function (k) {
        if (!Number.isSafeInteger(o[k]) || o[k] < 0 || o[k] > MAX_MONEY) throw new Error('bad ' + k);
      });
      if (o.i !== undefined && (!Number.isSafeInteger(o.i) || o.i < 0 || o.i > 200000)) throw new Error('bad date');
      if (!Array.isArray(o.b) || o.b.length > 20000) throw new Error('bad list');
      var bundles = o.b.map(function (r) {
        if (!Array.isArray(r) || r.length !== 3) throw new Error('bad row');
        var p = r[0], d = r[1], price = r[2];
        if (!Number.isSafeInteger(p) || !Number.isSafeInteger(d) || !Number.isSafeInteger(price)) throw new Error('bad row');
        if (d < 1 || p <= d || p > MAX_QTY || d > MAX_QTY || price <= 0 || price > MAX_MONEY) throw new Error('bad row');
        return {
          id: p + 'x' + d, posQty: p, driverQty: d, posPrice: price, driverPrice: o.dp,
          posSubtotal: p * price, driverSubtotal: d * o.dp, total: p * price + d * o.dp,
          remaining: 0
        };
      });
      return { ok: true, offer: o, bundles: bundles };
    } catch (e) {
      return { ok: false, error: 'لینک پیشنهاد معتبر نیست.' };
    }
  }

  return {
    VERSION: VERSION, MAX_QTY: MAX_QTY, MAX_MONEY: MAX_MONEY,
    FIELDS: FIELDS, FIELD_LABELS: FIELD_LABELS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, DEFAULT_PRIORITIES: DEFAULT_PRIORITIES,
    PRIORITY_KEYS: PRIORITY_KEYS,
    parseAmount: parseAmount, formatNumber: formatNumber, formatToman: formatToman,
    parseSettings: parseSettings, validateSettings: validateSettings,
    driverContribution: driverContribution, realDriverPrice: realDriverPrice, bundlePosPrice: bundlePosPrice, evaluateBundle: evaluateBundle, generateBundles: generateBundles,
    sanitizePriorities: sanitizePriorities, rankBundles: rankBundles, movePriority: movePriority,
    recommend: recommend, toCSV: toCSV,
    buildOffer: buildOffer, encodeOffer: encodeOffer, decodeOffer: decodeOffer
  };
});
