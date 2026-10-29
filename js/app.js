/* Techno Bundle v10 — UI layer. All business rules live in core.js. */
(function () {
  'use strict';

  var C = window.TechnoCore;
  var SPLASH_MS = 5000;
  var PAGE = 200; // rows rendered at once; all bundles are still generated, published and exported
  // Storage is namespaced by the deployment path so two apps on one origin (user.github.io/a/, /b/) never share data.
  var SCOPE = (function () { try { return location.pathname.replace(/[^\/]*$/, ''); } catch (e) { return '/'; } })();
  var KEY = 'technoBundle10:' + SCOPE + ':';

  /* ---------- storage (always wrapped: it can throw or come back empty) ---------- */
  var store = {
    get: function (k) { try { var v = localStorage.getItem(KEY + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(KEY + k); } catch (e) { /* ignore */ } },
    clear: function () {
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY) === 0) localStorage.removeItem(k); });
      } catch (e) { /* ignore */ }
    }
  };

  var $ = function (id) { return document.getElementById(id); };
  var fmt = C.formatNumber;
  var toman = C.formatToman;

  var ICON_UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var PRIO_LABEL = {
    posQty: ['تعداد کارتخوان نو', 'بیشتر بهتر است'],
    posPrice: ['قیمت هر کارتخوان', 'کمتر بهتر است'],
    driverQty: ['تعداد محصول محرک', 'کمتر بهتر است'],
    total: ['مبلغ کل باندل', 'کمتر بهتر است'],
    remaining: ['بودجه باقی‌مانده', 'بیشتر بهتر است']
  };

  function driverName(type) { return type === 'used' ? 'کارتخوان دست‌دوم' : 'کش‌لس'; }

  /* ---------- state ---------- */
  var state = {
    raw: {},
    priorities: C.DEFAULT_PRIORITIES.slice(),
    published: {},
    brokerBudget: '',
    offer: null,       // decoded offer imported from a link
    offerEnc: null,
    tab: 'admin',
    limit: PAGE,
    filters: {},       // column key -> allowed value keys (UI-only, not persisted)
    sort: { key: null, dir: 1 },
    onlyPub: false
  };
  var view = { settings: null, errors: [], bundles: [], rows: [] };
  var TABS = ['admin', 'bundles', 'formulas', 'broker'];

  function defaultRaw() {
    var r = { driverType: C.DEFAULT_SETTINGS.driverType };
    C.FIELDS.forEach(function (f) { r[f] = fmt(C.DEFAULT_SETTINGS[f]); });
    return r;
  }

  function loadState() {
    state.raw = defaultRaw();
    var saved = store.get('settings');
    if (saved && typeof saved === 'object') {
      C.FIELDS.forEach(function (f) { if (typeof saved[f] === 'string' && saved[f].length < 24) state.raw[f] = saved[f]; });
      if (saved.driverType === 'used' || saved.driverType === 'cashless') state.raw.driverType = saved.driverType;
    }
    state.priorities = C.sanitizePriorities(store.get('priorities'));
    var pub = store.get('published');
    state.published = {};
    if (pub && typeof pub === 'object') {
      Object.keys(pub).forEach(function (k) { if (pub[k] === true && /^\d+x\d+@\d+@\d+$/.test(k)) state.published[k] = true; });
    }
    var bb = store.get('brokerBudget');
    state.brokerBudget = typeof bb === 'string' ? bb.slice(0, 24) : '';
    var enc = store.get('offer');
    if (typeof enc === 'string') applyOffer(enc, true);
    var tab = store.get('tab');
    state.tab = TABS.indexOf(tab) !== -1 ? tab : 'admin';
    if (state.offer) state.tab = 'broker';
  }

  function applyOffer(enc, quiet) {
    var d = C.decodeOffer(enc);
    if (!d.ok) { if (!quiet) toast(d.error); return false; }
    state.offer = d;
    state.offerEnc = enc;
    store.set('offer', enc);
    document.body.classList.add('broker-mode');
    return true;
  }

  function persistSettings() { store.set('settings', state.raw); }

  /* ---------- derived data ---------- */
  function pubKey(b) { return b.id + '@' + b.posPrice + '@' + b.driverPrice; }
  function isPublished(b) { return state.published[pubKey(b)] === true; }

  function compute() {
    var parsed = C.parseSettings(state.raw);
    var errs = parsed.errors.slice();
    view.settings = null;
    view.bundles = [];
    if (!errs.length) {
      errs = C.validateSettings(parsed.values);
      if (!errs.length) {
        view.settings = parsed.values;
        view.bundles = C.rankBundles(C.generateBundles(parsed.values), state.priorities);
        view.bundles.forEach(function (b, i) { b.rank = i + 1; });   // rank by the admin priorities; sorting the table never changes it
      }
    }
    view.errors = errs;
    computeRows();
  }

  /* ---------- toast / dialogs ---------- */
  var toastTimer;
  function toast(msg, action) {
    var el = $('toast');
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', function () { el.hidden = true; action.run(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 12000 : 3500);
  }

  function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

  function confirmAction(title, message, okLabel) {
    var d = $('confirmDialog');
    if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n' + message));
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    $('confirmOk').textContent = okLabel || 'تأیید';
    return new Promise(function (resolve) {
      function done() { d.removeEventListener('close', done); resolve(d.returnValue === 'ok'); }
      d.returnValue = 'cancel';
      d.addEventListener('close', done);
      d.showModal();
    });
  }

  /* ---------- settings form ---------- */
  var GROUPS = [
    { title: 'کارتخوان نو', fields: ['posBase', 'marketing', 'bundlePrice', 'posFloor'], units: { posBase: 'تومان', posFloor: 'تومان', marketing: 'تومان' } },
    { title: 'محصول محرک', select: true, fields: ['driverCost', 'driverPrice', 'driverProfit'], units: { driverCost: 'تومان', driverPrice: 'تومان', driverProfit: 'تومان' } },
    { title: 'محدودیت‌ها', fields: ['maxPos', 'maxDriver', 'maxUpgrade'], units: { maxPos: 'عدد', maxDriver: 'عدد', maxUpgrade: 'تومان' } }
  ];

  function renderSettingsForm() {
    var html = '';
    GROUPS.forEach(function (g, gi) {
      html += '<div class="group" role="group" aria-labelledby="grp-' + gi + '"><h3 id="grp-' + gi + '">' + g.title + '</h3>';
      if (g.select) {
        html += '<div class="field"><label for="f-driverType">نوع محصول محرک</label>' +
          '<select id="f-driverType" name="driverType">' +
          '<option value="cashless">کش‌لس</option><option value="used">کارتخوان دست‌دوم</option></select></div>';
      }
      g.fields.forEach(function (f) {
        if (f === 'bundlePrice') {
          // computed automatically: approved price + marketing budget; the base that is compared with the competitive floor
          html += '<div class="field field-computed" id="field-bundlePrice"><label for="f-bundlePrice">قیمت کارتخوان نو در باندل</label>' +
            '<div class="input-wrap"><input id="f-bundlePrice" type="text" readonly tabindex="-1" dir="rtl" aria-describedby="h-bundlePrice">' +
            '<span class="unit">تومان</span></div><div class="hint" id="h-bundlePrice">محاسبه خودکار: قیمت مصوب + بودجه بازاریابی. این قیمت معیار مقایسه با کف قیمت رقابتی است.</div></div>';
          return;
        }
        html += '<div class="field" id="field-' + f + '"><label for="f-' + f + '">' + C.FIELD_LABELS[f] + '</label>' +
          '<div class="input-wrap"><input id="f-' + f + '" name="' + f + '" type="text" inputmode="numeric" dir="rtl" autocomplete="off" aria-describedby="e-' + f + '">' +
          '<span class="unit">' + g.units[f] + '</span></div>' +
          (f === 'marketing' ? '<div class="hint">فقط برای ساخت «قیمت کارتخوان نو در باندل» به‌کار می‌رود و در پروژه‌ای جدا مصرف می‌شود؛ از بودجه تخفیف کم نمی‌شود.</div>' : '') +
          '<div class="err" id="e-' + f + '"></div></div>';
      });
      html += '</div>';
    });
    $('settingsForm').innerHTML = html;
    syncFormFromState();
  }

  function syncFormFromState() {
    C.FIELDS.forEach(function (f) { $('f-' + f).value = state.raw[f]; });
    $('f-driverType').value = state.raw.driverType;
  }

  function showFieldErrors() {
    C.FIELDS.forEach(function (f) {
      $('e-' + f).textContent = '';
      $('field-' + f).classList.remove('has-error');
      $('f-' + f).removeAttribute('aria-invalid');
    });
    view.errors.forEach(function (e) {
      if (!$('e-' + e.field)) return;
      var box = $('e-' + e.field);
      box.textContent = box.textContent ? box.textContent + ' ' + e.message : e.message;
      $('field-' + e.field).classList.add('has-error');
      $('f-' + e.field).setAttribute('aria-invalid', 'true');
    });
    var top = $('settingsErrors');
    if (view.errors.length) {
      top.hidden = false;
      top.textContent = 'تنظیمات نامعتبر است؛ تا اصلاح آن، باندلی ساخته نمی‌شود (' + fmt(view.errors.length) + ' مورد).';
    } else top.hidden = true;
  }

  function renderDerived() {
    var s = view.settings;
    var el = $('derived');
    var pb = C.parseAmount(state.raw.posBase), mk = C.parseAmount(state.raw.marketing);
    $('f-bundlePrice').value = Number.isNaN(pb) || Number.isNaN(mk) ? '—' : fmt(pb + mk);
    if (!s) { el.innerHTML = '<div><dt>سهم هر محصول محرک</dt><dd>—</dd></div>'; return; }
    el.innerHTML =
      '<div><dt>سهم هر ' + driverName(s.driverType) + ' (قیمت − بها − سود ثابت)</dt><dd>' + toman(C.driverContribution(s)) + '</dd></div>' +
      '<div><dt>حداکثر تخفیف هر کارتخوان (قیمت در باندل − کف)</dt><dd>' + toman(C.bundlePosPrice(s) - s.posFloor) + '</dd></div>';
  }

  /* ---------- priorities ---------- */
  function renderPriorities() {
    var html = '';
    state.priorities.forEach(function (k, i) {
      html += '<li><span class="n">' + fmt(i + 1) + '</span><span>' + PRIO_LABEL[k][0] + ' <span class="dir">· ' + PRIO_LABEL[k][1] + '</span></span>' +
        '<button type="button" class="icon-btn" data-move="-1" data-i="' + i + '" aria-label="بالاتر بردن ' + PRIO_LABEL[k][0] + '"' + (i === 0 ? ' disabled' : '') + '>' + ICON_UP + '</button>' +
        '<button type="button" class="icon-btn" data-move="1" data-i="' + i + '" aria-label="پایین‌تر بردن ' + PRIO_LABEL[k][0] + '"' + (i === state.priorities.length - 1 ? ' disabled' : '') + '>' + ICON_DOWN + '</button></li>';
    });
    $('prioList').innerHTML = html;
  }

  /* ---------- bundle table: Excel-style filter + sort ---------- */
  var COLS = [
    { k: 'rank', label: 'رتبه', get: function (b) { return b.rank; } },
    { k: 'posQty', label: 'کارتخوان نو', get: function (b) { return b.posQty; } },
    { k: 'driverQty', label: null, get: function (b) { return b.driverQty; } },
    { k: 'posPrice', label: 'قیمت نهایی هر کارتخوان', get: function (b) { return b.posPrice; }, money: true },
    { k: 'discountPerPos', label: 'تخفیف هر کارتخوان', get: function (b) { return b.discountPerPos; }, money: true },
    { k: 'total', label: 'مبلغ کل باندل', get: function (b) { return b.total; }, money: true },
    { k: 'remaining', label: 'بودجه باقی‌مانده', get: function (b) { return b.remaining; }, money: true },
    { k: 'realDriverPrice', label: 'قیمت واقعی کش‌لس در بسته', get: function (b) { return b.realDriverPrice; }, money: true },
    { k: 'pub', label: 'وضعیت انتشار', get: function (b) { return isPublished(b) ? 'منتشر شده' : 'منتشر نشده'; }, text: true }
  ];
  function colByKey(k) { return COLS.filter(function (c) { return c.k === k; })[0]; }
  function colLabel(c) { return c.label || (view.settings ? driverName(view.settings.driverType) : 'محصول محرک'); }
  function colVal(c, b) { return String(c.get(b)); }
  function colShow(c, v) { return c.text ? v : (c.money ? toman(+v) : fmt(+v)); }

  var ICON_FUNNEL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" fill="currentColor"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';

  function passes(b, skipKey) {
    if (state.onlyPub && !isPublished(b)) return false;
    for (var i = 0; i < COLS.length; i++) {
      var c = COLS[i];
      if (c.k === skipKey) continue;
      var f = state.filters[c.k];
      if (f && f.indexOf(colVal(c, b)) === -1) return false;
    }
    return true;
  }

  function computeRows() {
    var rows = view.bundles.filter(function (b) { return passes(b, null); });
    var so = state.sort;
    var c = so.key ? colByKey(so.key) : null;
    if (c) {
      var dir = so.dir;
      rows = rows.map(function (b, i) { return [b, i]; }).sort(function (x, y) {
        var a = c.get(x[0]), b = c.get(y[0]);
        var r = c.text ? (a < b ? -1 : a > b ? 1 : 0) : a - b;
        return r * dir || x[1] - y[1];
      }).map(function (p) { return p[0]; });
    }
    view.rows = rows;
  }

  function filterCount() { return Object.keys(state.filters).length + (state.onlyPub ? 1 : 0); }

  function renderHead() {
    var h = '';
    COLS.forEach(function (c) {
      var sorted = state.sort.key === c.k;
      var filt = !!state.filters[c.k];
      h += '<th scope="col"' + (sorted ? ' aria-sort="' + (state.sort.dir === 1 ? 'ascending' : 'descending') + '"' : '') + '>' +
        '<button type="button" class="th-btn' + (sorted || filt ? ' is-active' : '') + '" data-col="' + c.k + '" aria-haspopup="dialog" aria-label="' + colLabel(c) + ' — فیلتر و مرتب‌سازی">' +
        '<span>' + colLabel(c) + '</span>' +
        (sorted ? '<span class="ind">' + (state.sort.dir === 1 ? ICON_UP : ICON_DOWN) + '</span>' : '') +
        (filt ? '<span class="ind">' + ICON_FUNNEL + '</span>' : '<span class="ind dim">' + ICON_DOWN + '</span>') +
        '</button></th>';
    });
    $('headRow').innerHTML = h;
  }

  function renderStats(rows) {
    var el = $('stats');
    if (!view.settings || !view.bundles.length) { el.innerHTML = ''; return; }
    if (!rows.length) { el.innerHTML = '<div><span>نمایش‌داده‌شده</span><strong>' + fmt(0) + ' از ' + fmt(view.bundles.length) + '</strong></div>'; return; }
    var min = function (k) { return rows.reduce(function (m, b) { return b[k] < m ? b[k] : m; }, Infinity); };
    var max = function (k) { return rows.reduce(function (m, b) { return b[k] > m ? b[k] : m; }, -Infinity); };
    var pub = rows.filter(isPublished).length;
    el.innerHTML =
      '<div><span>نمایش‌داده‌شده</span><strong>' + fmt(rows.length) + ' از ' + fmt(view.bundles.length) + '</strong></div>' +
      '<div><span>منتشرشده در این فهرست</span><strong>' + fmt(pub) + '</strong></div>' +
      '<div><span>کمترین مبلغ کل</span><strong>' + toman(min('total')) + '</strong></div>' +
      '<div><span>بیشترین مبلغ کل</span><strong>' + toman(max('total')) + '</strong></div>' +
      '<div><span>کمترین قیمت هر کارتخوان</span><strong>' + toman(min('posPrice')) + '</strong></div>' +
      '<div><span>بیشترین بودجه باقی‌مانده</span><strong>' + toman(max('remaining')) + '</strong></div>';
  }

  function renderChips() {
    var h = '';
    COLS.forEach(function (c) {
      var f = state.filters[c.k];
      if (!f) return;
      h += '<span class="chip">' + colLabel(c) + ': ' + (f.length === 1 ? colShow(c, f[0]) : fmt(f.length) + ' مورد') +
        '<button type="button" data-unfilter="' + c.k + '" aria-label="حذف فیلتر ' + colLabel(c) + '">' + ICON_X + '</button></span>';
    });
    if (state.sort.key) h += '<span class="chip chip-sort">مرتب‌سازی: ' + colLabel(colByKey(state.sort.key)) + (state.sort.dir === 1 ? ' (صعودی)' : ' (نزولی)') +
      '<button type="button" data-unsort="1" aria-label="حذف مرتب‌سازی">' + ICON_X + '</button></span>';
    $('chips').innerHTML = h;
    $('clearFilters').hidden = !(filterCount() || state.sort.key);
    $('onlyPub').checked = state.onlyPub;
  }

  function renderTable() {
    computeRows();
    var s = view.settings;
    var rows = view.rows;
    var total = view.bundles.length;
    renderHead();
    renderChips();
    renderStats(rows);
    var html = '';
    var shown = rows.slice(0, state.limit);
    shown.forEach(function (b) {
      var pub = isPublished(b);
      html += '<tr data-id="' + b.id + '"' + (pub ? ' class="is-published"' : '') + '>' +
        '<td>' + fmt(b.rank) + '</td>' +
        '<td>' + fmt(b.posQty) + '</td><td>' + fmt(b.driverQty) + '</td>' +
        '<td class="num">' + toman(b.posPrice) + (b.atFloor ? '<span class="cap">کف</span>' : '') + '</td>' +
        '<td class="num">' + toman(b.discountPerPos) + '</td>' +
        '<td class="num">' + toman(b.total) + '</td>' +
        '<td class="num">' + toman(b.remaining) + '</td>' +
        '<td class="num">' + toman(b.realDriverPrice) + '</td>' +
        '<td><div class="status-cell">' +
        '<button type="button" class="switch" role="switch" aria-checked="' + pub + '" data-act="toggle" aria-label="انتشار باندل ' + fmt(b.posQty) + ' به ' + fmt(b.driverQty) + '">' + (pub ? 'منتشر شده' : 'منتشر نشده') + '</button>' +
        '<span class="print-only">' + (pub ? 'منتشر شده' : 'منتشر نشده') + '</span>' +
        '<button type="button" class="btn btn-sm" data-act="details">جزئیات</button></div></td></tr>';
    });
    $('bundleRows').innerHTML = html;

    var pubCount = view.bundles.filter(isPublished).length;
    var filtered = filterCount() > 0;
    $('tblSummary').textContent = s ? fmt(total) + ' باندل معتبر · ' + fmt(pubCount) + ' منتشر شده' +
      (filtered ? ' · ' + fmt(rows.length) + ' مورد با فیلتر فعلی' : '') +
      (shown.length < rows.length ? ' · ' + fmt(shown.length) + ' مورد اول نمایش داده می‌شود' : '') : '';
    $('adminSummary').textContent = s ? fmt(total) + ' باندل معتبر ساخته شده و ' + fmt(pubCount) + ' باندل منتشر شده است.' : 'ابتدا خطاهای تنظیمات را اصلاح کنید.';
    $('pubAllBtn').textContent = filtered ? 'انتشار فیلترشده‌ها (' + fmt(rows.length) + ')' : 'انتشار همه';
    $('unpubAllBtn').textContent = filtered ? 'لغو انتشار فیلترشده‌ها' : 'لغو انتشار همه';
    $('csvBtn').textContent = filtered || state.sort.key ? 'خروجی CSV (نمای فعلی)' : 'خروجی CSV';
    var more = $('moreBtn');
    if (shown.length < rows.length) {
      more.hidden = false;
      more.textContent = 'نمایش ' + fmt(Math.min(PAGE, rows.length - shown.length)) + ' مورد بعدی (از ' + fmt(rows.length - shown.length) + ' مورد باقی‌مانده)';
    } else more.hidden = true;
    var empty = $('emptyState');
    if (!s) { empty.hidden = false; empty.textContent = 'ابتدا خطاهای تنظیمات را اصلاح کنید تا باندل‌ها ساخته شوند.'; }
    else if (!total) { empty.hidden = false; empty.textContent = 'با این تنظیمات هیچ باندل معتبری وجود ندارد. بودجه بازاریابی را کمتر یا سهم محصول محرک را بیشتر کنید.'; }
    else if (!rows.length) { empty.hidden = false; empty.textContent = 'هیچ باندلی با فیلترهای فعلی پیدا نشد. فیلترها را پاک کنید.'; }
    else empty.hidden = true;

    var valid = {};
    view.bundles.forEach(function (b) { valid[pubKey(b)] = true; });
    var stale = Object.keys(state.published).filter(function (k) { return !valid[k]; }).length;
    var note = $('staleNote');
    if (s && stale) {
      note.hidden = false;
      note.textContent = fmt(stale) + ' باندل که قبلاً منتشر شده بود، با قیمت‌های فعلی تطابق ندارد و منتشر محسوب نمی‌شود. اگر مقدارها را به حالت قبل برگردانید دوباره فعال می‌شود.';
    } else note.hidden = true;

    ['pubAllBtn', 'unpubAllBtn', 'csvBtn', 'shareBtn'].forEach(function (id) { $(id).disabled = !total; });
    $('pubAllBtn').disabled = !rows.length;
    $('unpubAllBtn').disabled = !total;
    $('csvBtn').disabled = !rows.length;
  }

  /* column menu (Excel-like): sort, search, value checklist */
  var menu = { col: null, q: '' };

  function menuValues(c) {
    var counts = {};
    view.bundles.forEach(function (b) { if (passes(b, c.k)) { var v = colVal(c, b); counts[v] = (counts[v] || 0) + 1; } });
    var vals = Object.keys(counts);
    vals.sort(function (a, b) { return c.text ? (a < b ? -1 : 1) : (+a) - (+b); });
    return { vals: vals, counts: counts };
  }

  function renderMenuList() {
    var c = colByKey(menu.col);
    var mv = menuValues(c);
    var f = state.filters[c.k];
    var q = menu.q.trim();
    var qn = q ? C.parseAmount(q) : NaN;
    var vis = mv.vals.filter(function (v) {
      if (!q) return true;
      return colShow(c, v).indexOf(q) !== -1 || (!Number.isNaN(qn) && v.indexOf(String(qn)) !== -1);
    });
    var h = '';
    vis.forEach(function (v) {
      var on = !f || f.indexOf(v) !== -1;
      h += '<label class="chk"><input type="checkbox" data-val="' + v + '"' + (on ? ' checked' : '') + '><span>' + colShow(c, v) + '</span><em>' + fmt(mv.counts[v]) + '</em></label>';
    });
    $('menuList').innerHTML = h || '<p class="muted">موردی پیدا نشد.</p>';
    menu.visible = vis;
    menu.all = mv.vals;
  }

  function openMenu(key, anchor) {
    var c = colByKey(key);
    menu.col = key; menu.q = '';
    var m = $('colMenu');
    m.innerHTML =
      '<div class="cm-head"><strong>' + colLabel(c) + '</strong><button type="button" class="icon-btn" data-cm="close" aria-label="بستن">' + ICON_X + '</button></div>' +
      '<div class="cm-sort"><button type="button" class="btn btn-sm" data-cm="asc">' + (c.text ? 'الف تا ی' : 'کم به زیاد') + '</button>' +
      '<button type="button" class="btn btn-sm" data-cm="desc">' + (c.text ? 'ی تا الف' : 'زیاد به کم') + '</button>' +
      '<button type="button" class="btn btn-sm" data-cm="nosort">بدون مرتب‌سازی</button></div>' +
      '<input id="menuSearch" type="search" dir="rtl" placeholder="جستجو در مقدارها" autocomplete="off" aria-label="جستجو در مقدارها">' +
      '<div class="cm-sel"><button type="button" class="btn btn-sm" data-cm="all">انتخاب همه</button><button type="button" class="btn btn-sm" data-cm="none">پاک‌کردن انتخاب</button></div>' +
      '<div id="menuList" class="cm-list"></div>' +
      '<div class="cm-foot"><button type="button" class="btn btn-sm" data-cm="clear">حذف فیلتر این ستون</button></div>';
    renderMenuList();
    m.hidden = false;
    var r = anchor.getBoundingClientRect();
    var w = Math.min(300, window.innerWidth - 16);
    m.style.width = w + 'px';
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    m.style.left = left + 'px';
    m.style.top = Math.min(r.bottom + 4, Math.max(8, window.innerHeight - 380)) + 'px';
    $('menuSearch').focus();
  }

  function closeMenu() { var m = $('colMenu'); if (!m.hidden) { m.hidden = true; menu.col = null; } }

  function applyFilterChange() { state.limit = PAGE; renderTable(); renderMenuIfOpen(); }
  function renderMenuIfOpen() { if (menu.col) renderMenuList(); }

  function menuAction(act) {
    var k = menu.col; if (!k) return;
    if (act === 'close') { closeMenu(); return; }
    if (act === 'asc' || act === 'desc') { state.sort = { key: k, dir: act === 'asc' ? 1 : -1 }; }
    else if (act === 'nosort') state.sort = { key: null, dir: 1 };
    else if (act === 'clear') delete state.filters[k];
    else if (act === 'all') {
      if (!menu.q.trim()) delete state.filters[k];
      else if (state.filters[k]) state.filters[k] = state.filters[k].concat(menu.visible.filter(function (v) { return state.filters[k].indexOf(v) === -1; }));
    } else if (act === 'none') {
      var cur = state.filters[k] || menu.all;
      state.filters[k] = cur.filter(function (v) { return menu.visible.indexOf(v) === -1; });
    }
    applyFilterChange();
  }

  function toggleMenuValue(v, on) {
    var k = menu.col;
    var cur = (state.filters[k] || menu.all).slice();
    var i = cur.indexOf(v);
    if (on && i === -1) cur.push(v);
    if (!on && i !== -1) cur.splice(i, 1);
    if (cur.length === menu.all.length) delete state.filters[k]; else state.filters[k] = cur;
    applyFilterChange();
  }

  function clearAllFilters() {
    state.filters = {}; state.sort = { key: null, dir: 1 }; state.onlyPub = false; state.limit = PAGE;
    closeMenu();
    renderTable();
  }

  function findBundle(id) { return view.bundles.filter(function (b) { return b.id === id; })[0]; }

  /* ---------- details modal ---------- */
  function row(label, value, hint, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</td><td>' + value + '</td></tr>';
  }

  function openDetails(id) {
    var b = findBundle(id), s = view.settings;
    if (!b || !s) return;
    var dn = driverName(s.driverType);
    $('detailsTitle').textContent = fmt(b.posQty) + ' کارتخوان نو + ' + fmt(b.driverQty) + ' ' + dn;

    var span = b.bundleBase;
    var pricePct = Math.max(0, Math.min(100, (b.posPrice / span) * 100));
    var floorPct = Math.max(0, Math.min(100, (s.posFloor / span) * 100));

    var html =
      '<div class="ladder" aria-hidden="true"><div class="ladder-track"><div class="ladder-fill" style="width:' + pricePct.toFixed(2) + '%"></div>' +
      '<div class="ladder-floor" style="inset-inline-start:calc(' + floorPct.toFixed(2) + '% - 1px)"></div></div>' +
      '<div class="ladder-legend"><span>قیمت نهایی در باندل: ' + toman(b.posPrice) + '</span><span>کف رقابتی: ' + toman(s.posFloor) + '</span><span>قیمت کارتخوان نو در باندل: ' + toman(b.bundleBase) + '</span></div></div>' +
      '<table class="detail-table"><tbody>' +
      row('سهم هر ' + dn, toman(b.contribution), 'قیمت فروش ' + toman(s.driverPrice) + ' − بها ' + toman(s.driverCost) + ' − سود ثابت ' + toman(s.driverProfit)) +
      row('سهم کل محصول محرک', toman(b.driverContributionTotal), fmt(b.driverQty) + ' × ' + toman(b.contribution)) +
      row('قیمت مصوب کارتخوان نو', toman(s.posBase)) +
      row('بودجه بازاریابی هر کارتخوان', toman(s.marketing), 'فقط برای ساخت قیمت باندل؛ در پروژه‌ای جدا مصرف می‌شود. از بودجه تخفیف کم نمی‌شود و تخفیف نیست.') +
      row('قیمت کارتخوان نو در باندل', toman(b.bundleBase), 'قیمت مصوب + بودجه بازاریابی؛ معیار مقایسه با کف رقابتی') +
      row('بودجه تخفیف کارتخوان', toman(b.budget), 'برابر سهم کل محصول محرک') +
      row('تخفیف هر کارتخوان', toman(b.discountPerPos), b.atFloor ? 'به کف رقابتی رسیده؛ مابقی بودجه باقی می‌ماند' : 'گرد‌شده به پایین تا عدد صحیح') +
      row('تخفیف کل کارتخوان', toman(b.totalDiscount)) +
      row('بودجه باقی‌مانده', toman(b.remaining)) +
      row('قیمت نهایی هر کارتخوان در باندل', toman(b.posPrice), 'قیمت کارتخوان نو در باندل ' + toman(b.bundleBase) + ' − تخفیف هر کارتخوان') +
      row('جمع کارتخوان‌ها', toman(b.posSubtotal), fmt(b.posQty) + ' × ' + toman(b.posPrice)) +
      row('جمع ' + dn, toman(b.driverSubtotal), fmt(b.driverQty) + ' × ' + toman(b.driverPrice)) +
      row('مبلغ کل باندل', toman(b.total), '', 'sum') +
      '</tbody></table>' +
      '<h3 class="sub-h">تحلیل اقتصادی (فقط گزارش مدیریتی)</h3>' +
      '<table class="detail-table"><tbody>' +
      row('قیمت مارک‌شده کش‌لس', toman(b.driverMarkedUp), 'بهای تمام‌شده ' + toman(s.driverCost) + ' + سود ثابت ' + toman(s.driverProfit)) +
      row('بودجه باقی‌مانده کل بسته', toman(b.remaining), 'بودجه تخفیف ' + toman(b.budget) + ' − تخفیف کل کارتخوان ' + toman(b.totalDiscount) + '؛ فقط یک‌بار محاسبه شده') +
      row('سهم بودجه باقی‌مانده هر کش‌لس', toman(b.remainingPerDriver), toman(b.remaining) + ' ÷ ' + fmt(b.driverQty) + ' (گرد‌شده به پایین تا عدد صحیح تومان)') +
      row('قیمت واقعی کش‌لس در بسته', toman(b.realDriverPrice), 'قیمت مارک‌شده + سهم باقی‌مانده. این شاخص تحلیلی است و قیمت فروش ثبت‌شده کش‌لس، مبلغ کل و قیمت کارتخوان را تغییر نمی‌دهد.', 'sum') +
      '</tbody></table>' +
      '<ul class="checks">' +
      '<li>قیمت نهایی کارتخوان (' + toman(b.posPrice) + ') کمتر از کف رقابتی نیست.</li>' +
      '<li>تخفیف کل از بودجه تخفیف بیشتر نیست.</li>' +
      '<li>تعداد کارتخوان (' + fmt(b.posQty) + ') از تعداد ' + dn + ' (' + fmt(b.driverQty) + ') بیشتر است.</li>' +
      '<li>بودجه بازاریابی فقط در ساخت قیمت کارتخوان نو در باندل استفاده شده و از بودجه تخفیف کم نشده است.</li></ul>';
    $('detailsBody').innerHTML = html;
    openDialog($('detailsDialog'));
  }

  /* ---------- broker view ---------- */
  function brokerSource() {
    if (state.offer) {
      return { bundles: state.offer.bundles, cap: state.offer.offer.cap, type: state.offer.offer.t, base: state.offer.offer.pb, fromOffer: true };
    }
    if (view.settings) {
      return { bundles: view.bundles.filter(isPublished), cap: view.settings.maxUpgrade, type: view.settings.driverType, base: view.settings.posBase, fromOffer: false };
    }
    return { bundles: [], cap: 0, type: 'cashless', base: 0, fromOffer: false };
  }

  function offerCard(kind, b, src, extra) {
    var dn = driverName(src.type);
    var saving = src.base > b.posPrice ? src.base - b.posPrice : 0;
    var tag = kind === 'main' ? 'پیشنهاد اصلی' : (extra && extra.fallback ? 'نزدیک‌ترین گزینه' : 'ارتقای پیشنهادی');
    var h = '<article class="offer ' + kind + '"><span class="tag">' + tag + '</span>' +
      '<h3>' + fmt(b.posQty) + ' کارتخوان نو + ' + fmt(b.driverQty) + ' ' + dn + '</h3><dl class="lines">' +
      '<div><dt>قیمت هر کارتخوان</dt><dd>' + (saving ? '<del>' + toman(src.base) + '</del>' : '') + toman(b.posPrice) + '</dd></div>' +
      '<div><dt>قیمت هر ' + dn + '</dt><dd>' + toman(b.driverPrice) + '</dd></div>' +
      '<div><dt>جمع کارتخوان‌ها</dt><dd>' + toman(b.posSubtotal) + '</dd></div>' +
      '<div><dt>جمع ' + dn + '</dt><dd>' + toman(b.driverSubtotal) + '</dd></div></dl>';
    if (saving) h += '<p class="keep">صرفه‌جویی هر کارتخوان نسبت به قیمت مصوب: ' + toman(saving) + '</p>';
    h += '<div class="total"><span>مبلغ کل باندل</span><strong>' + toman(b.total) + '</strong></div>';
    if (extra && extra.keep !== undefined) h += '<p class="keep">از بودجه شما ' + toman(extra.keep) + ' باقی می‌ماند.</p>';
    if (extra && extra.pay) {
      h += '<p class="delta">پرداخت اضافه نسبت به بودجه شما: ' + toman(extra.pay) + '</p>';
      if (extra.overMain) h += '<p class="muted">اختلاف با پیشنهاد اصلی: ' + toman(extra.overMain) + '</p>';
    }
    return h + '</article>';
  }

  function issuedText() {
    var o = state.offer && state.offer.offer;
    if (!o || o.i === undefined) return '';
    try { return ' · تاریخ صدور پیشنهاد: ' + new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(o.i * 86400000)); }
    catch (e) { return ''; }
  }

  function renderBroker() {
    var src = brokerSource();
    var out = $('brokerResult');
    var hint = $('brokerHint');
    $('offerClear').hidden = !state.offer;
    var budget = C.parseAmount(state.brokerBudget);

    if (!src.bundles.length) {
      hint.textContent = '';
      out.innerHTML = '<p class="empty">هنوز باندلی منتشر نشده است. مدیر باید دست‌کم یک باندل را منتشر کند.</p>';
      return;
    }
    if (!state.brokerBudget.trim()) {
      hint.textContent = 'مبلغی را که برای این خرید در نظر دارید وارد کنید؛ بهترین باندل خودکار انتخاب می‌شود.';
      out.innerHTML = '';
      return;
    }
    if (Number.isNaN(budget)) {
      hint.textContent = 'بودجه باید یک عدد صحیح باشد.';
      out.innerHTML = '';
      return;
    }
    hint.textContent = 'بودجه: ' + toman(budget) + ' · سقف پرداخت اضافه برای ارتقا: ' + toman(src.cap) + issuedText();
    var r = C.recommend(src.bundles, budget, src.cap, state.priorities);
    var html = '';
    if (r.main) html += offerCard('main', r.main, src, { keep: budget - r.main.total });
    if (r.upgrade) html += offerCard('upgrade', r.upgrade, src, { pay: r.additionalPayment, overMain: r.extraOverMain, fallback: !r.main });
    if (!r.main && !r.upgrade) {
      var min = src.bundles.reduce(function (m, b) { return b.total < m ? b.total : m; }, Infinity);
      html = '<p class="empty">با این بودجه باندلی در دسترس نیست. کمترین مبلغ باندل منتشرشده ' + toman(min) + ' است.</p>';
    }
    out.innerHTML = html;
  }

  /* ---------- formulas page ---------- */
  function renderFormulas() {
    var s = view.settings;
    var b = view.bundles[0];
    var dn = s ? driverName(s.driverType) : 'محصول محرک';
    function card(n, title, formula, note, ex) {
      return '<article class="fcard"><h3><span class="n">' + fmt(n) + '</span>' + title + '</h3>' +
        '<p class="formula" dir="rtl">' + formula + '</p>' + (note ? '<p class="muted">' + note + '</p>' : '') +
        (ex ? '<p class="ex"><b>نمونه با تنظیمات فعلی:</b> ' + ex + '</p>' : '') + '</article>';
    }
    var live = !!(s && b);
    var h = '<div class="panel-head"><h2>فرمول‌های مدل</h2><p>همه مبالغ به تومان و عدد صحیح‌اند. نمونه‌ها با تنظیمات فعلی و باندل رتبه ۱ (' +
      (live ? fmt(b.posQty) + ' کارتخوان نو + ' + fmt(b.driverQty) + ' ' + dn : 'در دسترس نیست') + ') محاسبه می‌شوند.</p></div><div class="fgrid">';
    h += card(1, 'سهم هر ' + dn, 'سهم هر واحد = قیمت فروش محصول محرک − بهای تمام‌شده − سود ثابت هر واحد', '',
      live ? toman(s.driverPrice) + ' − ' + toman(s.driverCost) + ' − ' + toman(s.driverProfit) + ' = ' + toman(b.contribution) : '');
    h += card(2, 'قیمت کارتخوان نو در باندل', 'قیمت کارتخوان نو در باندل = قیمت مصوب کارتخوان نو + بودجه بازاریابی هر کارتخوان',
      'معیار مقایسه با کف رقابتی است. بودجه بازاریابی تخفیف نیست و از بودجه تخفیف کم نمی‌شود.',
      live ? toman(s.posBase) + ' + ' + toman(s.marketing) + ' = ' + toman(b.bundleBase) : '');
    h += card(3, 'بودجه تخفیف کارتخوان', 'بودجه تخفیف = تعداد ' + dn + ' × سهم هر واحد', '',
      live ? fmt(b.driverQty) + ' × ' + toman(b.contribution) + ' = ' + toman(b.budget) : '');
    h += card(4, 'تخفیف هر کارتخوان', 'تخفیف هر کارتخوان = کمترین مقدار از ( قیمت کارتخوان نو در باندل − کف رقابتی ) و ( کف عدد صحیح « بودجه تخفیف ÷ تعداد کارتخوان » )', '',
      live ? toman(b.discountPerPos) : '');
    h += card(5, 'قیمت نهایی هر کارتخوان در باندل', 'قیمت نهایی = قیمت کارتخوان نو در باندل − تخفیف هر کارتخوان', 'هیچ‌گاه کمتر از کف رقابتی نمی‌شود.',
      live ? toman(b.bundleBase) + ' − ' + toman(b.discountPerPos) + ' = ' + toman(b.posPrice) : '');
    h += card(6, 'مبلغ کل باندل', 'مبلغ کل = ( تعداد کارتخوان × قیمت نهایی کارتخوان ) + ( تعداد ' + dn + ' × قیمت فروش ' + dn + ' )', '',
      live ? '(' + fmt(b.posQty) + ' × ' + toman(b.posPrice) + ') + (' + fmt(b.driverQty) + ' × ' + toman(b.driverPrice) + ') = ' + toman(b.total) : '');
    h += card(7, 'بودجه باقی‌مانده', 'بودجه باقی‌مانده = بودجه تخفیف − ( تعداد کارتخوان × تخفیف هر کارتخوان )', 'فقط یک‌بار محاسبه می‌شود؛ بودجه بازاریابی دوباره از آن کم نمی‌شود.',
      live ? toman(b.budget) + ' − ' + toman(b.totalDiscount) + ' = ' + toman(b.remaining) : '');
    h += card(8, 'قیمت مارک‌شده ' + dn, 'قیمت مارک‌شده = بهای تمام‌شده هر واحد + سود ثابت هر واحد', 'از همان ورودی‌های فعلی مدیریت محاسبه می‌شود؛ ورودی جدیدی ندارد.',
      live ? toman(s.driverCost) + ' + ' + toman(s.driverProfit) + ' = ' + toman(b.driverMarkedUp) : '');
    h += card(9, 'قیمت واقعی کش‌لس در بسته', 'قیمت واقعی کش‌لس در بسته = قیمت مارک‌شده + ( بودجه باقی‌مانده کل بسته ÷ تعداد کش‌لس بسته )',
      'شاخص تحلیلی است: مبلغ کل، قیمت فروش ثبت‌شده، قیمت کارتخوان، انتشار و پیشنهاد کارگزار را تغییر نمی‌دهد. سهم هر واحد به پایین گرد می‌شود تا عدد صحیح تومان بماند.',
      live ? toman(b.driverMarkedUp) + ' + ⌊' + toman(b.remaining) + ' ÷ ' + fmt(b.driverQty) + '⌋ = ' + toman(b.realDriverPrice) : '');
    h += '</div>';
    var ex = C.realDriverPrice(25000000, 2000000, 2, 25000000, 20000000);
    h += '<article class="fcard fcard-wide"><h3>نمونه آزمون صحت (۲ کش‌لس)</h3><p class="muted">بهای تمام‌شده ' + toman(25000000) + ' · سود ثابت ' + toman(2000000) + ' · بودجه خالص تخفیف ' + toman(25000000) + ' · تخفیف کارتخوان‌ها ' + toman(20000000) + '</p>' +
      '<p class="formula" dir="rtl">قیمت مارک‌شده ' + toman(ex.markedUp) + ' · بودجه باقی‌مانده ' + toman(ex.remaining) + ' · سهم هر کش‌لس ' + toman(ex.perUnit) + ' ← قیمت واقعی کش‌لس در بسته ' + toman(ex.real) + '</p></article>';
    h += '<article class="fcard fcard-wide"><h3>قواعد اعتبار باندل</h3><ul class="checks">' +
      '<li>تعداد کارتخوان نو از تعداد محصول محرک بیشتر و تعداد محصول محرک حداقل ۱ است.</li>' +
      '<li>تعدادها از سقف تعریف‌شده (حداکثر ۱۰۰) بیشتر نیست.</li>' +
      '<li>سهم محصول محرک و بودجه تخفیف منفی نیست و کف رقابتی از قیمت کارتخوان نو در باندل بالاتر نیست.</li>' +
      '<li>ورودی بهای تمام‌شده یا سود کارتخوان نو و سود کل باندل در این مدل وجود ندارد.</li></ul></article>';
    $('formulasBody').innerHTML = h;
  }

  /* ---------- nav ---------- */
  function renderNav() {
    var t = state.tab;
    TABS.forEach(function (n) {
      var tab = $('tab-' + n);
      tab.setAttribute('aria-selected', String(n === t));
      tab.tabIndex = n === t ? 0 : -1;
      $('view-' + n).hidden = n !== t;
    });
  }

  // Big configurations (hundreds of bundles) are re-rendered after a short pause instead of on every keystroke.
  var updateTimer;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    if (view.bundles.length <= 500) { updateAll(); return; }
    updateTimer = setTimeout(updateAll, 250);
  }

  function updateAll() {
    clearTimeout(updateTimer);
    state.limit = PAGE;
    state.filters = {}; state.sort = { key: null, dir: 1 }; state.onlyPub = false; closeMenu();
    compute();
    showFieldErrors();
    renderDerived();
    renderPriorities();
    renderFormulas();
    renderTable();
    renderBroker();
  }

  /* ---------- actions ---------- */
  function setPublished(list, on) {
    list.forEach(function (b) { if (on) state.published[pubKey(b)] = true; else delete state.published[pubKey(b)]; });
    store.set('published', state.published);
    renderTable();
    renderBroker();
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function printAll() {
    var prev = state.limit;
    state.limit = Infinity; // the printout must contain every bundle of the current view, not only the first page
    renderTable();
    try { window.print(); } finally { state.limit = prev; renderTable(); }
  }

  function exportCSV() {
    var map = {};
    view.bundles.forEach(function (b) { if (isPublished(b)) map[b.id] = true; });
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    download('techno-bundle-v10-' + stamp + '.csv', C.toCSV(view.rows, map), 'text/csv;charset=utf-8');
    toast('فایل CSV آماده شد.');
  }

  function shareLink() {
    var pub = view.bundles.filter(isPublished);
    if (!view.settings || !pub.length) { toast('ابتدا دست‌کم یک باندل را منتشر کنید.'); return; }
    var enc = C.encodeOffer(C.buildOffer(view.settings, pub, Date.now()));
    var base = location.href.split('#')[0].split('?')[0];
    var link = base + '#offer=' + enc;
    $('shareText').value = link;
    var info = 'این لینک فقط ' + fmt(pub.length) + ' باندل منتشرشده، قیمت‌ها، سقف ارتقا و تاریخ صدور را دارد. بهای تمام‌شده، سود، کف رقابتی و بودجه بازاریابی در آن نیست.';
    if (link.length > 8000) info += ' هشدار: لینک بسیار بلند است (' + fmt(link.length) + ' نویسه) و ممکن است در پیام‌رسان‌ها بریده شود؛ تعداد باندل‌های منتشرشده را کمتر کنید.';
    $('shareInfo').textContent = info;
    openDialog($('shareDialog'));
  }

  function copyShare() {
    var ta = $('shareText');
    var text = ta.value;
    function fallback() { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('لینک کپی شد.'); } catch (e) { toast('لینک را دستی کپی کنید.'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('لینک کپی شد.'); }, fallback);
    } else fallback();
  }

  function resetDefaults() {
    confirmAction('بازنشانی به پیش‌فرض', 'تنظیمات و ترتیب اولویت‌ها به حالت پیش‌فرض برمی‌گردد. وضعیت انتشار تغییر نمی‌کند.', 'بازنشانی').then(function (ok) {
      if (!ok) return;
      state.raw = defaultRaw();
      state.priorities = C.DEFAULT_PRIORITIES.slice();
      persistSettings();
      store.set('priorities', state.priorities);
      syncFormFromState();
      updateAll();
      toast('به تنظیمات پیش‌فرض برگشت.');
    });
  }

  function clearData() {
    confirmAction('پاک‌کردن همه داده‌ها', 'تنظیمات، قیمت‌ها، اولویت‌ها، وضعیت انتشار، بودجه کارگزار و پیشنهاد ذخیره‌شده از این دستگاه حذف می‌شود و برنامه به مقادیر پیش‌فرض برمی‌گردد تا قیمت‌های جدید را وارد کنید. این کار قابل بازگشت نیست.', 'پاک کن').then(function (ok) {
      if (!ok) return;
      store.clear();
      state.raw = defaultRaw();
      state.priorities = C.DEFAULT_PRIORITIES.slice();
      state.published = {};
      state.brokerBudget = '';
      state.offer = null; state.offerEnc = null;
      document.body.classList.remove('broker-mode');
      $('brokerBudget').value = '';
      state.tab = 'admin';
      syncFormFromState();
      renderNav();
      updateAll();
      toast('همه داده‌ها پاک شد.');
    });
  }

  // Clears ONLY the broker page: the entered budget and an imported offer. Admin settings, priorities,
  // published flags and the admin pages are not touched.
  function clearBrokerData() {
    confirmAction('پاکسازی صفحه کارگزار', 'فقط بودجه واردشده و پیشنهاد دریافتی در صفحه کارگزار پاک می‌شود. تنظیمات، قیمت‌ها، اولویت‌ها و وضعیت انتشار در صفحه مدیریت بدون تغییر می‌ماند.', 'پاک کن').then(function (ok) {
      if (!ok) return;
      state.brokerBudget = '';
      store.del('brokerBudget');
      $('brokerBudget').value = '';
      if (state.offer) {
        state.offer = null; state.offerEnc = null;
        store.del('offer');
        document.body.classList.remove('broker-mode');
      }
      renderNav();
      renderBroker();
      toast('صفحه کارگزار پاک شد.');
    });
  }

  function clearOffer() {
    confirmAction('حذف پیشنهاد ذخیره‌شده', 'پیشنهاد دریافتی از این دستگاه حذف می‌شود و برنامه به حالت مدیر برمی‌گردد.', 'حذف').then(function (ok) {
      if (!ok) return;
      state.offer = null; state.offerEnc = null;
      store.del('offer');
      document.body.classList.remove('broker-mode');
      state.tab = 'admin';
      store.set('tab', state.tab);
      renderNav();
      renderBroker();
    });
  }

  function handleHash() {
    var m = /^#offer=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return;
    if (applyOffer(m[1], false)) {
      state.tab = 'broker';
      renderNav();
      renderBroker();
      toast('پیشنهاد مدیر دریافت شد.');
    }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  /* ---------- events ---------- */
  function bind() {
    $('settingsForm').addEventListener('input', function (e) {
      var t = e.target;
      if (t.name === 'driverType') state.raw.driverType = t.value === 'used' ? 'used' : 'cashless';
      else if (C.FIELDS.indexOf(t.name) !== -1) state.raw[t.name] = t.value;
      else return;
      persistSettings();
      scheduleUpdate();
    });
    $('settingsForm').addEventListener('focusout', function (e) {
      var t = e.target;
      if (C.FIELDS.indexOf(t.name) === -1) return;
      var n = C.parseAmount(t.value);
      if (!Number.isNaN(n)) { t.value = fmt(n); state.raw[t.name] = t.value; persistSettings(); }
    });
    $('settingsForm').addEventListener('submit', function (e) { e.preventDefault(); });

    $('prioList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-move]');
      if (!btn || btn.disabled) return;
      var i = +btn.getAttribute('data-i');
      state.priorities = C.movePriority(state.priorities, i, +btn.getAttribute('data-move'));
      store.set('priorities', state.priorities);
      compute();
      renderPriorities();
      renderTable();
      renderBroker();
      var again = $('prioList').querySelector('button[data-i="' + (i + (+btn.getAttribute('data-move'))) + '"][data-move="' + btn.getAttribute('data-move') + '"]');
      if (again && !again.disabled) again.focus();
    });

    $('bundleRows').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.closest('tr').getAttribute('data-id');
      var b = findBundle(id);
      if (!b) return;
      if (btn.getAttribute('data-act') === 'details') openDetails(id);
      else setPublished([b], !isPublished(b));
    });

    $('pubAllBtn').addEventListener('click', function () {
      var f = filterCount() > 0;
      setPublished(view.rows, true);
      toast(f ? fmt(view.rows.length) + ' باندل فیلترشده منتشر شد.' : 'همه باندل‌ها منتشر شد.');
    });
    $('unpubAllBtn').addEventListener('click', function () {
      if (filterCount() > 0) { view.rows.forEach(function (b) { delete state.published[pubKey(b)]; }); }
      else state.published = {}; // also drops entries that no longer match current prices
      store.set('published', state.published);
      renderTable();
      renderBroker();
      toast(filterCount() > 0 ? 'انتشار باندل‌های فیلترشده لغو شد.' : 'انتشار همه باندل‌ها لغو شد.');
    });
    $('moreBtn').addEventListener('click', function () { state.limit += PAGE; renderTable(); });
    $('csvBtn').addEventListener('click', exportCSV);
    $('printBtn').addEventListener('click', printAll);
    $('brokerPrint').addEventListener('click', function () { window.print(); });
    $('shareBtn').addEventListener('click', shareLink);
    $('shareCopy').addEventListener('click', copyShare);
    $('resetBtn').addEventListener('click', resetDefaults);
    $('clearBtn').addEventListener('click', clearData);
    $('offerClear').addEventListener('click', clearOffer);
    $('brokerClear').addEventListener('click', clearBrokerData);

    $('brokerBudget').addEventListener('input', function (e) {
      state.brokerBudget = e.target.value;
      store.set('brokerBudget', state.brokerBudget);
      renderBroker();
    });
    $('brokerBudget').addEventListener('focusout', function (e) {
      var n = C.parseAmount(e.target.value);
      if (!Number.isNaN(n)) { e.target.value = fmt(n); state.brokerBudget = e.target.value; store.set('brokerBudget', state.brokerBudget); }
    });

    function goTab(t) {
      closeMenu();
      state.tab = t;
      store.set('tab', state.tab);
      renderNav();
      renderBroker();
    }
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { goTab(b.getAttribute('data-tab')); });
    });
    $('goBundles').addEventListener('click', function () { goTab('bundles'); window.scrollTo(0, 0); });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var i = TABS.indexOf(state.tab) + (e.key === 'ArrowLeft' ? 1 : -1);   // RTL: left = next
      goTab(TABS[(i + TABS.length) % TABS.length]);
      $('tab-' + state.tab).focus();
    });

    // table header menu, chips, quick filter
    $('headRow').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-col]');
      if (!btn) return;
      var k = btn.getAttribute('data-col');
      if (menu.col === k) { closeMenu(); return; }
      openMenu(k, btn);
    });
    $('colMenu').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cm]');
      if (b) menuAction(b.getAttribute('data-cm'));
    });
    $('colMenu').addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-val') !== null) toggleMenuValue(t.getAttribute('data-val'), t.checked);
    });
    $('colMenu').addEventListener('input', function (e) {
      if (e.target.id === 'menuSearch') { menu.q = e.target.value; renderMenuList(); }
    });
    document.addEventListener('click', function (e) {
      if ($('colMenu').hidden) return;
      if (e.target.closest('#colMenu') || e.target.closest('button[data-col]')) return;
      closeMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', closeMenu);
    $('chips').addEventListener('click', function (e) {
      var u = e.target.closest('button[data-unfilter]');
      if (u) { delete state.filters[u.getAttribute('data-unfilter')]; state.limit = PAGE; renderTable(); renderMenuIfOpen(); return; }
      if (e.target.closest('button[data-unsort]')) { state.sort = { key: null, dir: 1 }; renderTable(); }
    });
    $('clearFilters').addEventListener('click', clearAllFilters);
    $('onlyPub').addEventListener('change', function (e) { state.onlyPub = e.target.checked; state.limit = PAGE; renderTable(); renderMenuIfOpen(); });

    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) closeDialog(d); });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeDialog(b.closest('dialog')); });
    });

    window.addEventListener('hashchange', handleHash);
    window.addEventListener('online', netState);
    window.addEventListener('offline', netState);
  }

  function netState() { $('net').hidden = navigator.onLine !== false; }

  /* ---------- PWA ---------- */
  function setupPWA() {
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      $('installBtn').hidden = false;
    });
    $('installBtn').addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; $('installBtn').hidden = true; });
    });
    window.addEventListener('appinstalled', function () { $('installBtn').hidden = true; });

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var updateRequested = false;
    // Reload only after the user accepted an update. On the very first install the worker calls
    // clients.claim(), which also fires "controllerchange" — reloading then would restart the splash.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      function offerUpdate(worker) {
        function run() { updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); }
        $('updateBtn').hidden = false;           // stays visible until the user updates
        $('updateBtn').onclick = run;
        toast('نسخه جدید برنامه آماده است.', { label: 'به‌روزرسانی', run: run });
      }
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
    }).catch(function () { /* offline support is optional */ });
  }

  /* ---------- splash ---------- */
  function runSplash() {
    var s = $('splash');
    var FADE_MS = 350; // fade-out is inside the 5 s total
    setTimeout(function () { s.classList.add('is-leaving'); }, SPLASH_MS - FADE_MS);
    setTimeout(function () {
      s.hidden = true;
      document.body.classList.remove('is-splash');
    }, SPLASH_MS);
  }

  /* ---------- boot ---------- */
  function init() {
    runSplash();
    loadState();
    renderSettingsForm();
    $('brokerBudget').value = state.brokerBudget;
    bind();
    renderNav();
    updateAll();
    netState();
    handleHash();
    setupPWA();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
