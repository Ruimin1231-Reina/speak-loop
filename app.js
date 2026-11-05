/*
 * Speak Loop · app.js
 * 界面与交互。数据逻辑在 core.js，存储在 storage.js，同步在 sync.js。
 */
(function () {
  'use strict';

  const C = window.SLCore;
  const P = window.SLPrompts;
  const Store = window.SLStorage;
  const Speech = window.SLSpeech;
  const Sync = window.SLSync;
  const { h, icon, toast, copyText, readClipboard, formDialog } = window.SLUI;
  // 原生 append/replaceChildren 会把 null 和数组变成文字，统一用这个
  const add = (el, ...kids) => window.SLUI.append(el, kids);

  const APP_VERSION = '1.0.0';
  const $main = document.getElementById('main');
  const $nav = document.getElementById('nav');
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  let state = C.emptyState();
  const device = {
    deviceId: '',
    voiceURI: '',
    rate: 0.95,
    autoSpeak: true,
    installHintDismissed: false,
    sync: { owner: '', repo: '', branch: 'main', path: 'speak-loop-data.json', token: '', lastSyncAt: 0, lastError: '', status: 'off' }
  };
  const ui = {
    lastRoute: '',
    importText: '',
    importErrors: [],
    draft: null,
    session: null,
    libKind: 'vocab',
    libFilter: 'all',
    libQuery: '',
    focusAfter: null,
    // 听力：播放设置、当前播放内容、散步模式
    listen: { version: 'full', mode: 'read', loop: true, rate: 0, filter: 'all', exclude: {}, follow: true },
    playing: null,
    storyTab: 'full',
    walk: false
  };
  let syncing = false;
  let syncTimer = null;
  let syncAgain = false;

  // ---------- 保存与同步 ----------
  function saveState() {
    return Store.set('state', state).catch(err => {
      console.error(err);
      toast('保存失败：' + err.message, 'error');
    });
  }
  function saveDevice() {
    return Store.set('device', device).catch(err => console.error(err));
  }
  function commit() {
    saveState();
    scheduleSync();
    render();
  }
  function isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }
  function scheduleSync(delay) {
    if (!Sync.isConfigured(device.sync)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => runSync(false), delay == null ? 4000 : delay);
  }
  async function runSync(manual) {
    if (!Sync.isConfigured(device.sync)) {
      if (manual) toast('先填写 GitHub 用户名、仓库名和 Token');
      return;
    }
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    device.sync.status = 'busy';
    updateSyncLines();
    try {
      const res = await Sync.sync(device.sync, C.clone(state), C.mergeStates, C.stableStringify);
      const before = C.stableStringify(state);
      const next = C.mergeStates(state, res.merged);
      const nextStr = C.stableStringify(next);
      if (nextStr !== C.stableStringify(res.merged)) syncAgain = true; // 同步期间本机又有改动
      state = next;
      await saveState();
      device.sync.lastSyncAt = Date.now();
      device.sync.lastError = '';
      device.sync.status = 'ok';
      if (manual) toast(res.pushed ? '已同步到 GitHub' : '已经是最新的');
      if (nextStr !== before && !isTyping()) render();
    } catch (e) {
      console.error(e);
      device.sync.lastError = e.message || String(e);
      device.sync.status = 'error';
      if (manual) toast('同步失败：' + device.sync.lastError, 'error');
    } finally {
      syncing = false;
      await saveDevice();
      updateSyncLines();
      if (syncAgain) { syncAgain = false; scheduleSync(1500); }
    }
  }
  function timeAgo(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
    return Math.floor(d / 86400e3) + ' 天前';
  }
  function syncInfo() {
    const s = device.sync;
    if (!Sync.isConfigured(s)) return { cls: '', text: '同步未开启' };
    if (s.status === 'busy') return { cls: 'dot-busy', text: '正在同步…' };
    if (s.status === 'error') return { cls: 'dot-error', text: '同步失败' };
    if (s.lastSyncAt) return { cls: 'dot-ok', text: '已同步 · ' + timeAgo(s.lastSyncAt) };
    return { cls: '', text: '还没同步过' };
  }
  function syncLine() {
    const t = syncInfo();
    return h('a', { class: 'sync-line', href: '#/settings', 'data-sync-line': '1' },
      h('span', { class: 'dot ' + t.cls }), h('span', { text: t.text }));
  }
  function updateSyncLines() {
    document.querySelectorAll('[data-sync-line]').forEach(el => el.replaceWith(syncLine()));
  }

  // ---------- 导航与路由 ----------
  const NAV = [
    ['today', '今天', 'home'],
    ['review', '复习', 'review'],
    ['listen', '听力', 'headphones'],
    ['packs', '日报', 'packs'],
    ['library', '素材库', 'library'],
    ['settings', '设置', 'settings']
  ];
  function renderNav() {
    $nav.replaceChildren();
    add($nav,
      h('div', { class: 'nav-brand' },
        h('img', { src: 'icons/icon.svg', alt: '' }),
        h('div', {}, '口语工作台', h('small', { text: 'Speak Loop' }))),
      NAV.map(([r, label, ic]) => h('a', { class: 'nav-link', href: '#/' + r, 'data-route': r }, icon(ic, 22), h('span', { text: label }))),
      h('div', { class: 'nav-foot' }, syncLine()));
  }
  function updateNav(name) {
    const active = { pack: 'packs', import: 'packs', guide: 'settings', story: 'listen', retell: 'listen' }[name] || name;
    const due = C.countByTrack(state, Date.now()).all.total;
    $nav.querySelectorAll('.nav-link').forEach(a => {
      if (a.dataset.route === active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      if (a.dataset.route !== 'review') return;
      let badge = a.querySelector('.badge-dot');
      if (!due) { if (badge) badge.remove(); return; }
      if (!badge) { badge = h('span', { class: 'badge-dot' }); a.appendChild(badge); }
      badge.textContent = due > 99 ? '99+' : String(due);
      a.setAttribute('aria-label', '复习，' + due + ' 条待复习');
    });
  }
  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { name: parts[0] || 'today', params: parts.slice(1) };
  }
  function go(path) {
    const target = '#/' + path;
    if (location.hash === target) render();
    else location.hash = target;
  }
  const VIEWS = {};
  function render() {
    const r = route();
    const view = VIEWS[r.name] || VIEWS.today;
    const key = r.name + '/' + r.params.join('/');
    const changed = key !== ui.lastRoute;
    const active = document.activeElement;
    const fk = !changed && active && active.dataset ? active.dataset.fk : null;
    ui.lastRoute = key;
    let node;
    try {
      node = view.apply(null, r.params);
    } catch (e) {
      console.error(e);
      node = h('section', { class: 'page' }, h('div', { class: 'alert alert-error', role: 'alert', text: '页面出错了：' + e.message }));
    }
    $main.replaceChildren(node);
    updateNav(r.name);
    // 离开听力相关页面时停下朗读，免得和复习里的发音互相打断
    if (!['listen', 'story', 'retell'].includes(r.name) && player.state().playing && !ui.walk) player.pause();
    refreshPlayerUi();
    if (changed) {
      window.scrollTo(0, 0);
      const h1 = $main.querySelector('h1');
      if (h1 && !ui.focusAfter) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    } else if (fk) {
      const el = $main.querySelector('[data-fk="' + CSS.escape(fk) + '"]');
      if (el) el.focus({ preventScroll: true });
    }
    if (ui.focusAfter) {
      const el = $main.querySelector(ui.focusAfter);
      ui.focusAfter = null;
      if (el) el.focus({ preventScroll: true });
    }
  }
  window.addEventListener('hashchange', render);

  // ---------- 通用组件 ----------
  function say(text) { Speech.speak(text, { voiceURI: device.voiceURI, rate: device.rate }); }
  function speakBtn(text) {
    if (!Speech.canSpeak() || !text) return null;
    return h('button', {
      class: 'icon-btn', type: 'button', title: '朗读', 'aria-label': '朗读：' + text,
      onclick: e => { e.preventDefault(); e.stopPropagation(); say(text); }
    }, icon('speaker', 18));
  }
  function pageHead(eyebrow, title, sub, right) {
    return h('header', { class: 'page-head' },
      eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
      right ? h('div', { class: 'page-head-row' }, h('h1', { text: title }), right) : h('h1', { text: title }),
      sub ? h('p', { class: 'sub', text: sub }) : null);
  }
  function typeLabel(t) { return C.FIX_TYPES[t] || '其他'; }
  function stat(v, label) { return h('div', { class: 'stat' }, h('b', { text: String(v) }), h('span', { text: label })); }
  function field(id, label, control, hint) {
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hint ? h('p', { class: 'field-hint', text: hint }) : null);
  }
  function checkbox(key, label, hint, checked, onChange) {
    return h('label', { class: 'check', for: key },
      h('input', { type: 'checkbox', id: key, fk: key, checked: !!checked, onchange: e => onChange(e.target.checked) }),
      h('span', {}, h('span', { text: label }), hint ? h('span', { class: 'field-hint', style: { display: 'block' }, text: hint }) : null));
  }
  function clampInt(v, min, max, dflt) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  }

  function itemSummary(it) {
    if (it.form === 'sentence') {
      return h('div', { class: 'item-sum' },
        h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-star', text: '关键句' }), h('span', { class: 'en', text: it.term }), speakBtn(it.term)),
        it.cue ? h('p', { class: 'small muted', text: '提示：' + it.cue }) : null,
        it.meaning_zh && state.settings.showZh ? h('p', { class: 'small muted', text: it.meaning_zh }) : null);
    }
    if (it.form === 'upgrade') {
      return h('div', { class: 'item-sum' },
        h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-plain', text: '普通' }), h('span', { class: 'en', text: it.original })),
        h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-good', text: '更好' }), h('span', { class: 'en', text: it.corrected }), speakBtn(it.corrected)),
        it.why_zh ? h('p', { class: 'small muted', text: it.why_zh }) : null,
        h('div', { class: 'chips' }, h('span', { class: 'chip chip-primary', text: '说法升级' })));
    }
    if (it.kind === 'fix') {
      return h('div', { class: 'item-sum' },
        h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-bad', text: '原句' }), h('span', { class: 'en', text: it.original })),
        h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-good', text: '改正' }), h('span', { class: 'en', text: it.corrected }), speakBtn(it.corrected)),
        it.natural ? h('p', { class: 'fix-line' }, h('span', { class: 'tag tag-star', text: '地道' }), h('span', { class: 'en', text: it.natural }), speakBtn(it.natural)) : null,
        it.why_zh ? h('p', { class: 'small muted', text: it.why_zh }) : null,
        h('div', { class: 'chips' },
          h('span', { class: 'chip chip-accent', text: typeLabel(it.type) }),
          it.focus ? h('span', { class: 'chip', text: '记住：' + it.focus }) : null));
    }
    return h('div', { class: 'item-sum' },
      h('div', { class: 'term-line' },
        h('span', { class: 'term', text: it.term }),
        it.pos ? h('span', { class: 'pos', text: it.pos }) : null,
        speakBtn(it.term)),
      it.meaning_en ? h('p', { class: 'muted', text: it.meaning_en }) : null,
      it.meaning_zh && state.settings.showZh ? h('p', { class: 'small muted', text: it.meaning_zh }) : null,
      it.usage ? h('p', { class: 'tiny muted', text: '用法：' + it.usage }) : null,
      it.example ? h('p', { class: 'example' }, h('span', { text: '“' + it.example + '”' }), speakBtn(it.example)) : null);
  }

  function editorFields(it) {
    if (it.form === 'sentence') {
      return [
        { key: 'term', label: '关键句', type: 'textarea', rows: 3, required: true, value: it.term },
        { key: 'cue', label: '提示（复习时当题目）', value: it.cue, hint: '用英文写这句话在讲什么，不要直接翻译' },
        { key: 'meaning_zh', label: '中文意思（可以空着）', value: it.meaning_zh }
      ];
    }
    if (it.form === 'upgrade') {
      return [
        { key: 'original', label: '普通说法', type: 'textarea', required: true, value: it.original },
        { key: 'corrected', label: '更好的说法', type: 'textarea', required: true, value: it.corrected },
        { key: 'why_zh', label: '为什么更好（中文）', type: 'textarea', value: it.why_zh }
      ];
    }
    if (it.kind === 'fix') {
      return [
        { key: 'original', label: '你当时说', type: 'textarea', required: true, value: it.original },
        { key: 'corrected', label: '改正', type: 'textarea', required: true, value: it.corrected },
        { key: 'natural', label: '更地道的说法（可以空着）', type: 'textarea', value: it.natural },
        { key: 'why_zh', label: '为什么（中文）', type: 'textarea', value: it.why_zh },
        { key: 'focus', label: '要记住的部分', value: it.focus },
        { key: 'type', label: '问题类型', type: 'select', value: it.type || 'other', options: Object.keys(C.FIX_TYPES).map(k => [k, C.FIX_TYPES[k]]) }
      ];
    }
    const f = [{ key: 'term', label: it.kind === 'vocab' ? '单词' : '表达', required: true, value: it.term }];
    if (it.kind === 'vocab') f.push({ key: 'pos', label: '词性', value: it.pos });
    f.push(
      { key: 'meaning_en', label: '英文释义（复习时当题目）', type: 'textarea', value: it.meaning_en, hint: '释义里不要出现这个词本身' },
      { key: 'meaning_zh', label: '中文意思', value: it.meaning_zh });
    if (it.kind === 'expr') f.push({ key: 'usage', label: '用法 / 场合', value: it.usage });
    f.push(
      { key: 'example', label: '例句', type: 'textarea', value: it.example },
      { key: 'context', label: '当时想说的', type: 'textarea', value: it.context });
    return f;
  }
  async function editItem(id) {
    const it = state.items[id];
    if (!it) return;
    const data = await formDialog({ title: '编辑' + C.KIND_LABEL[it.kind], fields: editorFields(it) });
    if (!data) return;
    const cur = state.items[id]; // 弹窗期间可能同步过，重新取
    if (!cur) return;
    Object.assign(cur, data, { updatedAt: Date.now() });
    if (cur.kind === 'fix' && cur.natural === cur.corrected) cur.natural = '';
    commit();
    toast('已保存');
  }
  function setStatus(id, status) {
    const it = state.items[id];
    if (!it) return;
    it.status = status;
    it.updatedAt = Date.now();
    commit();
  }
  function removeItem(id) {
    const it = state.items[id];
    if (!it) return;
    const name = it.kind === 'fix' ? it.original : it.term;
    if (!window.confirm('删除「' + name + '」？')) return;
    setStatus(id, 'removed');
    toast('已删除');
  }
  function statusChip(it) {
    const label = C.dueLabel(it, Date.now());
    const cls = it.status === 'saved' ? 'chip'
      : label === '新' ? 'chip chip-accent'
        : label === '已掌握' ? 'chip chip-good'
          : label === '今天复习' ? 'chip chip-warn' : 'chip chip-primary';
    return h('span', { class: cls, text: label });
  }
  function itemRow(it) {
    return h('div', { class: 'item-row' },
      itemSummary(it),
      h('div', { class: 'item-actions' },
        statusChip(it),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setStatus(it.id, it.status === 'active' ? 'saved' : 'active') },
          it.status === 'active' ? '移出复习' : '加入复习'),
        h('button', { class: 'icon-btn', type: 'button', title: '编辑', 'aria-label': '编辑', onclick: () => editItem(it.id) }, icon('edit', 18)),
        h('button', { class: 'icon-btn', type: 'button', title: '删除', 'aria-label': '删除', onclick: () => removeItem(it.id) }, icon('trash', 18))));
  }
  function scoreBars(scores) {
    const names = { overall: '综合', fluency: '流利度', grammar: '语法', vocabulary: '词汇', naturalness: '自然度' };
    const keys = Object.keys(names).filter(k => scores && scores[k] != null);
    if (!keys.length) return null;
    return h('div', { class: 'stack' },
      h('div', { class: 'bars' }, keys.map(k => h('div', { class: 'bar-row' },
        h('span', { class: 'small', text: names[k] }),
        h('div', { class: 'bar bar-primary', role: 'img', 'aria-label': names[k] + ' ' + scores[k] + ' 分' }, h('span', { style: { width: scores[k] + '%' } })),
        h('span', { class: 'small muted', text: String(scores[k]) })))),
      h('p', { class: 'tiny muted', text: '导入的数值仅供参考，不是官方评分。' }));
  }
  function winsList(wins, withDate) {
    return h('ul', { class: 'wins' }, wins.map(w => h('li', {},
      icon('star', 16),
      h('div', { class: 'grow' },
        h('p', { class: 'en', text: w.sentence }),
        (w.why_zh || withDate) ? h('p', { class: 'small muted', text: [withDate ? w.date : '', w.why_zh].filter(Boolean).join(' · ') }) : null),
      speakBtn(w.sentence))));
  }

  // ---------- 今天 ----------
  function greeting(now) {
    const hr = new Date(now).getHours();
    const g = hr < 5 ? '夜深了' : hr < 11 ? '早上好' : hr < 13 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
    const name = String(state.settings.name || '').trim();
    return name ? g + '，' + name : g;
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function installHint() {
    if (device.installHintDismissed || isStandalone() || !isIOS() || location.protocol !== 'https:') return null;
    return h('div', { class: 'alert alert-info' },
      h('p', {}, h('b', { text: '装到主屏幕：' }), '在 Safari 里点「分享」按钮，选「添加到主屏幕」。以后从主屏幕打开，像 App 一样用。'),
      h('div', {}, h('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        onclick: () => { device.installHintDismissed = true; saveDevice(); render(); }
      }, '知道了')));
  }

  VIEWS.today = function () {
    const now = Date.now();
    const hasItems = Object.values(state.items).some(i => i.status !== 'removed');
    return h('section', { class: 'page' },
      h('header', { class: 'page-head' },
        h('div', { class: 'page-head-row' }, h('p', { class: 'eyebrow', text: C.formatDateCN(now) }), syncLine()),
        h('h1', { text: greeting(now) }),
        h('p', { class: 'sub', text: '说出来，才算学会。' })),
      installHint(),
      focusCard(now, hasItems),
      storiesTodayCard(now),
      h('div', { class: 'grid-2' }, targetsCard(), latestCard(C.latestPack(state))),
      progressCard(now));
  };

  function focusCard(now, hasItems) {
    const q = C.buildQueue(state, { track: 'all', now });
    const by = { vocab: 0, expr: 0, fix: 0 };
    let fresh = 0;
    for (const id of q) {
      const it = state.items[id];
      by[it.kind]++;
      if (it.srs.state === 'new') fresh++;
    }
    const kids = [h('p', { class: 'eyebrow', text: '今日复习' })];
    if (q.length) {
      kids.push(
        h('h2', { text: q.length + ' 条等你说出来' }),
        h('p', { class: 'hero-sub', text: '单词 ' + by.vocab + ' · 表达 ' + by.expr + ' · 纠错 ' + by.fix + (fresh ? '（含 ' + fresh + ' 条新内容）' : '') }));
    } else {
      kids.push(
        h('h2', { text: hasItems ? '今天的复习完成了' : '还没有素材' }),
        h('p', { class: 'hero-sub', text: hasItems ? '去和 ChatGPT 聊一会儿，聊完导入新的 Pack。' : '先和 ChatGPT Live 聊一次，再把 Pack 导入进来。' }));
    }
    kids.push(h('div', { class: 'row' },
      q.length ? h('button', { class: 'btn btn-hero', type: 'button', onclick: () => startSession('all', false) }, '开始复习', icon('right', 18)) : null,
      h('button', { class: q.length ? 'btn btn-hero-ghost' : 'btn btn-hero', type: 'button', onclick: () => go('import') }, icon('plus', 18), '导入 Pack'),
      hasItems ? null : h('button', { class: 'btn btn-hero-ghost', type: 'button', onclick: () => go('guide') }, '使用步骤')));
    return h('div', { class: 'card hero' }, kids);
  }

  function targetsCard() {
    const targets = C.pickTargets(state);
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { text: '下次聊天，用上它们' }), h('span', { class: 'chip chip-accent', text: 'Use again' })),
      targets.length
        ? h('ul', { class: 'target-list' }, targets.map((t, i) => h('li', {},
          h('span', { class: 'num', text: String(i + 1).padStart(2, '0') }),
          h('div', { class: 'grow' },
            h('p', { class: 'term en', text: t.text }),
            t.meaning ? h('p', { class: 'small muted', text: t.meaning }) : null),
          speakBtn(t.text))))
        : h('p', { class: 'muted small', text: '导入 Pack 后，这里会出现下次要刻意用上的表达。' }),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => copyText(C.buildOpener(targets), '开场白已复制：在 ChatGPT 项目里先发这段，再开 Live')
      }, icon('chat', 18), '复制开场白给 ChatGPT'));
  }

  function latestCard(p) {
    if (!p) {
      return h('div', { class: 'card' },
        h('h3', { text: '最新日报' }),
        h('p', { class: 'muted small', text: '还没有日报。和 ChatGPT 聊完后发「' + P.PACK_COMMAND + '」，把它给的内容复制进来。' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: loadSample }, '先用示例试试'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('guide') }, '使用步骤')));
    }
    const items = C.packItems(state, p.id);
    const n = k => items.filter(i => i.kind === k).length;
    return h('a', { class: 'card card-link', href: '#/pack/' + encodeURIComponent(p.id) },
      h('div', { class: 'card-head' },
        h('h3', { text: '最新日报' }),
        h('span', { class: 'chip', text: p.date + (p.revision > 1 ? ' · 第 ' + p.revision + ' 版' : '') })),
      h('p', { class: 'pack-title', text: p.title }),
      p.summary_zh ? h('p', { class: 'muted small clamp-3', text: p.summary_zh }) : null,
      h('p', { class: 'tiny muted', text: '单词 ' + n('vocab') + ' · 表达 ' + n('expr') + ' · 纠错 ' + n('fix') + ' · 亮点 ' + (p.went_well || []).length }),
      h('span', { class: 'link' }, '查看日报', icon('right', 16)));
  }

  function progressCard(now) {
    const st = C.streak(state, now);
    const lib = C.libraryStats(state, now);
    const hm = C.heatmapData(state, now, 18);
    const series = C.scoreSeries(state);
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { text: '学习记录' }), st.today ? h('span', { class: 'chip chip-good', text: '今天已打卡' }) : null),
      h('div', { class: 'stats' },
        stat(st.days, '连续天数'),
        stat(lib.active, '复习中'),
        stat(lib.mastered, '已掌握'),
        stat(C.reviewsInLastDays(state, now, 7), '7天复习')),
      heatmap(hm),
      series.length >= 2 ? sparkline(series) : null);
  }
  function heatmap(hm) {
    const label = '近 ' + hm.weeks + ' 周有 ' + hm.activeDays + ' 天在学习';
    const grid = h('div', { class: 'heatmap', role: 'img', 'aria-label': label });
    for (const c of hm.cells) {
      grid.appendChild(c
        ? h('span', { class: 'heat l' + c.level, title: c.day + '：复习 ' + c.reviews + ' 次' + (c.imports ? '，导入 ' + c.imports + ' 份 Pack' : '') })
        : h('span', { class: 'heat future' }));
    }
    return h('div', { class: 'stack' }, grid, h('p', { class: 'tiny muted', text: label + '。颜色越深，当天练得越多。' }));
  }
  function sparkline(series) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 300;
    const H = 60;
    const pad = 6;
    const vals = series.map(s => s.value);
    const min = Math.min(...vals) - 5;
    const max = Math.max(...vals) + 5;
    const x = i => pad + (W - 2 * pad) * (i / (series.length - 1));
    const y = v => H - pad - (H - 2 * pad) * ((v - min) / Math.max(1, max - min));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', series.map((s, i) => x(i).toFixed(1) + ',' + y(s.value).toFixed(1)).join(' '));
    svg.appendChild(line);
    const first = series[0];
    const last = series[series.length - 1];
    return h('div', { class: 'stack' },
      h('p', { class: 'small' }, h('b', { text: 'ChatGPT 评分趋势　' }),
        h('span', { class: 'muted', text: first.date.slice(5) + '：' + first.value + ' → ' + last.date.slice(5) + '：' + last.value })),
      svg);
  }

  // ---------- 复习 ----------
  VIEWS.review = function () {
    if (ui.session) return ui.session.queue.length ? sessionCard() : sessionSummary();
    const now = Date.now();
    const counts = C.countByTrack(state, now);
    const lib = C.libraryStats(state, now);
    const tracks = [
      ['all', '全部', '混合复习'],
      ['vocab', '单词', '看释义说单词'],
      ['expr', '表达', '看意思说表达'],
      ['fix', '纠错', '把错句说对']
    ];
    return h('section', { class: 'page' },
      pageHead('Active recall', '复习', '先想、先大声说出来，再揭晓答案。'),
      h('div', { class: 'tracks' }, tracks.map(([t, name, desc]) => {
        const c = counts[t];
        return h('button', {
          class: 'track' + (t === 'all' ? ' track-all' : ''), type: 'button', disabled: !c.total,
          'aria-label': name + '，' + c.total + ' 条', onclick: () => startSession(t, false)
        },
        h('span', { class: 't-name', text: name }),
        h('b', { text: String(c.total) }),
        h('span', { class: 'tiny muted', text: c.new ? '含新内容 ' + c.new + ' 条' : desc }));
      })),
      counts.all.total === 0 ? h('div', { class: 'card' },
        h('h3', { text: lib.active ? '今天没有要复习的了' : '还没有可以复习的内容' }),
        h('p', { class: 'muted small', text: lib.active
          ? '想多练一会儿，可以挑最容易忘的 10 条加练。加练不会打乱复习计划，只有选「忘了」才会让它提前回来。'
          : '先导入一份 Pack，或者用示例试试。' }),
        h('div', { class: 'row' }, lib.active
          ? h('button', { class: 'btn', type: 'button', onclick: () => startSession('all', true) }, icon('target', 18), '加练最弱的 10 条')
          : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('import') }, icon('plus', 18), '导入 Pack'))) : null,
      rulesCard());
  };

  function rulesCard() {
    return h('details', { class: 'card rules' },
      h('summary', { text: '复习规则怎么算' }),
      h('ul', {},
        h('li', { text: '忘了：10 分钟后再出现，这一轮结束前还会再问一次。' }),
        h('li', { text: '有提示才想起：明天再来，之后间隔增长得慢一些。' }),
        h('li', { text: '想起来了：新内容 2 天后再见，之后每次间隔约乘 2.5。' }),
        h('li', { text: '脱口而出：新内容 4 天后再见，之后间隔拉得更长。' }),
        h('li', { text: '间隔超过 21 天算「已掌握」，之后仍会偶尔回来检查。' }),
        h('li', { text: '每天新内容和复习的上限可以在「设置」里调。' })));
  }

  function startSession(track, extra) {
    const now = Date.now();
    const ids = extra ? C.buildExtraQueue(state, { track, n: 10 }) : C.buildQueue(state, { track, now });
    if (!ids.length) {
      toast(extra ? '还没有复习过的内容可以加练' : '现在没有需要复习的内容');
      return;
    }
    ui.session = {
      track, extra: !!extra, queue: ids.slice(), total: ids.length, done: 0,
      revealed: false, hint: 0, heard: null, listening: false,
      results: { 1: 0, 2: 0, 3: 0, 4: 0 }, again: {}
    };
    ui.focusAfter = '#reveal-btn';
    go('review');
  }

  function currentItem() {
    const s = ui.session;
    while (s.queue.length) {
      const it = state.items[s.queue[0]];
      if (it && it.status === 'active') return it;
      s.queue.shift();
      s.total = Math.max(s.done, s.total - 1);
    }
    return null;
  }

  function sessionCard() {
    const s = ui.session;
    const item = currentItem();
    if (!item) return sessionSummary();
    const k = item.kind;
    const pct = s.total ? Math.round(100 * s.done / s.total) : 0;
    const card = h('div', { class: 'card recall' });
    add(card, h('div', { class: 'card-head' },
      h('p', { class: 'eyebrow', text: item.form === 'sentence' ? '关键句回忆' : item.form === 'upgrade' ? '说法升级' : { vocab: '单词回忆', expr: '表达回忆', fix: '纠错重说' }[k] }),
      item.srs.state === 'new' ? h('span', { class: 'chip chip-accent', text: '新' }) : s.extra ? h('span', { class: 'chip', text: '加练' }) : null));
    if (item.form === 'sentence') {
      add(card,
        h('p', { class: 'instruction', text: '看提示，大声说出这句话。用自己的话说对意思也行，揭晓后再对照。' }),
        h('p', { class: 'prompt en', text: item.cue || item.meaning_zh || '（没有提示，直接揭晓吧）' }));
    } else if (item.form === 'upgrade') {
      add(card,
        h('p', { class: 'instruction', text: '把这句换成更准确、更地道的说法，大声说出来。' }),
        h('p', { class: 'prompt prompt-fix en', text: item.original }));
    } else if (k === 'fix') {
      add(card,
        h('p', { class: 'instruction', text: '这句话哪里不对？大声说出正确的说法。' }),
        h('p', { class: 'prompt prompt-fix en', text: item.original }),
        h('p', { class: 'meta', text: '问题类型：' + typeLabel(item.type) }));
    } else {
      const promptText = item.meaning_en || item.meaning_zh || C.blankExample(item.example, item.term) || '（没有释义，直接揭晓吧）';
      add(card,
        h('p', { class: 'instruction', text: k === 'vocab' ? '看释义，大声说出这个英文单词。' : '看意思，大声说出这个英文表达。' }),
        h('p', { class: 'prompt en', text: promptText }),
        (item.pos || item.usage) ? h('p', { class: 'meta', text: [item.pos, item.usage].filter(Boolean).join(' · ') }) : null);
    }
    if (s.hint > 0 && !s.revealed) add(card, hintBox(item, s.hint));
    if (s.heard) add(card, heardBox(s.heard));
    if (!s.revealed) {
      add(card,
        h('div', { class: 'row' },
          h('button', {
            class: 'btn btn-ghost', type: 'button', disabled: s.hint >= 2, 'aria-keyshortcuts': 'H',
            onclick: () => { s.hint = Math.min(2, s.hint + 1); render(); }
          }, icon('bulb', 18), s.hint ? '再给点提示' : '提示'),
          Speech.canListen() ? h('button', {
            class: 'btn btn-ghost', type: 'button', disabled: s.listening, 'aria-keyshortcuts': 'M',
            onclick: () => listenFor(item)
          }, icon('mic', 18), s.listening ? '正在听…' : '说出来检查') : null),
        h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', id: 'reveal-btn', 'aria-keyshortcuts': 'Space', onclick: reveal }, icon('eye', 18), '显示答案'),
        h('p', { class: 'kbd-hint', text: '快捷键：空格 显示答案 · H 提示 · M 语音检查' }));
    } else {
      add(card, answerBox(item), ratingBox(item));
    }
    return h('section', { class: 'page' },
      h('h1', { class: 'sr-only', text: '复习中' }),
      h('div', { class: 'review-top' },
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: endSession }, icon('x', 16), '结束'),
        h('div', {
          class: 'progress', role: 'progressbar', 'aria-label': '复习进度',
          'aria-valuemin': '0', 'aria-valuemax': String(s.total), 'aria-valuenow': String(s.done)
        }, h('span', { style: { width: pct + '%' } })),
        h('span', { class: 'small muted', text: s.done + ' / ' + s.total })),
      card);
  }

  function hintBox(item, level) {
    const lines = [];
    if (item.kind === 'fix') {
      if (item.why_zh) lines.push(h('p', { text: '提示：' + item.why_zh }));
      if (level >= 2 || !item.why_zh) {
        lines.push(h('p', {}, '记住这块：', h('span', { class: 'en', text: item.focus || C.hintPattern(item.corrected) })));
      }
    } else {
      const promptIsExample = !item.meaning_en && !item.meaning_zh;
      const blank = promptIsExample ? '' : C.blankExample(item.example, item.term);
      if (blank) lines.push(h('p', { class: 'en', text: blank }));
      if (level >= 2 || !blank) lines.push(h('p', {}, '首字母：', h('span', { class: 'en', text: C.hintPattern(item.term) })));
      if (level >= 2 && state.settings.showZh && item.meaning_zh && item.meaning_en) lines.push(h('p', { text: '中文：' + item.meaning_zh }));
    }
    return h('div', { class: 'hint-box', role: 'status' }, lines);
  }
  function heardBox(m) {
    if (m.level === 'error') return h('div', { class: 'heard heard-error', role: 'status', text: m.message });
    const verdict = { exact: '和答案文字很接近', close: '和答案文字部分接近', miss: '和答案文字不太接近' }[m.level];
    return h('div', { class: 'heard heard-' + m.level, role: 'status' },
      h('b', { text: verdict }),
      h('span', { class: 'small', text: '这是识别文字与参考答案的比对，不判断意思或发音；请按自己的实际表现评分。' }),
      h('span', { class: 'small', text: '识别到：' + (m.transcript || '（没听清）') }));
  }
  function listenFor(item) {
    const s = ui.session;
    if (!s || s.listening) return;
    const answers = item.kind === 'fix' ? [item.corrected, item.natural].filter(Boolean) : [item.term];
    s.listening = true;
    s.heard = null;
    render();
    const done = () => { if (ui.session === s && s.listening) { s.listening = false; render(); } };
    const timer = setTimeout(done, 15000);
    Speech.listen({
      onResult: alts => { if (ui.session === s) s.heard = C.matchSpoken(alts, answers); },
      onError: msg => { if (ui.session === s) s.heard = { level: 'error', message: msg }; },
      onEnd: () => { clearTimeout(timer); done(); }
    });
  }
  function suggestedRating(s) {
    if (s.heard && s.heard.level === 'exact') return s.hint ? 2 : 3;
    if (s.heard && s.heard.level === 'close') return 2;
    if (s.heard && s.heard.level === 'miss') return 1;
    return s.hint ? 2 : 3;
  }
  function reveal() {
    const s = ui.session;
    if (!s || s.revealed) return;
    const item = currentItem();
    if (!item) return;
    s.revealed = true;
    ui.focusAfter = '#rate-' + suggestedRating(s);
    render();
    if (device.autoSpeak) say(item.kind === 'fix' ? item.corrected : item.term);
  }
  function answerBox(item) {
    if (item.form === 'sentence') {
      return h('div', { class: 'answer' },
        h('div', { class: 'answer-line' }, h('span', { class: 'tag tag-star', text: '关键句' }), h('span', { class: 'en grow', text: item.term }), speakBtn(item.term)),
        item.meaning_zh && state.settings.showZh ? h('p', { class: 'small muted', text: item.meaning_zh }) : null);
    }
    if (item.form === 'upgrade') {
      return h('div', { class: 'answer' },
        h('div', { class: 'answer-line' }, h('span', { class: 'tag tag-good', text: '更好' }), h('span', { class: 'en grow', text: item.corrected }), speakBtn(item.corrected)),
        item.why_zh ? h('p', { class: 'small muted', text: item.why_zh }) : null);
    }
    if (item.kind === 'fix') {
      return h('div', { class: 'answer' },
        h('div', { class: 'answer-line' }, h('span', { class: 'tag tag-good', text: '改正' }), h('span', { class: 'en grow', text: item.corrected }), speakBtn(item.corrected)),
        item.natural ? h('div', { class: 'answer-line' }, h('span', { class: 'tag tag-star', text: '地道' }), h('span', { class: 'en grow', text: item.natural }), speakBtn(item.natural)) : null,
        item.why_zh ? h('p', { class: 'small muted', text: item.why_zh }) : null,
        item.focus ? h('div', { class: 'chips' }, h('span', { class: 'chip chip-primary', text: '记住：' + item.focus })) : null);
    }
    return h('div', { class: 'answer' },
      h('div', { class: 'answer-term' },
        h('span', { class: 'en', text: item.term }),
        item.pos ? h('span', { class: 'pos', text: item.pos }) : null,
        speakBtn(item.term)),
      item.meaning_zh && state.settings.showZh ? h('p', { class: 'muted', text: item.meaning_zh }) : null,
      item.example ? h('div', { class: 'answer-line' }, h('span', { class: 'en grow', text: '“' + item.example + '”' }), speakBtn(item.example)) : null,
      item.context ? h('p', { class: 'small muted', text: '当时：' + item.context }) : null);
  }
  function ratingBox(item) {
    const s = ui.session;
    const prev = C.previewIntervals(item.srs, Date.now(), s.extra);
    const sug = (s.heard && s.heard.level !== 'error') || s.hint ? suggestedRating(s) : null;
    const opts = [[1, '忘了', 'again'], [2, '有提示才想起', 'hard'], [3, '想起来了', 'good'], [4, '脱口而出', 'easy']];
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted', text: '刚才说得怎么样？按真实表现选。' }),
      h('div', { class: 'ratings', role: 'group', 'aria-label': '给这次回忆打分' }, opts.map(([r, label, cls]) => h('button', {
        class: 'rate rate-' + cls + (sug === r ? ' suggested' : ''), type: 'button', id: 'rate-' + r,
        'aria-keyshortcuts': String(r), 'aria-label': label + '，下次 ' + prev[r], onclick: () => rate(r)
      },
      h('span', { class: 'rate-label', text: label }),
      h('span', { class: 'rate-next', text: prev[r] }),
      h('kbd', { text: String(r) })))),
      h('p', { class: 'kbd-hint', text: '快捷键：1–4 打分' }));
  }
  function rate(r) {
    const s = ui.session;
    if (!s || !s.revealed) return;
    const item = currentItem();
    if (!item) return;
    s.queue.shift();
    C.applyRating(state, item.id, r, { now: Date.now(), deviceId: device.deviceId, extra: s.extra });
    s.results[r]++;
    s.done++;
    if (r === 1 && (s.again[item.id] || 0) < 2) {
      s.again[item.id] = (s.again[item.id] || 0) + 1;
      s.queue.push(item.id);
      s.total++;
    }
    s.revealed = false;
    s.hint = 0;
    s.heard = null;
    s.listening = false;
    ui.focusAfter = s.queue.length ? '#reveal-btn' : '#summary-primary';
    commit();
  }
  function endSession() {
    const s = ui.session;
    if (!s) return;
    if (!s.done) { ui.session = null; render(); return; }
    s.queue = [];
    ui.focusAfter = '#summary-primary';
    render();
  }
  function sessionSummary() {
    const s = ui.session;
    const more = C.countByTrack(state, Date.now()).all.total;
    const r = s.results;
    const leave = () => { ui.session = null; };
    return h('section', { class: 'page' },
      pageHead('复习完成', '这一轮说了 ' + s.done + ' 次', '能在没有提示时说出来，才算真的会了。'),
      h('div', { class: 'card' },
        h('div', { class: 'result-grid' }, stat(r[1], '忘了'), stat(r[2], '有提示'), stat(r[3], '想起来了'), stat(r[4], '脱口而出')),
        r[1] ? h('p', { class: 'small muted', text: '忘了的条目这一轮已经多问了一次，之后也会比别的更早回来。' }) : null),
      h('div', { class: 'row' },
        more
          ? h('button', { class: 'btn btn-primary', type: 'button', id: 'summary-primary', onclick: () => { leave(); startSession('all', false); } }, '继续复习（还有 ' + more + ' 条）')
          : h('button', { class: 'btn btn-primary', type: 'button', id: 'summary-primary', onclick: () => { leave(); go('today'); } }, '回到今天'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { leave(); copyText(C.buildOpener(C.pickTargets(state)), '开场白已复制，去 ChatGPT 聊吧'); go('today'); }
        }, icon('chat', 18), '复制开场白，去聊天')));
  }

  document.addEventListener('keydown', e => {
    if (route().name !== 'review' || !ui.session || !ui.session.queue.length) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (document.getElementById('dialog').open) return;
    const s = ui.session;
    if (!s.revealed) {
      if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); reveal(); }
      else if (e.key === 'h' || e.key === 'H') { if (s.hint < 2) { s.hint++; render(); } }
      else if ((e.key === 'm' || e.key === 'M') && Speech.canListen()) { const it = currentItem(); if (it) listenFor(it); }
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      rate(Number(e.key));
    }
  });

  // ---------- 导入 ----------
  function chatPromptButtons() {
    return h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: copyInstructions }, icon('copy', 16), '复制项目设置'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(P.START_CONVERSATION_COMMAND, '已复制开场白') }, '复制开场白'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(P.configuredPackCommand(), '已复制生成 Pack 指令') }, '复制生成 Pack'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(P.standalonePackRequest(Date.now()), '已复制独立 Pack 请求') }, '复制独立 Pack'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(P.convertRecapRequest(Date.now()), '已复制转换请求：发到 ChatGPT 写复盘的那个对话里') }, '复制转换请求'),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => copyText(P.repairPackRequest(Date.now()), '已复制修复请求') }, '复制修复请求'));
  }

  VIEWS.import = function () {
    if (ui.draft) return importPreview();
    const ta = h('textarea', {
      class: 'input mono', id: 'pack-input', rows: '10', fk: 'pack-input', spellcheck: 'false', autocapitalize: 'off',
      'aria-label': 'Pack 内容', value: ui.importText,
      placeholder: '粘贴 ChatGPT 生成的 JSON Pack，或选择一个 .json 文件。前后多余文字会自动忽略。'
    });
    ta.addEventListener('input', () => { ui.importText = ta.value; });
    const packFile = h('input', {
      type: 'file', accept: 'application/json,.json', class: 'hidden', id: 'pack-json-file',
      onchange: e => { const f = e.target.files && e.target.files[0]; if (f) importPackFile(f); e.target.value = ''; }
    });
    const canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
    return h('section', { class: 'page' },
      h('a', { class: 'link back', href: '#/packs' }, icon('left', 16), '日报'),
      pageHead('导入', '导入 Daily Pack', '粘贴或选择 JSON 文件 → 筛选 → 进入复习。'),
      h('div', { class: 'card' },
        h('ol', { class: 'steps' },
          h('li', {}, '在 ChatGPT 的同一个对话里发送「', h('b', { text: P.PACK_COMMAND }), '」。'),
          h('li', { text: '复制它回复的 JSON 代码块，或保存为 .json 文件。' }),
          h('li', { text: '回到这里粘贴或选文件，再点「解析」。' })),
        chatPromptButtons()),
      h('div', { class: 'card' },
        ta,
        ui.importErrors.length ? (() => {
          const noItems = ui.importErrors.some(e => e.includes('没有可导入的单词、表达或纠错内容'));
          return h('div', { class: 'alert ' + (noItems ? 'alert-info' : 'alert-error'), role: noItems ? 'status' : 'alert' },
            h('b', { text: noItems ? '这次没有复习素材' : '没能导入' }),
            h('ul', {}, ui.importErrors.map(e => h('li', { text: e }))),
            h('div', { class: 'row' },
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(P.repairPackRequest(Date.now()), '已复制修复请求') }, '复制修复请求'),
              noItems ? h('button', {
                class: 'btn btn-sm btn-ghost', type: 'button',
                onclick: () => { ui.importText = ''; ui.importErrors = []; render(); }
              }, '清空并跳过') : null));
        })() : null,
        h('div', { class: 'row' },
          canPaste ? h('button', { class: 'btn', type: 'button', onclick: pasteAndParse }, icon('clipboard', 18), '从剪贴板粘贴') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => packFile.click() }, icon('upload', 18), '选择 JSON 文件'),
          packFile,
          h('button', { class: 'btn btn-primary', type: 'button', id: 'parse-btn', onclick: () => parseImport(ui.importText) }, '解析'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: loadSample }, '载入示例 Pack'))));
  };

  function importPackFile(file) {
    const isJsonName = /\.json$/i.test(file.name || '');
    const type = String(file.type || '').toLowerCase();
    const isJsonType = !type || /(?:^|\/)(?:x-)?json(?:;|$)/.test(type) || /\+json(?:;|$)/.test(type) ||
      /^(?:text\/plain|application\/octet-stream)(?:;|$)/.test(type);
    if (!isJsonName || !isJsonType) {
      ui.importErrors = ['请选择 JSON 格式的 Pack 文件（.json）。'];
      render();
      return;
    }
    if (file.size <= 0) {
      ui.importErrors = ['这个文件是空的。请选择包含 Pack JSON 的文件。'];
      render();
      return;
    }
    if (file.size > 1024 * 1024) {
      ui.importErrors = ['文件超过 1 MB，无法作为 Daily Pack 导入。请只选择 ChatGPT 导出的 Pack JSON。'];
      render();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      ui.importText = String(reader.result || '');
      parseImport(ui.importText);
    };
    const readFailed = () => {
      ui.importErrors = ['读取文件失败。请重新选择文件，或改用粘贴导入。'];
      render();
    };
    reader.onerror = readFailed;
    reader.onabort = readFailed;
    try { reader.readAsText(file); } catch (e) { readFailed(); }
  }

  async function pasteAndParse() {
    try {
      const text = await readClipboard();
      ui.importText = text;
      parseImport(text);
    } catch (e) {
      toast(e && e.message && e.message.includes('剪贴板') ? e.message : '没能读取剪贴板，请长按输入框选择「粘贴」', 'error');
    }
  }
  function parseImport(text) {
    const res = C.parsePackText(text || '', { now: Date.now() });
    if (res.errors && res.errors.length) {
      ui.importErrors = res.errors;
      render();
      return;
    }
    ui.importErrors = [];
    const dups = C.findDuplicates(state, res.items);
    ui.draft = {
      pack: res.pack,
      story: res.story || null,
      _storyDecision: 'keep',
      _storyDup: res.story ? C.findStoryDuplicate(state, res.story, res.pack.date) : null,
      warnings: res.warnings || [],
      items: res.items.map((it, i) => Object.assign({}, it, { _key: 'c' + i, _decision: dups[i] ? 'skip' : 'active', _dup: dups[i] || null }))
    };
    ui.lastRoute = '';
    render();
  }
  function loadSample() {
    const sample = C.clone(window.SL_SAMPLE_PACK);
    sample.date = C.dateKey(Date.now());
    ui.importText = JSON.stringify(sample, null, 2);
    if (route().name !== 'import') history.pushState(null, '', '#/import');
    parseImport(ui.importText);
  }

  function importPreview() {
    const d = ui.draft;
    const existing = C.packsOnDate(state, d.pack.date);
    const nextRev = existing.length ? Math.max(d.pack.revision, existing[0].revision + 1) : d.pack.revision;
    const counts = { active: 0, saved: 0, skip: 0 };
    d.items.forEach(i => { counts[i._decision]++; });
    const dateInput = h('input', {
      type: 'date', class: 'input', id: 'draft-date', fk: 'draft-date', value: d.pack.date,
      onchange: e => { if (C.isDateKey(e.target.value)) { d.pack.date = e.target.value; render(); } }
    });
    const groups = [
      ['vocab', '单词', i => i.kind === 'vocab'],
      ['expr', '表达', i => i.kind === 'expr' && i.form !== 'sentence'],
      ['sentence', '关键句', i => i.form === 'sentence'],
      ['fix', '纠错', i => i.kind === 'fix' && i.form !== 'upgrade'],
      ['upgrade', '说法升级', i => i.form === 'upgrade']
    ];
    return h('section', { class: 'page' },
      h('button', { class: 'btn btn-sm btn-ghost back', type: 'button', onclick: () => { ui.draft = null; render(); } }, icon('left', 16), '返回修改'),
      pageHead('确认导入', d.pack.title, 'AI 负责提出候选，留不留由你决定。'),
      d.warnings.length ? h('div', { class: 'alert alert-warn' },
        h('b', { text: '有几处小问题，已自动处理：' }),
        h('ul', {}, d.warnings.map(w => h('li', { text: w })))) : null,
      h('div', { class: 'card' },
        h('div', { class: 'field-row' },
          field('draft-date', '日期', dateInput),
          h('div', { class: 'field' },
            h('span', { class: 'small', style: { fontWeight: '600' }, text: '版本' }),
            h('p', { class: 'small muted', text: existing.length
              ? '这一天已有 ' + existing.length + ' 版，这次保存为第 ' + nextRev + ' 版，旧版本保留。'
              : '第 ' + nextRev + ' 版' }))),
        d.pack.summary_zh ? h('p', { text: d.pack.summary_zh }) : null,
        d.pack.topics.length ? h('div', { class: 'chips' }, d.pack.topics.map(t => h('span', { class: 'chip', text: '#' + t }))) : null,
        d.pack.scores ? scoreBars(d.pack.scores) : null),
      h('div', { class: 'row' },
        h('span', { class: 'small muted grow', text: '复习 = 进入间隔复习 · 收藏 = 只放进素材库 · 不要 = 不保存' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setAllDecisions('active') }, '全部复习'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setAllDecisions('saved') }, '全部收藏')),
      d.story ? storyCandidateCard(d) : null,
      groups.map(([k, label, test]) => {
        const list = d.items.filter(test);
        if (!list.length) return null;
        return h('div', { class: 'stack' },
          h('h2', { class: 'section-title' }, label, h('span', { class: 'count', text: String(list.length) })),
          list.map(candidateCard));
      }),
      d.pack.went_well.length ? h('div', { class: 'card' }, h('h3', { text: '说得好的句子' }), winsList(d.pack.went_well)) : null,
      d.pack.next_targets.length ? h('div', { class: 'card' },
        h('h3', { text: '下次要用上' }),
        h('div', { class: 'chips' }, d.pack.next_targets.map(t => h('span', { class: 'chip chip-accent', text: t })))) : null,
      h('div', { class: 'sticky-bar' },
        h('button', { class: 'btn btn-primary grow', type: 'button', id: 'confirm-import', onclick: confirmImport },
          icon('check', 18), '导入：' + counts.active + ' 条进复习' + (counts.saved ? '，' + counts.saved + ' 条收藏' : '')),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { if (window.confirm('放弃这次导入？')) { ui.draft = null; ui.importText = ''; go('today'); } }
        }, '放弃')));
  }
  function setAllDecisions(v) {
    ui.draft.items.forEach(i => { if (!i._dup) i._decision = v; });
    render();
  }
  function candidateCard(it) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '怎么处理这一条' },
      [['active', '复习'], ['saved', '收藏'], ['skip', '不要']].map(([v, label]) => h('button', {
        type: 'button', 'aria-pressed': String(it._decision === v), 'data-v': v, fk: it._key + '-' + v,
        onclick: () => { it._decision = v; render(); }
      }, label)));
    return h('div', { class: 'cand' + (it._decision === 'skip' ? ' dim' : '') },
      itemSummary(it),
      it._dup ? h('p', { class: 'small', style: { color: 'var(--warn)' }, text: it._dup === 'draft' ? '这份 Pack 里重复了，默认不要' : '素材库里已经有这一条，默认不要' }) : null,
      h('div', { class: 'item-actions' },
        seg,
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', type: 'button', title: '编辑', 'aria-label': '编辑这一条', onclick: () => editDraft(it._key) }, icon('edit', 18))));
  }
  async function editDraft(key) {
    const it = ui.draft && ui.draft.items.find(i => i._key === key);
    if (!it) return;
    const data = await formDialog({ title: '编辑' + C.KIND_LABEL[it.kind], fields: editorFields(it) });
    if (!data) return;
    Object.assign(it, data);
    if (it.kind === 'fix' && it.natural === it.corrected) it.natural = '';
    render();
  }
  function confirmImport() {
    const d = ui.draft;
    if (!d) return;
    const res = C.applyImport(state, d, { now: Date.now(), deviceId: device.deviceId });
    ui.draft = null;
    ui.importText = '';
    ui.importErrors = [];
    saveState();
    scheduleSync(1000);
    Store.persist();
    toast('已导入：' + res.active + ' 条进入复习' + (res.saved ? '，' + res.saved + ' 条收藏' : '') + (res.storyId ? '，故事已放进「听力」' : ''));
    go('pack/' + encodeURIComponent(res.packId));
  }

  // ---------- 日报 ----------
  function countKind(items, k) { return items.filter(i => i.kind === k).length; }

  VIEWS.packs = function () {
    const groups = C.packsByDate(state);
    const head = pageHead('Daily Packs', '日报', '每次对话一份，完整保留。',
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('import') }, icon('plus', 18), '导入'));
    if (!groups.length) {
      return h('section', { class: 'page' }, head,
        h('div', { class: 'card empty' },
          h('p', { text: '还没有日报。' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('import') }, '导入 Pack'),
            h('button', { class: 'btn', type: 'button', onclick: loadSample }, '先用示例试试'))));
    }
    const out = [head];
    let month = '';
    for (const g of groups) {
      const m = g.date.slice(0, 7);
      if (m !== month) {
        month = m;
        out.push(h('h2', { class: 'month', text: m.slice(0, 4) + ' 年 ' + Number(m.slice(5)) + ' 月' }));
      }
      const p = g.revisions[0];
      const items = C.packItems(state, p.id);
      const dt = new Date(C.tsFromDateKey(g.date));
      out.push(h('a', { class: 'card card-link', href: '#/pack/' + encodeURIComponent(p.id) },
        h('div', { class: 'pack-row' },
          h('div', { class: 'pack-date' }, h('b', { text: String(dt.getDate()) }), h('span', { text: WEEK[dt.getDay()] })),
          h('div', { class: 'grow stack', style: { gap: '4px' } },
            h('p', { class: 'pack-title', text: p.title }),
            p.summary_zh ? h('p', { class: 'small muted clamp-3', text: p.summary_zh }) : null,
            h('div', { class: 'chips' },
              h('span', { class: 'chip', text: '单词 ' + countKind(items, 'vocab') }),
              h('span', { class: 'chip', text: '表达 ' + countKind(items, 'expr') }),
              h('span', { class: 'chip', text: '纠错 ' + countKind(items, 'fix') }),
              g.revisions.length > 1 ? h('span', { class: 'chip chip-primary', text: g.revisions.length + ' 个版本' }) : null)))));
    }
    return h('section', { class: 'page' }, out);
  };

  VIEWS.pack = function (id) {
    const p = state.packs[id];
    const back = h('a', { class: 'link back', href: '#/packs' }, icon('left', 16), '日报');
    if (!p || p.deleted) {
      return h('section', { class: 'page' }, back, h('h1', { text: '找不到这份日报' }),
        h('div', { class: 'card empty' }, h('p', { text: '它可能已经被删除了。' })));
    }
    const revs = C.packsOnDate(state, p.date);
    const items = C.packItems(state, p.id);
    const groups = [
      ['vocab', '单词', i => i.kind === 'vocab'],
      ['expr', '表达', i => i.kind === 'expr' && i.form !== 'sentence'],
      ['sentence', '关键句', i => i.form === 'sentence'],
      ['fix', '纠错', i => i.kind === 'fix' && i.form !== 'upgrade'],
      ['upgrade', '说法升级', i => i.form === 'upgrade']
    ];
    const hasInfo = p.summary_zh || p.topics.length || p.scores || p.minutes;
    return h('section', { class: 'page' },
      back,
      pageHead(p.date + ' · 第 ' + p.revision + ' 版', p.title, null),
      revs.length > 1 ? h('div', { class: 'tabs', role: 'group', 'aria-label': '同一天的版本' }, revs.map(r => h('a', {
        class: 'tab', href: '#/pack/' + encodeURIComponent(r.id), 'aria-current': r.id === p.id ? 'page' : null,
        'aria-pressed': String(r.id === p.id), style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }
      }, '第 ' + r.revision + ' 版'))) : null,
      packStoryCard(p),
      hasInfo ? h('div', { class: 'card' },
        p.summary_zh ? h('p', { text: p.summary_zh }) : null,
        (p.topics.length || p.minutes) ? h('div', { class: 'chips' },
          p.minutes ? h('span', { class: 'chip chip-primary', text: '开口约 ' + p.minutes + ' 分钟' }) : null,
          p.topics.map(t => h('span', { class: 'chip', text: '#' + t }))) : null,
        p.scores ? scoreBars(p.scores) : null) : null,
      groups.map(([k, label, test]) => {
        const list = items.filter(test);
        if (!list.length) return null;
        return h('div', { class: 'card' },
          h('h2', { class: 'section-title' }, label, h('span', { class: 'count', text: String(list.length) })),
          h('div', { class: 'item-list' }, list.map(itemRow)));
      }),
      p.went_well.length ? h('div', { class: 'card' }, h('h2', { class: 'section-title', text: '说得好的句子' }), winsList(p.went_well)) : null,
      (p.next_targets.length || p.next_steps_zh.length) ? h('div', { class: 'card' },
        p.next_targets.length ? h('div', { class: 'stack' },
          h('h3', { text: '下次要用上' }),
          h('div', { class: 'chips' }, p.next_targets.map(t => h('span', { class: 'chip chip-accent', text: t })))) : null,
        p.next_steps_zh.length ? h('div', { class: 'stack' },
          h('h3', { text: '下一步建议' }),
          h('ul', { style: { margin: '0', paddingLeft: '20px' } }, p.next_steps_zh.map(s => h('li', { text: s })))) : null) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => copyText(packMarkdown(p, items), '已复制为 Markdown，可以贴进 Obsidian') }, icon('copy', 18), '复制为 Markdown'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => deletePack(p.id) }, icon('trash', 18), '删除这一版')));
  };

  function deletePack(id) {
    const p = state.packs[id];
    if (!p) return;
    if (!window.confirm('删除 ' + p.date + ' 的第 ' + p.revision + ' 版日报？已经导入的单词、表达和纠错会留在素材库里。')) return;
    p.deleted = true;
    p.updatedAt = Date.now();
    saveState();
    scheduleSync();
    toast('已删除这一版日报');
    const others = C.packsOnDate(state, p.date);
    go(others.length ? 'pack/' + encodeURIComponent(others[0].id) : 'packs');
  }

  function packMarkdown(p, items) {
    const L = ['## ' + p.date + ' ' + p.title, ''];
    if (p.summary_zh) L.push(p.summary_zh, '');
    const story = p.storyId && state.stories ? state.stories[p.storyId] : null;
    if (story && story.status !== 'removed') L.push(storyMarkdown(story), '');
    const v = items.filter(i => i.kind === 'vocab');
    const e = items.filter(i => i.kind === 'expr' && i.form !== 'sentence');
    const f = items.filter(i => i.kind === 'fix' && i.form !== 'upgrade');
    const ks = items.filter(i => i.form === 'sentence');
    const up = items.filter(i => i.form === 'upgrade');
    if (ks.length) {
      L.push('### 关键句');
      ks.forEach(i => L.push('- ' + i.term + (i.cue ? '（' + i.cue + '）' : '')));
      L.push('');
    }
    if (up.length) {
      L.push('### 说法升级');
      up.forEach(i => L.push('- ' + i.original + ' → **' + i.corrected + '**' + (i.why_zh ? '（' + i.why_zh + '）' : '')));
      L.push('');
    }
    if (v.length) {
      L.push('### 单词');
      v.forEach(i => L.push('- **' + i.term + '**' + (i.pos ? ' *' + i.pos + '*' : '') + (i.meaning_en ? '：' + i.meaning_en : '') +
        (i.meaning_zh ? '（' + i.meaning_zh + '）' : '') + (i.example ? '\n  - ' + i.example : '')));
      L.push('');
    }
    if (e.length) {
      L.push('### 表达');
      e.forEach(i => L.push('- **' + i.term + '**' + (i.meaning_en ? '：' + i.meaning_en : '') +
        (i.meaning_zh ? '（' + i.meaning_zh + '）' : '') + (i.example ? '\n  - ' + i.example : '')));
      L.push('');
    }
    if (f.length) {
      L.push('### 纠错');
      f.forEach(i => L.push('- ~~' + i.original + '~~ → ' + i.corrected + (i.natural ? '\n  - 更地道：' + i.natural : '') + (i.why_zh ? '\n  - ' + i.why_zh : '')));
      L.push('');
    }
    if (p.went_well.length) {
      L.push('### 说得好的句子');
      p.went_well.forEach(w => L.push('- ' + w.sentence + (w.why_zh ? '（' + w.why_zh + '）' : '')));
      L.push('');
    }
    if (p.next_targets.length) {
      L.push('### 下次要用上');
      p.next_targets.forEach(t => L.push('- [ ] ' + t));
    }
    return L.join('\n');
  }

  // ---------- 素材库 ----------
  VIEWS.library = function () {
    const lib = C.libraryStats(state, Date.now());
    const kinds = [['vocab', '单词', lib.byKind.vocab.all], ['expr', '表达', lib.byKind.expr.all], ['fix', '纠错', lib.byKind.fix.all], ['story', '故事', lib.stories], ['win', '亮点', lib.wins]];
    const page = h('section', { class: 'page' },
      pageHead('Library', '素材库', '导入过的全部内容。可以编辑、移出复习或删除。'),
      h('div', { class: 'tabs', role: 'group', 'aria-label': '素材类型' }, kinds.map(([k, label, n]) => h('button', {
        class: 'tab', type: 'button', 'aria-pressed': String(ui.libKind === k), fk: 'lib-' + k,
        onclick: () => { ui.libKind = k; render(); }
      }, label + ' ' + n))));
    if (ui.libKind === 'story') {
      add(page, storyList(C.activeStories(state), '还没有故事。新版 ChatGPT 指令生成的 Pack 会自带一篇故事；已经写好的复盘可以用「复制转换请求」转过来。'));
      return page;
    }
    if (ui.libKind === 'win') {
      const wins = [];
      for (const g of C.packsByDate(state)) for (const w of g.revisions[0].went_well || []) wins.push(Object.assign({ date: g.date }, w));
      add(page, h('div', { class: 'card' }, wins.length
        ? winsList(wins, true)
        : h('p', { class: 'muted', text: '还没有亮点。ChatGPT 会在 Pack 里记下你说得好的句子。' })));
      return page;
    }
    const search = h('input', {
      class: 'input', type: 'search', id: 'lib-search', fk: 'lib-search', value: ui.libQuery,
      placeholder: '搜索单词、句子或中文', 'aria-label': '搜索素材'
    });
    const filters = h('div', { class: 'tabs filters', role: 'group', 'aria-label': '按状态筛选' },
      [['all', '全部'], ['active', '复习中'], ['saved', '收藏'], ['mastered', '已掌握']].map(([f, label]) => h('button', {
        class: 'tab', type: 'button', 'aria-pressed': String(ui.libFilter === f), fk: 'libf-' + f,
        onclick: () => { ui.libFilter = f; render(); }
      }, label)));
    const countEl = h('p', { class: 'small muted', 'aria-live': 'polite' });
    const listEl = h('div', { class: 'item-list' });
    add(page, search, filters, ui.libKind === 'fix' ? fixInsights() : null, h('div', { class: 'card' }, countEl, listEl));
    const fill = () => {
      const qRaw = ui.libQuery.trim();
      const q = C.normalizeText(qRaw);
      const list = Object.values(state.items)
        .filter(it => it.kind === ui.libKind && it.status !== 'removed')
        .filter(it => ui.libFilter === 'all' || (ui.libFilter === 'mastered' ? C.isMastered(it) : it.status === ui.libFilter))
        .filter(it => {
          if (!qRaw) return true;
          const hay = [it.term, it.meaning_en, it.meaning_zh, it.example, it.context, it.original, it.corrected, it.natural, it.why_zh, it.focus].filter(Boolean).join(' ');
          return (q && C.normalizeText(hay).includes(q)) || hay.includes(qRaw);
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      countEl.textContent = '共 ' + list.length + ' 条' + (list.length > 300 ? '，显示最近 300 条' : '');
      listEl.replaceChildren(...(list.length
        ? list.slice(0, 300).map(itemRow)
        : [h('p', { class: 'muted small', text: qRaw ? '没有找到匹配的内容。' : '这里还是空的。' })]));
    };
    search.addEventListener('input', () => { ui.libQuery = search.value; fill(); });
    fill();
    return page;
  };

  function fixInsights() {
    const st = C.errorTypeStats(state);
    if (!st.total) return null;
    const top = st.list.slice(0, 3).map(t => t.label);
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { text: '高频问题' }), h('span', { class: 'chip', text: '共 ' + st.total + ' 条纠错' })),
      h('div', { class: 'bars' }, st.list.map(x => h('div', { class: 'bar-row' },
        h('span', { class: 'small', text: x.label }),
        h('div', { class: 'bar', role: 'img', 'aria-label': x.label + ' ' + x.count + ' 条' }, h('span', { style: { width: Math.round(100 * x.count / st.total) + '%' } })),
        h('span', { class: 'small muted', text: String(x.count) })))),
      h('p', { class: 'small muted', text: '最常出错的是「' + top.join('、') + '」。聊天前可以告诉 ChatGPT：今天帮我特别留意这几类。' }));
  }

  // ---------- 设置 ----------
  function setSetting(key, value) {
    state.settings[key] = value;
    state.settings.updatedAt = Date.now();
    saveState();
    scheduleSync();
  }
  function textInput(id, value, placeholder, type) {
    return h('input', {
      class: 'input', id, fk: id, type: type || 'text', value: value || '', placeholder: placeholder || '',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false'
    });
  }
  function copyInstructions() {
    copyText(P.projectInstructions(state.settings.aboutMe), '项目指令已复制，粘贴到 ChatGPT 项目的「指令」里');
  }

  VIEWS.settings = function () {
    const st = state.settings;
    const sy = device.sync;
    const voices = Speech.englishVoices();
    const best = Speech.bestVoice(device.voiceURI);
    const voiceControl = voices.length
      ? h('select', {
        class: 'input', id: 'set-voice', fk: 'set-voice', value: best ? best.voiceURI : '',
        onchange: e => { device.voiceURI = e.target.value; saveDevice(); say("Nice to meet you. Let's practise English together."); }
      }, voices.map((v, i) => {
        const q = Speech.voiceQuality(v);
        return h('option', { value: v.voiceURI, text: v.name + '（' + v.lang + '）' + (q.label ? ' · ' + q.label : '') + (i === 0 ? ' · 推荐' : '') });
      }))
      : h('p', { class: 'small muted', id: 'set-voice', text: Speech.canSpeak() ? '正在读取系统里的英文声音…' : '这个浏览器不支持朗读。' });

    const ownerIn = textInput('sync-owner', sy.owner, '你的 GitHub 用户名');
    const repoIn = textInput('sync-repo', sy.repo, '比如 speak-loop-data');
    const tokenIn = textInput('sync-token', sy.token, 'github_pat_…', 'password');
    const branchIn = textInput('sync-branch', sy.branch || 'main', 'main');
    const pathIn = textInput('sync-path', sy.path || 'speak-loop-data.json', 'speak-loop-data.json');
    const info = syncInfo();
    const fileIn = h('input', {
      type: 'file', accept: 'application/json,.json', class: 'hidden', id: 'backup-file',
      onchange: e => { const f = e.target.files && e.target.files[0]; if (f) importBackup(f); e.target.value = ''; }
    });
    const persistLine = h('p', { class: 'small muted', text: '存储状态：检查中…' });
    Store.persisted().then(ok => {
      persistLine.textContent = ok ? '存储状态：已申请长期保存，浏览器不会自动清理。' : '存储状态：浏览器可能在空间不足时清理数据，建议开启同步或定期导出备份。';
    });

    return h('section', { class: 'page' },
      pageHead('Settings', '设置', null),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '学习' }),
        field('set-name', '怎么称呼你', h('input', {
          class: 'input', id: 'set-name', fk: 'set-name', value: st.name || '', placeholder: '你的名字或昵称',
          onchange: e => { setSetting('name', e.target.value.trim()); toast('已保存'); }
        })),
        h('div', { class: 'field-row' },
          field('set-new', '每天新内容上限', h('input', {
            class: 'input', id: 'set-new', fk: 'set-new', type: 'number', min: '0', max: '100', inputmode: 'numeric', value: String(st.newPerDay),
            onchange: e => { const n = clampInt(e.target.value, 0, 100, 15); e.target.value = String(n); setSetting('newPerDay', n); toast('已保存'); }
          }), 'Pack 里的内容很多时，超出的部分明天接着学。'),
          field('set-rev', '每天复习上限', h('input', {
            class: 'input', id: 'set-rev', fk: 'set-rev', type: 'number', min: '10', max: '1000', inputmode: 'numeric', value: String(st.reviewsPerDay),
            onchange: e => { const n = clampInt(e.target.value, 10, 1000, 100); e.target.value = String(n); setSetting('reviewsPerDay', n); toast('已保存'); }
          }))),
        checkbox('set-zh', '显示中文意思', '在答案、素材库里显示中文。题面始终只给英文，练的是不经过翻译直接想到英语。', st.showZh, v => { setSetting('showZh', v); })),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '发音' }),
        field('set-voice', '英文声音', voiceControl, '列表按自然程度排序。iPhone 可以在「设置 → 辅助功能 → 朗读内容 → 声音 → 英语」免费下载「高音质」（最好）或「优化音质」的声音（比如 Ava、Zoe），下载后彻底关掉工作台再打开，回到这里选。下载了却不在列表里，说明 iOS 没有把它开放给网页使用。'),
        h('div', { class: 'field' },
          h('label', { for: 'set-rate', text: '语速：' + Number(device.rate).toFixed(2) }),
          h('div', { class: 'row' },
            h('input', {
              type: 'range', id: 'set-rate', fk: 'set-rate', class: 'grow', min: '0.6', max: '1.2', step: '0.05', value: String(device.rate),
              onchange: e => { device.rate = parseFloat(e.target.value) || 0.95; saveDevice(); render(); say('This is how fast I will speak.'); }
            }),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => say("It's not as simple as it sounds.") }, icon('speaker', 16), '试听'))),
        checkbox('set-autospeak', '揭晓答案时自动朗读', '', device.autoSpeak, v => { device.autoSpeak = v; saveDevice(); }),
        Speech.canListen() ? null : h('p', { class: 'small muted', text: '这个浏览器不支持语音识别，复习时不会出现「说出来检查」，其他功能不受影响。' })),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: 'ChatGPT 设置' }),
        h('p', { class: 'small muted', text: 'Speak Loop 是 ChatGPT 的配套工作台，不在这里嵌入 AI 或 Live 语音。先在 ChatGPT 项目里设置指令；已设置项目可用短指令，未设置也可复制独立 Pack 请求。' }),
        field('set-about', '关于我（可选，会放进项目指令）', h('textarea', {
          class: 'input', id: 'set-about', fk: 'set-about', rows: '4', value: st.aboutMe || '',
          placeholder: '可选：用英文写几句想练的场景或偏好。只写你确认愿意提供的内容。',
          onchange: e => { setSetting('aboutMe', e.target.value.trim()); toast('已保存，复制项目指令时会带上'); }
        }), '这是你提供的可选背景，不会被当作已确认的事实。只保存在你自己的数据里。'),
        chatPromptButtons(),
        h('details', {},
          h('summary', { class: 'small', style: { cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center' }, text: '预览项目指令' }),
          h('pre', { class: 'code-preview mono', text: P.projectInstructions(st.aboutMe) }))),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '同步（手机和电脑用同一份数据）' }),
        h('p', { class: 'small muted', text: '数据存在你自己的 GitHub 私有仓库里，每次同步都是一次提交，可以随时回滚。Token 只保存在这台设备上。' }),
        h('div', { class: 'sync-line' }, h('span', { class: 'dot ' + info.cls }), h('span', { text: info.text })),
        sy.lastError ? h('div', { class: 'alert alert-error', role: 'alert', text: sy.lastError }) : null,
        h('div', { class: 'field-row' },
          field('sync-owner', 'GitHub 用户名', ownerIn),
          field('sync-repo', '私有仓库名', repoIn)),
        field('sync-token', 'Fine-grained Token', tokenIn, '只授权这一个仓库，权限选 Contents：Read and write。具体步骤见说明文档。'),
        h('details', {},
          h('summary', { class: 'small', style: { cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center' }, text: '高级：分支和文件路径' }),
          h('div', { class: 'field-row' }, field('sync-branch', '分支', branchIn), field('sync-path', '文件路径', pathIn))),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: () => saveSyncConfig({
              owner: ownerIn.value.trim(), repo: repoIn.value.trim(), token: tokenIn.value.trim(),
              branch: branchIn.value.trim() || 'main', path: pathIn.value.trim() || 'speak-loop-data.json'
            })
          }, icon('sync', 18), '保存并同步'),
          Sync.isConfigured(sy) ? h('button', { class: 'btn', type: 'button', onclick: () => runSync(true) }, '立即同步') : null,
          Sync.isConfigured(sy) ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: disconnectSync }, '断开') : null)),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '备份' }),
        h('p', { class: 'small muted', text: '不开同步的话，建议每周导出一次。恢复时会和现有数据合并，不会覆盖。' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: exportBackup }, icon('download', 18), '导出备份文件'),
          h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, icon('upload', 18), '从备份恢复'),
          fileIn,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: clearAll }, '清空本机数据'))),

      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '关于' }),
        h('p', { class: 'small muted', text: '口语工作台 Speak Loop ' + APP_VERSION + ' · 数据都在你自己的设备和仓库里，不经过任何第三方服务器。' }),
        persistLine));
  };

  // GitHub tokens look like github_pat_… (fine-grained, ~90 chars) or ghp_…; catch pasted names or partial copies early.
  function tokenProblem(token) {
    const t = String(token || '').replace(/\s+/g, '');
    if (!t) return '';
    if (/^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(t)) return '';
    return '粘贴的内容不像 Token（只有 ' + t.length + ' 个字符）。Token 以 github_pat_ 开头，大约 90 个字符，只在生成后显示一次。'
      + (/^speak-loop/i.test(t) ? '你粘贴的是 Token 的名称，不是 Token 本身。' : '请回到 GitHub 生成页面，点那串长字符旁边的复制按钮再粘贴。');
  }

  async function saveSyncConfig(fields) {
    fields.token = String(fields.token || '').replace(/\s+/g, '');
    const problem = tokenProblem(fields.token);
    if (problem) {
      device.sync.lastError = problem;
      device.sync.status = 'error';
      render();
      toast(problem, 'error');
      return;
    }
    Object.assign(device.sync, fields);
    device.sync.lastError = '';
    device.sync.status = Sync.isConfigured(device.sync) ? 'ok' : 'off';
    await saveDevice();
    if (Sync.isConfigured(device.sync)) {
      toast('已保存，正在同步…');
      await runSync(true);
    } else {
      toast('已保存。用户名、仓库名和 Token 都填好后才会同步。');
    }
    render();
  }
  function disconnectSync() {
    if (!window.confirm('断开同步？会清除这台设备上的 Token。本机数据和 GitHub 上的数据都会保留。')) return;
    device.sync.token = '';
    device.sync.status = 'off';
    device.sync.lastError = '';
    saveDevice();
    render();
    updateSyncLines();
    toast('已断开同步');
  }
  function exportBackup() {
    const data = JSON.stringify({ app: 'speak-loop', version: APP_VERSION, exportedAt: new Date().toISOString(), state }, null, 1);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'speak-loop-backup-' + C.dateKey(Date.now()) + '.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('备份文件已生成');
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed && parsed.state ? parsed.state : parsed;
        if (!incoming || typeof incoming !== 'object' || !incoming.items) throw new Error('这不是口语工作台的备份文件');
        const n = Object.keys(incoming.items).length;
        if (!window.confirm('从备份恢复 ' + n + ' 条素材？会和本机现有数据合并，不会删掉现有内容。')) return;
        state = C.mergeStates(state, incoming);
        commit();
        toast('已从备份恢复');
      } catch (e) {
        toast('恢复失败：' + e.message, 'error');
      }
    };
    reader.onerror = () => toast('读取文件失败', 'error');
    reader.readAsText(file);
  }
  async function clearAll() {
    if (!window.confirm('清空这台设备上的全部学习数据？这一步不能撤销，建议先导出备份。')) return;
    if (!window.confirm('再确认一次：真的清空吗？如果开着同步，GitHub 上的数据不受影响，下次同步会重新拿回来。')) return;
    state = C.emptyState();
    ui.session = null;
    ui.draft = null;
    await saveState();
    render();
    toast('本机数据已清空');
  }

  // ---------- 使用步骤 ----------
  VIEWS.guide = function () {
    return h('section', { class: 'page' },
      h('a', { class: 'link back', href: '#/settings' }, icon('left', 16), '设置'),
      pageHead('How it works', '使用步骤', '这是 ChatGPT Live 的配套工作台：聊、生成 JSON、导入、复习。'),
      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '先选一种 ChatGPT 用法' }),
        h('p', { class: 'small', text: '推荐：把「项目设置」复制到 ChatGPT 项目指令，以后使用短的「生成今日 Pack」。没有项目也可以复制「独立 Pack」，在当前对话直接发送完整请求。聊天和 Live 都仍在 ChatGPT 内完成。' }),
        chatPromptButtons()),
      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '每天 10–15 分钟' }),
        h('ol', { class: 'steps' },
          h('li', {}, h('b', { text: '1–2 分钟：' }), '在 ChatGPT 同一个对话里发开场白，开始日常话题；水平会从你的回答逐步适应。'),
          h('li', {}, h('b', { text: '6–8 分钟：' }), '在 ChatGPT Live 或文字对话中轮流说。每次只跟一个短追问；卡住可用中文。要检查上一句时发 “', h('span', { class: 'en', text: P.CHECK_COMMAND }), '”。'),
          h('li', {}, h('b', { text: '1 分钟：' }), '结束语音后留在同一个 ChatGPT 对话，发送「', h('b', { text: P.PACK_COMMAND }), '」或独立 Pack 请求。JSON 只复制和导入，不让它朗读。'),
          h('li', {}, h('b', { text: '2–4 分钟：' }), '在这里粘贴或选择 JSON 文件，保留真正想复习的少量内容；看英文释义先说，再揭晓，并由自己评分。'))),
      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: 'Pack 不能导入或不可靠？' }),
        h('p', { class: 'small', text: '不要补凑素材。复制「修复请求」发回原来的 ChatGPT 对话；它应只保留有依据的内容。重新导入会成为同一天的新版本，旧版本保留。' }),
        h('p', { class: 'small muted', text: '文字转写可能不同于实际说话；仅看文字无法判断发音或真实开口时长。复习里的语音检查只比较识别文字与参考答案，最终评分由你决定。' })),
      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '手机和电脑一起用' }),
        h('p', { class: 'small', text: '在「设置 → 同步」里填 GitHub 私有仓库，两边就能用同一份数据。不开同步也能用，记得定期导出备份。' })));
  };

  // ---------- 故事与听力 ----------
  const player = window.SLPlayer.create({ rate: device.rate, getVoice: () => Speech.bestVoice(device.voiceURI) });
  const RATES = [[0.8, '0.8×'], [0.9, '0.9×'], [1, '1.0×']];
  const KIND_NAME = { story: '故事', diary: '日记' };

  function storyById(id) {
    const st = state.stories && state.stories[id];
    return st && st.status !== 'removed' ? st : null;
  }
  function listenRate() { return ui.listen.rate || Math.min(1, Math.max(0.8, Math.round((device.rate || 0.95) * 10) / 10)); }
  function storyWords(story, version) {
    return C.storyParagraphs(story, version).reduce((n, p) => n + p.reduce((m, s) => m + C.wordCount(s), 0), 0);
  }
  function minutesLabel(words, rate) {
    const min = words / (150 * (rate || 1));
    return min < 1 ? '不到 1 分钟' : '约 ' + Math.round(min) + ' 分钟';
  }
  function storyPiece(story, version) {
    const sentences = [];
    C.storyParagraphs(story, version).forEach(p => sentences.push(...p));
    return { id: story.id, title: story.title, sentences };
  }
  // 开始播放：ctx = { kind: 'story'|'list', ids: [...], version }
  function startPlayback(ctx, pieceIndex, sentIndex) {
    const pieces = ctx.ids.map(storyById).filter(Boolean).map(st => storyPiece(st, ctx.version));
    if (!pieces.length) { toast('没有可以播放的内容'); return; }
    if (!window.SLPlayer.canSpeak()) { toast('这个浏览器不支持朗读', 'error'); return; }
    ui.playing = ctx;
    player.load(pieces, pieceIndex || 0, sentIndex || 0);
    player.setRate(listenRate());
    player.setMode(ui.listen.mode);
    player.setLoop(ctx.kind === 'list' ? ui.listen.loop : !!ctx.loop);
    player.play();
  }
  function isPlayingCtx(kind, id) {
    const p = ui.playing;
    if (!p || p.kind !== kind) return false;
    return kind === 'list' || p.ids[0] === id;
  }

  // 播放时不整页重绘，只更新高亮和按钮文字
  function refreshPlayerUi() {
    const st = player.state();
    document.querySelectorAll('.sent.now').forEach(e => e.classList.remove('now'));
    const ctx = ui.playing;
    if (ctx && st.pieceId) {
      const el = $main.querySelector('.sent[data-story="' + CSS.escape(st.pieceId) + '"][data-ver="' + ctx.version + '"][data-si="' + st.sent + '"]');
      if (el) {
        el.classList.add('now');
        if (st.playing && ui.listen.follow && !ui.walk) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    const label = st.playing ? (st.waiting && st.mode === 'shadow' ? '跟着说…' : '暂停') : (st.stalled ? '点一下继续' : '播放');
    document.querySelectorAll('[data-np="toggle"]').forEach(b => {
      b.replaceChildren(icon(st.playing ? 'pause' : 'play', 20), document.createTextNode(label));
      b.setAttribute('aria-label', label);
    });
    const where = st.pieces ? (st.pieces > 1 ? '第 ' + (st.piece + 1) + '/' + st.pieces + ' 篇 · ' : '') + '第 ' + (st.sent + 1) + '/' + st.total + ' 句' : '';
    document.querySelectorAll('[data-np="title"]').forEach(e => { e.textContent = st.title || '还没开始'; });
    document.querySelectorAll('[data-np="where"]').forEach(e => { e.textContent = st.pieceId ? where : ''; });
    const hide = st.mode === 'blind' && !ui.revealText;
    document.querySelectorAll('[data-np="text"]').forEach(e => {
      e.textContent = !st.pieceId ? '' : hide ? '（盲听中，文字已隐藏）' : st.text;
      e.classList.toggle('muted', hide);
    });
    document.querySelectorAll('[data-np="stalled"]').forEach(e => e.classList.toggle('hidden', !st.stalled));
  }
  player.on((type, snap) => {
    if (type === 'pieceEnd' && snap.pieceId) {
      const st = state.stories[snap.pieceId];
      if (st) {
        st.listens = (st.listens || 0) + 1;
        st.updatedAt = Date.now();
        C.recordActivity(state, device.deviceId, C.dateKey(Date.now()), 'l', 1);
        saveState();
        scheduleSync(30000);
      }
    }
    if (type === 'end' && ui.walk && !player.state().loop) toast('播放完了');
    refreshPlayerUi();
  });

  function seg(name, options, value, onPick) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': name },
      options.map(([v, label]) => h('button', {
        type: 'button', 'aria-pressed': String(value === v), fk: name + '-' + v,
        onclick: () => onPick(v)
      }, label)));
  }
  // 播放条：标题 + 上一句/播放/下一句。sticky 时只留这些，选项放在 playerOptions 里
  function playerControls(opts) {
    const o = opts || {};
    return h('div', { class: 'player-bar' + (o.sticky ? ' player-sticky' : '') },
      h('div', { class: 'np-line' },
        h('div', { class: 'grow' },
          h('p', { class: 'np-title', 'data-np': 'title' }),
          h('p', { class: 'tiny muted', 'data-np': 'where' })),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: enterWalkMode }, icon('moon', 16), '散步模式')),
      o.showText ? h('p', { class: 'np-text en', 'data-np': 'text', 'aria-live': 'off' }) : null,
      h('p', { class: 'small hidden', 'data-np': 'stalled', style: { color: 'var(--warn)' }, text: '手机暂停了朗读，点「点一下继续」接着播。' }),
      h('div', { class: 'np-controls' },
        h('button', { class: 'icon-btn icon-btn-lg', type: 'button', title: '上一句', 'aria-label': '上一句', onclick: () => player.prev() }, icon('skip-back', 22)),
        h('button', { class: 'btn btn-primary np-toggle', type: 'button', 'data-np': 'toggle', onclick: o.onToggle }, icon('play', 20), '播放'),
        h('button', { class: 'icon-btn icon-btn-lg', type: 'button', title: '下一句', 'aria-label': '下一句', onclick: () => player.next() }, icon('skip-forward', 22))),
      o.sticky ? null : playerOptions(o));
  }
  function playerOptions(opts) {
    const o = opts || {};
    return h('div', { class: 'stack' },
      h('div', { class: 'np-options' },
        seg('方式', [['read', '连读'], ['blind', '盲听'], ['shadow', '跟读']], ui.listen.mode, v => {
          ui.listen.mode = v; ui.revealText = false; player.setMode(v); render();
        }),
        seg('语速', RATES, listenRate(), v => { ui.listen.rate = v; player.setRate(v); render(); }),
        o.loopToggle ? h('label', { class: 'check check-inline', for: 'loop-' + o.loopToggle },
          h('input', {
            type: 'checkbox', id: 'loop-' + o.loopToggle, fk: 'loop-' + o.loopToggle, checked: o.loopValue,
            onchange: e => o.onLoop(e.target.checked)
          }), h('span', { text: '循环' })) : null),
      h('p', { class: 'tiny muted', text: modeHint(ui.listen.mode) }));
  }
  function modeHint(mode) {
    if (mode === 'blind') return '盲听：先不看文字只听，听完再点「显示文字」对照。';
    if (mode === 'shadow') return '跟读：每句读完会停几秒，你跟着说一遍。';
    return '连读：一句接一句读下去。点任意一句，从那句开始。';
  }

  // 散步模式：保持亮屏、全黑界面、双击才响应，放在口袋里不容易误触
  let walkEl = null;
  async function enterWalkMode() {
    if (!ui.playing) { toast('先开始播放，再进入散步模式'); return; }
    ui.walk = true;
    const awake = await window.SLPlayer.keepAwake(true);
    const doubleTap = fn => {
      let last = 0;
      return e => {
        e.preventDefault();
        const t = Date.now();
        if (t - last < 450) { last = 0; fn(); } else last = t;
      };
    };
    const toggle = () => {
      const st = player.state();
      if (st.playing) player.pause();
      else if (st.pieceId) player.play();
    };
    walkEl = h('div', { class: 'walk', role: 'dialog', 'aria-modal': 'true', 'aria-label': '散步模式' },
      h('div', { class: 'walk-top' },
        h('p', { class: 'walk-title', 'data-np': 'title' }),
        h('p', { class: 'walk-where', 'data-np': 'where' })),
      h('button', { class: 'walk-main', type: 'button', 'aria-label': '双击暂停或继续', ondblclick: e => e.preventDefault(), onclick: doubleTap(toggle) },
        h('span', { class: 'walk-state', 'data-np': 'toggle' }),
        h('span', { class: 'walk-hint', text: '双击：暂停 / 继续' })),
      h('p', { class: 'walk-text en', 'data-np': 'text' }),
      h('p', { class: 'walk-note hidden', 'data-np': 'stalled', text: '手机暂停了朗读，双击上面的按钮接着播。' }),
      awake ? null : h('p', { class: 'walk-note', text: '这台设备没能保持亮屏。可以先到「设置 → 显示与亮度 → 自动锁定」改成「永不」，散步回来再改回去。' }),
      h('div', { class: 'walk-bottom' },
        h('button', { class: 'walk-btn', type: 'button', onclick: doubleTap(() => player.nextPiece()) }, '双击：下一篇'),
        h('button', { class: 'walk-btn', type: 'button', onclick: doubleTap(exitWalkMode) }, '双击：退出')));
    walkEl.addEventListener('keydown', e => { if (e.key === 'Escape') exitWalkMode(); });
    document.body.appendChild(walkEl);
    document.body.classList.add('walking');
    refreshPlayerUi();
    walkEl.querySelector('.walk-main').focus();
  }
  function exitWalkMode() {
    ui.walk = false;
    window.SLPlayer.keepAwake(false);
    if (walkEl) { walkEl.remove(); walkEl = null; }
    document.body.classList.remove('walking');
    render();
  }

  // 正文：段落 → 可点的句子，当天的表达高亮
  function appendHighlighted(el, text, terms) {
    let pos = 0;
    for (const [a, b] of C.highlightRanges(text, terms)) {
      if (a > pos) el.appendChild(document.createTextNode(text.slice(pos, a)));
      el.appendChild(h('mark', { class: 'kw', text: text.slice(a, b) }));
      pos = b;
    }
    if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
  }
  function storyTextBlock(story, version, onTap, blind) {
    const terms = C.storyTerms(state, story);
    const wrap = h('div', { class: 'story-text en' + (blind ? ' is-blind' : '') });
    let si = 0;
    for (const sents of C.storyParagraphs(story, version)) {
      const p = h('p', { class: 'story-para' });
      for (const sent of sents) {
        const idx = si++;
        const span = h('span', {
          class: 'sent', tabindex: '0', title: '从这句开始播放',
          'data-story': story.id, 'data-ver': version, 'data-si': String(idx),
          onclick: () => onTap(idx),
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(idx); } }
        });
        appendHighlighted(span, sent, terms);
        p.appendChild(span);
        p.appendChild(document.createTextNode(' '));
      }
      wrap.appendChild(p);
    }
    return wrap;
  }
  function storyMarkdown(story) {
    const L = ['### ' + (KIND_NAME[story.kind] || '故事') + '：' + story.title, ''];
    story.full.forEach(p => L.push(p, ''));
    if (story.short.length) { L.push('#### 1 分钟版', ''); story.short.forEach(p => L.push(p, '')); }
    if (story.outline.length) { L.push('#### 提纲'); story.outline.forEach((o, i) => L.push((i + 1) + '. ' + o)); }
    return L.join('\n').trim();
  }
  function storyRow(st, now) {
    const due = C.storyDueLabel(st, now);
    return h('a', { class: 'story-row', href: '#/story/' + encodeURIComponent(st.id) },
      h('div', { class: 'grow' },
        h('p', { class: 'pack-title', text: st.title }),
        h('p', { class: 'tiny muted', text: [st.date, KIND_NAME[st.kind], storyWords(st, 'full') + ' 词', st.listens ? '听过 ' + st.listens + ' 遍' : ''].filter(Boolean).join(' · ') })),
      h('span', { class: due === '今天讲' ? 'chip chip-warn' : 'chip', text: due }));
  }
  function storyList(stories, emptyText) {
    const now = Date.now();
    return h('div', { class: 'card' }, stories.length
      ? h('div', { class: 'item-list' }, stories.map(st => storyRow(st, now)))
      : h('p', { class: 'muted small', text: emptyText }));
  }

  function storiesTodayCard(now, onListenPage) {
    const all = C.activeStories(state);
    if (!all.length) return null;
    const due = C.storiesDue(state, now);
    if (onListenPage && !due.length) return null;
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { text: due.length ? '今天要讲的故事' : '散步时听' }),
        due.length ? h('span', { class: 'chip chip-warn', text: due.length + ' 个' }) : null),
      due.length
        ? h('div', { class: 'item-list' }, due.slice(0, 3).map(st => h('div', { class: 'story-row' },
          h('div', { class: 'grow' },
            h('p', { class: 'pack-title', text: st.title }),
            h('p', { class: 'tiny muted', text: '第 ' + (st.retell.reps + 1) + ' 次讲 · ' + (C.retellVersion(st) === 'short' ? '1 分钟版' : '完整版') })),
          h('a', { class: 'btn btn-sm btn-primary', href: '#/retell/' + encodeURIComponent(st.id) }, '开始讲'))))
        : h('p', { class: 'small muted', text: '你有 ' + all.length + ' 篇故事和日记，可以连续循环播放。' }),
      onListenPage ? null : h('a', { class: 'link', href: '#/listen' }, icon('headphones', 16), '去听力页连续播放', icon('right', 16)));
  }

  function packStoryCard(p) {
    const st = p.storyId ? storyById(p.storyId) : null;
    if (!st) return null;
    const preview = (st.short.length ? st.short : st.full)[0] || '';
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { text: '这天的' + KIND_NAME[st.kind] }), h('span', { class: 'chip chip-primary', text: storyWords(st, 'full') + ' 词' })),
      h('p', { class: 'pack-title', text: st.title }),
      h('p', { class: 'en clamp-3', text: preview }),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: '#/story/' + encodeURIComponent(st.id) }, icon('headphones', 18), '听和练'),
        h('a', { class: 'btn', href: '#/retell/' + encodeURIComponent(st.id) }, '讲一遍')));
  }

  function storyCandidateCard(d) {
    const st = d.story;
    const keep = d._storyDecision !== 'skip';
    return h('div', { class: 'stack' },
      h('h2', { class: 'section-title' }, KIND_NAME[st.kind], h('span', { class: 'count', text: storyWords(st, 'full') + ' 词' })),
      h('div', { class: 'cand story-cand' + (keep ? '' : ' dim') },
        h('p', { class: 'pack-title', text: st.title }),
        st.topics.length ? h('div', { class: 'chips' }, st.topics.map(t => h('span', { class: 'chip', text: '#' + t }))) : null,
        h('details', { open: true },
          h('summary', { class: 'small', text: '完整版（' + storyWords(st, 'full') + ' 词）' }),
          h('div', { class: 'story-text en' }, st.full.map(p => h('p', { class: 'story-para', text: p })))),
        st.short.length ? h('details', {},
          h('summary', { class: 'small', text: '1 分钟版（' + storyWords(st, 'short') + ' 词）' }),
          h('div', { class: 'story-text en' }, st.short.map(p => h('p', { class: 'story-para', text: p })))) : null,
        st.outline.length ? h('details', {},
          h('summary', { class: 'small', text: '提纲（' + st.outline.length + ' 条）' }),
          h('ol', { class: 'steps small' }, st.outline.map(o => h('li', { class: 'en', text: o })))) : null,
        h('p', { class: 'small muted', text: '导入前快速看一遍：删掉你没说过的细节，改掉不准确的说法。' }),
        d._storyDup ? h('p', { class: 'small', style: { color: 'var(--warn)' }, text: '这一天已有同名的' + KIND_NAME[st.kind] + '，导入后会替换旧的，复述进度保留。' }) : null,
        h('div', { class: 'item-actions' },
          seg('怎么处理这篇', [['keep', '保存'], ['skip', '不要']], keep ? 'keep' : 'skip', v => { d._storyDecision = v; render(); }),
          h('span', { class: 'spacer' }),
          h('button', { class: 'icon-btn', type: 'button', title: '编辑', 'aria-label': '编辑这篇', onclick: () => editStory(st, true) }, icon('edit', 18)))));
  }

  async function editStory(st, isDraft) {
    const data = await formDialog({
      title: '编辑' + KIND_NAME[st.kind],
      okText: '保存',
      fields: [
        { key: 'title', label: '标题', required: true, value: st.title },
        { key: 'kind', label: '类型', type: 'select', value: st.kind, options: [['story', '故事（一件事、一个案子）'], ['diary', '日记（当天聊的内容）']] },
        { key: 'topics', label: '话题（用逗号隔开）', value: st.topics.join(', ') },
        { key: 'full', label: '完整版（段落之间空一行）', type: 'textarea', rows: 12, required: true, value: st.full.join('\n\n') },
        { key: 'short', label: '1 分钟版', type: 'textarea', rows: 5, value: st.short.join('\n\n') },
        { key: 'outline', label: '提纲（一行一条）', type: 'textarea', rows: 6, value: st.outline.join('\n') }
      ]
    });
    if (!data) return;
    const paras = s => s.split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const target = isDraft ? st : state.stories[st.id];
    if (!target) return;
    Object.assign(target, {
      title: data.title,
      kind: data.kind === 'diary' ? 'diary' : 'story',
      topics: data.topics.split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 8),
      full: paras(data.full),
      short: paras(data.short),
      outline: data.outline.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 10)
    });
    if (!target.full.length) { toast('完整版不能为空', 'error'); return; }
    if (isDraft) { render(); return; }
    target.updatedAt = Date.now();
    commit();
    toast('已保存');
  }
  function deleteStory(id) {
    const st = state.stories[id];
    if (!st || !window.confirm('删除「' + st.title + '」？关键句和表达会留在素材库里。')) return;
    if (ui.playing && ui.playing.ids.includes(id)) { player.pause(); ui.playing = null; }
    st.status = 'removed';
    st.updatedAt = Date.now();
    saveState();
    scheduleSync();
    toast('已删除');
    go('listen');
  }

  VIEWS.listen = function () {
    const now = Date.now();
    const all = C.activeStories(state);
    const head = pageHead('Listen', '听力', '散步时循环播放你的故事和日记。');
    if (!all.length) {
      return h('section', { class: 'page' }, head,
        h('div', { class: 'card empty' },
          h('p', { text: '还没有故事或日记。' }),
          h('p', { class: 'small', text: '用新版 ChatGPT 指令生成的 Pack 会自带一篇第一人称的故事。ChatGPT 已经写好的复盘，可以在导入页点「复制转换请求」，发到那个对话里转成 Pack。' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('import') }, icon('plus', 18), '导入 Pack'),
            h('button', { class: 'btn', type: 'button', onclick: loadSample }, '先用示例试试'))));
    }
    const topics = [...new Set(all.flatMap(s => s.topics))].slice(0, 8);
    const f = ui.listen.filter;
    const inFilter = s => f === 'all' || (f === 'story' || f === 'diary' ? s.kind === f : s.topics.includes(f));
    const shown = all.filter(inFilter);
    const chosen = shown.filter(s => !ui.listen.exclude[s.id]);
    const words = chosen.reduce((n, s) => n + storyWords(s, ui.listen.version), 0);
    const listCtx = isPlayingCtx('list');
    const due = C.storiesDue(state, now);
    return h('section', { class: 'page' }, head,
      due.length ? storiesTodayCard(now, true) : null,
      h('div', { class: 'card' },
        h('h2', { class: 'section-title', text: '连续播放' }),
        h('div', { class: 'tabs filters', role: 'group', 'aria-label': '按类型或话题筛选' },
          [['all', '全部'], ['story', '故事'], ['diary', '日记']].concat(topics.map(t => [t, '#' + t])).map(([v, label]) => h('button', {
            class: 'tab', type: 'button', 'aria-pressed': String(f === v), fk: 'lf-' + v,
            onclick: () => { ui.listen.filter = v; render(); }
          }, label))),
        h('div', { class: 'item-list' }, shown.map(st => h('label', { class: 'check story-check', for: 'pick-' + st.id },
          h('input', {
            type: 'checkbox', id: 'pick-' + st.id, fk: 'pick-' + st.id, checked: !ui.listen.exclude[st.id],
            onchange: e => { if (e.target.checked) delete ui.listen.exclude[st.id]; else ui.listen.exclude[st.id] = true; render(); }
          }),
          h('span', { class: 'grow' },
            h('span', { class: 'pack-title', style: { display: 'block' }, text: st.title }),
            h('span', { class: 'tiny muted', text: [st.date, KIND_NAME[st.kind], minutesLabel(storyWords(st, ui.listen.version), listenRate())].join(' · ') }))))),
        h('div', { class: 'np-options' },
          seg('版本', [['full', '完整版'], ['short', '1 分钟版']], ui.listen.version, v => { ui.listen.version = v; render(); }),
          h('label', { class: 'check check-inline', for: 'list-loop' },
            h('input', { type: 'checkbox', id: 'list-loop', fk: 'list-loop', checked: ui.listen.loop, onchange: e => { ui.listen.loop = e.target.checked; if (listCtx) player.setLoop(ui.listen.loop); } }),
            h('span', { text: '循环播放' }))),
        h('button', {
          class: 'btn btn-primary btn-block btn-lg', type: 'button', id: 'play-list', disabled: !chosen.length,
          onclick: () => startPlayback({ kind: 'list', ids: chosen.map(s => s.id), version: ui.listen.version }, 0, 0)
        }, icon('play', 20), chosen.length ? '开始连续播放（' + chosen.length + ' 篇，' + minutesLabel(words, listenRate()) + '）' : '先勾选要听的内容')),
      ui.playing ? h('div', { class: 'card' },
        playerControls({
          showText: true, loopToggle: 'np', loopValue: player.state().loop,
          onLoop: v => { player.setLoop(v); if (ui.playing.kind === 'list') ui.listen.loop = v; },
          onToggle: () => player.toggle()
        }),
        ui.listen.mode === 'blind' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { ui.revealText = !ui.revealText; refreshPlayerUi(); } }, '显示 / 隐藏文字') : null) : null,
      h('div', { class: 'alert alert-info' },
        h('p', {}, h('b', { text: '散步时：' }), '开始播放后点「散步模式」，屏幕会保持亮着、变成全黑，双击才响应，放进口袋不容易误触。'),
        h('p', { text: 'iPhone 锁屏或切到别的 App 时，网页朗读会暂停；回到这个页面会从当前这句接着读。' })),
      h('h2', { class: 'section-title', text: '全部故事和日记' }),
      storyList(all, ''));
  };

  VIEWS.story = function (id) {
    const st = storyById(id);
    const back = h('a', { class: 'link back', href: '#/listen' }, icon('left', 16), '听力');
    if (!st) {
      return h('section', { class: 'page' }, back, h('h1', { text: '找不到这篇' }),
        h('div', { class: 'card empty' }, h('p', { text: '它可能已经被删除了。' })));
    }
    const now = Date.now();
    const tab = ui.storyTab === 'short' && !st.short.length ? 'full' : ui.storyTab;
    const version = tab === 'short' ? 'short' : 'full';
    const playingHere = isPlayingCtx('story', st.id) && ui.playing.version === version;
    const blind = ui.listen.mode === 'blind' && !ui.revealText;
    const tapSentence = idx => {
      if (playingHere) player.playFrom(0, idx);
      else startPlayback({ kind: 'story', ids: [st.id], version, loop: ui.storyLoop }, 0, idx);
    };
    const toggle = () => {
      if (isPlayingCtx('story', st.id) && ui.playing.version === version && player.state().pieceId) player.toggle();
      else startPlayback({ kind: 'story', ids: [st.id], version, loop: ui.storyLoop }, 0, 0);
    };
    const pack = st.packId ? state.packs[st.packId] : null;
    const items = st.packId ? C.packItems(state, st.packId) : [];
    return h('section', { class: 'page' },
      back,
      pageHead(KIND_NAME[st.kind] + ' · ' + st.date, st.title, null),
      h('div', { class: 'chips' },
        h('span', { class: C.storyDueLabel(st, now) === '今天讲' ? 'chip chip-warn' : 'chip chip-primary', text: '复述：' + C.storyDueLabel(st, now) }),
        st.listens ? h('span', { class: 'chip', text: '听过 ' + st.listens + ' 遍' }) : null,
        st.topics.map(t => h('span', { class: 'chip', text: '#' + t }))),
      h('div', { class: 'tabs', role: 'group', 'aria-label': '版本' },
        [['full', '完整版'], ['short', '1 分钟版'], ['outline', '提纲']]
          .filter(([v]) => (v !== 'short' || st.short.length) && (v !== 'outline' || st.outline.length))
          .map(([v, label]) => h('button', {
            class: 'tab', type: 'button', 'aria-pressed': String(tab === v), fk: 'stab-' + v,
            onclick: () => { ui.storyTab = v; render(); }
          }, label))),
      tab === 'outline'
        ? h('div', { class: 'card' }, h('ol', { class: 'steps' }, st.outline.map(o => h('li', { class: 'en', text: o }))))
        : h('div', { class: 'card' },
          playerOptions({
            loopToggle: 'story', loopValue: !!ui.storyLoop,
            onLoop: v => { ui.storyLoop = v; if (isPlayingCtx('story', st.id)) player.setLoop(v); }
          }),
          storyTextBlock(st, version, tapSentence, blind),
          blind ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { ui.revealText = true; render(); } }, icon('eye', 16), '显示文字') : null,
          h('p', { class: 'tiny muted', text: '点任意一句，从那句开始读。浅橙色标记是这天学的表达。' })),
      tab !== 'outline' ? playerControls({ sticky: true, onToggle: toggle }) : null,
      h('div', { class: 'card' },
        h('h3', { text: '练到能讲出来' }),
        h('div', { class: 'row' },
          h('a', { class: 'btn btn-primary', href: '#/retell/' + encodeURIComponent(st.id) }, '讲一遍'),
          h('button', {
            class: 'btn', type: 'button',
            onclick: () => {
              ui.retellAudience = (ui.retellAudience || 0) + 1;
              copyText(P.retellTask(st, C.storyTerms(state, st), ui.retellAudience - 1), '已复制：发给 ChatGPT，开 Live 讲给它听');
            }
          }, icon('chat', 18), '讲给 ChatGPT 听')),
        h('p', { class: 'small muted', text: '「讲给 ChatGPT 听」每次换一个听众：外国朋友、同行、刚认识的人，练习根据对象调整详略。' })),
      items.length ? h('details', { class: 'card' },
        h('summary', { class: 'small', style: { cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center' }, text: '这天的关键句和表达（' + items.length + '）' }),
        h('div', { class: 'item-list' }, items.map(itemRow))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => copyText(storyMarkdown(st), '已复制为 Markdown，可以贴进 Obsidian 当英文日记') }, icon('copy', 18), '复制为 Markdown'),
        h('button', { class: 'btn', type: 'button', onclick: () => editStory(st, false) }, icon('edit', 18), '编辑'),
        pack && !pack.deleted ? h('a', { class: 'btn btn-ghost', href: '#/pack/' + encodeURIComponent(pack.id) }, '这天的日报') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => deleteStory(st.id) }, icon('trash', 18), '删除')));
  };

  let retellTimer = null;
  VIEWS.retell = function (id) {
    const st = storyById(id);
    const back = h('a', { class: 'link back', href: '#/story/' + encodeURIComponent(id) }, icon('left', 16), '返回');
    if (!st) return h('section', { class: 'page' }, back, h('h1', { text: '找不到这篇' }));
    const version = C.retellVersion(st);
    const level = C.retellCueLevel(st.retell.step);
    const terms = C.storyTerms(state, st);
    if (!ui.retell || ui.retell.id !== id) ui.retell = { id, used: {}, start: 0 };
    const r = ui.retell;
    const clock = h('span', { class: 'timer', id: 'retell-clock', text: '0:00' });
    clearInterval(retellTimer);
    const tick = () => {
      const el = document.getElementById('retell-clock');
      if (!el || !r.start) return;
      const sec = Math.floor((Date.now() - r.start) / 1000);
      el.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    };
    if (r.start) retellTimer = setInterval(tick, 500);
    const finish = smooth => {
      clearInterval(retellTimer);
      const used = Object.keys(r.used).length;
      C.applyRetell(state, id, smooth, { now: Date.now(), deviceId: device.deviceId });
      ui.retell = null;
      commit();
      const next = C.storyDueLabel(state.stories[id], Date.now());
      toast((smooth ? '讲得顺，' : '没关系，') + '下次：' + next + (terms.length ? '（这次用上 ' + used + '/' + terms.length + ' 个表达）' : ''));
      go('story/' + encodeURIComponent(id));
    };
    const target = version === 'short' ? '1 分钟版' : '完整版';
    return h('section', { class: 'page' },
      back,
      pageHead('复述 · 第 ' + (st.retell.reps + 1) + ' 次', st.title, '不看原文，用自己的话把' + target + '讲出来。'),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', { text: level === 'title' ? '只看标题讲' : '看提纲讲' }),
          h('span', { class: 'chip', text: level === 'title' ? '提示：只有标题' : level === 'outline' ? '提示：提纲' : '提示：提纲 + 表达' })),
        level === 'title' || !st.outline.length
          ? h('p', { class: 'prompt en', text: st.title })
          : h('ol', { class: 'steps' }, st.outline.map(o => h('li', { class: 'en', text: o }))),
        level === 'outline+terms' && terms.length ? h('div', { class: 'stack' },
          h('p', { class: 'small muted', text: '试着用上：' }),
          h('div', { class: 'chips' }, terms.map(t => h('span', { class: 'chip chip-accent en', text: t })))) : null),
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('button', {
            class: 'btn btn-primary', type: 'button', id: 'retell-start',
            onclick: () => { r.start = r.start ? 0 : Date.now(); render(); }
          }, r.start ? '停止计时' : '开始讲，计时'),
          clock,
          h('span', { class: 'grow' }),
          h('button', {
            class: 'btn btn-ghost', type: 'button',
            onclick: () => startPlayback({ kind: 'story', ids: [st.id], version, loop: false }, 0, 0)
          }, icon('headphones', 18), '先听一遍' + target)),
        h('p', { class: 'tiny muted', text: version === 'short' ? '1 分钟版大约讲 40–60 秒。' : '完整版不用逐字一样，把每个节点讲到就行。' })),
      terms.length ? h('div', { class: 'card' },
        h('h3', { text: '讲完勾一下：这次用上了哪些？' }),
        h('div', { class: 'item-list' }, terms.map((t, i) => h('label', { class: 'check', for: 'used-' + i },
          h('input', { type: 'checkbox', id: 'used-' + i, fk: 'used-' + i, checked: !!r.used[i], onchange: e => { if (e.target.checked) r.used[i] = true; else delete r.used[i]; } }),
          h('span', { class: 'en', text: t }))))) : null,
      h('details', { class: 'card' },
        h('summary', { class: 'small', style: { cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center' }, text: '讲完再看：' + target + '原文' }),
        h('div', { class: 'story-text en' }, (version === 'short' ? st.short : st.full).map(p => h('p', { class: 'story-para', text: p })))),
      h('div', { class: 'sticky-bar' },
        h('button', { class: 'btn btn-primary grow', type: 'button', id: 'retell-smooth', onclick: () => finish(true) }, icon('check', 18), '讲得顺'),
        h('button', { class: 'btn grow', type: 'button', id: 'retell-stuck', onclick: () => finish(false) }, '卡住了')));
  };

  document.addEventListener('keydown', e => {
    const name = route().name;
    if (name !== 'story' && name !== 'listen') return;
    const t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.classList.contains('sent'))) return;
    if (document.getElementById('dialog').open || !ui.playing) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') player.next();
    else if (e.key === 'ArrowLeft') player.prev();
  });

  // ---------- 启动 ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker 注册失败', err));
  }

  async function init() {
    try {
      const saved = await Store.get('state');
      if (saved) state = C.migrateState(saved);
    } catch (e) {
      console.error(e);
      toast('读取本机数据失败：' + e.message, 'error');
    }
    try {
      const d = await Store.get('device');
      if (d && typeof d === 'object') {
        const syncCfg = Object.assign({}, device.sync, d.sync || {});
        Object.assign(device, d);
        device.sync = syncCfg;
      }
    } catch (e) { console.error(e); }
    if (!device.deviceId) { device.deviceId = C.uid('dev'); saveDevice(); }
    device.sync.status = Sync.isConfigured(device.sync) ? (device.sync.lastError ? 'error' : 'ok') : 'off';
    renderNav();
    Speech.init(() => { if (route().name === 'settings' && !isTyping()) render(); });
    render();
    if (Sync.isConfigured(device.sync)) runSync(false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Sync.isConfigured(device.sync) && Date.now() - (device.sync.lastSyncAt || 0) > 60000) runSync(false);
      if (route().name === 'today' && !isTyping()) render();
    });
    registerSW();
    window.__speakLoop = { getState: () => state, version: APP_VERSION };
  }

  init();
})();
