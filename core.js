/*
 * Speak Loop · core.js
 * 纯逻辑：Pack 解析、复习调度、统计、同步合并。不依赖 DOM。
 * 浏览器里挂在 window.SLCore；Node 里可以 require（用于测试）。
 */
(function (root) {
  'use strict';

  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const SCHEMA = 'speak-loop/pack@1';
  const KINDS = ['vocab', 'expr', 'fix'];
  const KIND_LABEL = { vocab: '单词', expr: '表达', fix: '纠错', win: '亮点' };
  const FIX_TYPES = {
    tense: '时态',
    article: '冠词',
    preposition: '介词',
    collocation: '搭配',
    word_choice: '用词',
    structure: '句子结构',
    agreement: '单复数/主谓一致',
    chinglish: '中式表达',
    pronunciation: '发音',
    other: '其他'
  };
  const TYPE_ALIASES = {
    tense: 'tense', tenses: 'tense', verb_tense: 'tense', verb_form: 'tense', '时态': 'tense',
    article: 'article', articles: 'article', '冠词': 'article',
    preposition: 'preposition', prepositions: 'preposition', '介词': 'preposition',
    collocation: 'collocation', collocations: 'collocation', '搭配': 'collocation',
    word_choice: 'word_choice', wording: 'word_choice', vocabulary: 'word_choice', word: 'word_choice',
    diction: 'word_choice', '用词': 'word_choice',
    structure: 'structure', sentence_structure: 'structure', grammar: 'structure', word_order: 'structure',
    syntax: 'structure', '句子结构': 'structure', '语法': 'structure',
    agreement: 'agreement', subject_verb_agreement: 'agreement', plural: 'agreement',
    singular_plural: 'agreement', number: 'agreement', '单复数': 'agreement', '主谓一致': 'agreement',
    '单复数/主谓一致': 'agreement',
    chinglish: 'chinglish', l1_transfer: 'chinglish', literal_translation: 'chinglish',
    '中式表达': 'chinglish', '中式英语': 'chinglish',
    pronunciation: 'pronunciation', '发音': 'pronunciation',
    other: 'other', '其他': 'other'
  };
  const MASTERED_DAYS = 21;
  const MAX_INTERVAL = 180;

  // ---------- 基础工具 ----------
  function uid(prefix) {
    const c = root.crypto;
    const rand = c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rand;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function dateKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isDateKey(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function endOfDay(ts) { const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function addDaysTs(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
  function tsFromDateKey(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  function formatDateCN(ts) {
    const d = new Date(ts);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
  }

  function clean(v, max) {
    if (v == null) return '';
    if (Array.isArray(v)) v = v.find(x => typeof x === 'string' && x.trim()) || '';
    if (typeof v !== 'string') v = String(v);
    return v.replace(/\s+/g, ' ').trim().slice(0, max || 600);
  }
  function pick(obj, keys) {
    if (!isObj(obj)) return undefined;
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== '') return obj[k];
    }
    return undefined;
  }
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (isObj(v)) return Object.values(v);
    if (typeof v === 'string' && v.trim()) return [v];
    return [];
  }
  function toStrList(v, maxItems, maxLen, mapFn) {
    return asArray(v)
      .map(x => clean(mapFn ? mapFn(x) : x, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);
  }
  function toNum(v, min, max) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  // 用于去重：小写、统一引号、去标点
  function normalizeText(s) {
    return clean(s, 2000)
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[^a-z0-9'\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // 用于口语匹配：再展开常见缩写
  function matchNormalize(s) {
    return normalizeText(s)
      .replace(/\bwon't\b/g, 'will not')
      .replace(/\bcan't\b/g, 'can not')
      .replace(/\bcannot\b/g, 'can not')
      .replace(/n't\b/g, ' not')
      .replace(/'re\b/g, ' are')
      .replace(/'ve\b/g, ' have')
      .replace(/'ll\b/g, ' will')
      .replace(/'m\b/g, ' am')
      .replace(/'d\b/g, ' would')
      .replace(/\blet's\b/g, 'let us')
      .replace(/\b(it|that|what|there|here|he|she|who|where|how)'s\b/g, '$1 is')
      .replace(/'s\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- 状态 ----------
  function defaultSettings() {
    return { name: '', newPerDay: 15, reviewsPerDay: 100, showZh: true, aboutMe: '', updatedAt: 0 };
  }
  function emptyState() {
    return { version: 1, items: {}, packs: {}, activity: {}, settings: defaultSettings() };
  }
  function newSrs() {
    return { state: 'new', due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: 0, first: 0 };
  }
  function migrateState(input) {
    const out = emptyState();
    if (!isObj(input)) return out;
    const s = clone(input);
    out.items = isObj(s.items) ? s.items : {};
    out.packs = isObj(s.packs) ? s.packs : {};
    out.activity = isObj(s.activity) ? s.activity : {};
    out.settings = Object.assign(defaultSettings(), isObj(s.settings) ? s.settings : {});
    for (const id of Object.keys(out.items)) {
      const it = out.items[id];
      if (!isObj(it) || !(KINDS.includes(it.kind))) { delete out.items[id]; continue; }
      it.id = it.id || id;
      it.srs = Object.assign(newSrs(), isObj(it.srs) ? it.srs : {});
      if (!['active', 'saved', 'removed'].includes(it.status)) it.status = 'active';
      if (!it.createdAt) it.createdAt = 0;
      if (!it.updatedAt) it.updatedAt = it.createdAt || 0;
    }
    for (const id of Object.keys(out.packs)) {
      const p = out.packs[id];
      if (!isObj(p)) { delete out.packs[id]; continue; }
      p.id = p.id || id;
      p.itemIds = Array.isArray(p.itemIds) ? p.itemIds : [];
      p.topics = Array.isArray(p.topics) ? p.topics : [];
      p.went_well = Array.isArray(p.went_well) ? p.went_well : [];
      p.next_targets = Array.isArray(p.next_targets) ? p.next_targets : [];
      p.next_steps_zh = Array.isArray(p.next_steps_zh) ? p.next_steps_zh : [];
      p.revision = p.revision >= 1 ? p.revision : 1;
      if (!p.updatedAt) p.updatedAt = p.importedAt || 0;
    }
    return out;
  }

  // ---------- Pack 解析 ----------
  // Tolerate trailing commas without touching text inside a JSON string.
  function removeTrailingCommas(s) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; out += ch; continue; }
      if (ch === ',') {
        let next = i + 1;
        while (next < s.length && /\s/.test(s[next])) next++;
        if (s[next] === '}' || s[next] === ']') continue;
      }
      out += ch;
    }
    return out;
  }

  // Index of the brace that closes the object opened at `start`, ignoring braces inside strings; -1 if unbalanced.
  function matchingBrace(s, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i;
    }
    return -1;
  }

  function extractJson(text) {
    if (typeof text !== 'string') return { error: '没有内容' };
    let s = text.replace(/^\uFEFF/, '').trim();
    if (!s) return { error: '还没有内容。先把 ChatGPT 生成的 Pack 粘贴进来。' };
    const fence = s.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
    if (fence && fence[1].includes('{')) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return { error: '没找到 JSON。Pack 应该是以 { 开头、以 } 结尾的一段内容。' };
    }
    // Prefer the first complete object (text after it may contain other braces);
    // fall back to first-{ … last-} for JSON whose quotes were mangled.
    const close = matchingBrace(s, start);
    const candidates = close > start ? [s.slice(start, close + 1)] : [];
    if (close !== end) candidates.push(s.slice(start, end + 1));
    let lastErr = null;
    for (const c of candidates) {
      for (const a of [c, removeTrailingCommas(c), removeTrailingCommas(c.replace(/[“”]/g, '"'))]) {
        try { return { value: JSON.parse(a) }; } catch (e) { lastErr = e; }
      }
    }
    return {
      error: 'JSON 格式有误（' + (lastErr && lastErr.message) + '）。可以对 ChatGPT 说「只输出一个 JSON 代码块，重新生成」。'
    };
  }

  function normalizeType(t) {
    const raw = clean(t, 60);
    const k = raw.toLowerCase().replace(/[\s\-/]+/g, '_');
    return TYPE_ALIASES[k] || TYPE_ALIASES[raw] || 'other';
  }

  function normPhrase(v, kind) {
    if (typeof v === 'string') v = { term: v };
    if (!isObj(v)) return { error: '格式不对' };
    const term = clean(pick(v, ['term', 'word', 'expression', 'phrase', 'chunk', 'text']), 140);
    if (!term) return { error: '缺少 term（单词或表达本身）' };
    const item = {
      kind,
      term,
      pos: kind === 'vocab' ? clean(pick(v, ['pos', 'part_of_speech', 'partOfSpeech']), 30) : '',
      meaning_en: clean(pick(v, ['meaning_en', 'definition', 'definition_en', 'meaning', 'en', 'english']), 300),
      meaning_zh: clean(pick(v, ['meaning_zh', 'zh', 'chinese', 'translation', 'cn']), 120),
      usage: clean(pick(v, ['usage', 'register', 'when_to_use', 'scene', 'context_of_use']), 160),
      example: clean(pick(v, ['example', 'example_sentence', 'examples', 'sentence']), 300),
      context: clean(pick(v, ['context', 'from_chat', 'source', 'you_said', 'situation']), 300)
    };
    return { item };
  }

  function normFix(v) {
    if (!isObj(v)) return { error: '格式不对' };
    const original = clean(pick(v, ['original', 'you_said', 'yourSentence', 'wrong', 'before', 'mistake', 'sentence']), 400);
    const corrected = clean(pick(v, ['corrected', 'correct', 'correction', 'fixed', 'after']), 400);
    const natural = clean(pick(v, ['natural', 'native', 'upgrade', 'more_natural', 'natural_version', 'better', 'better_version']), 400);
    if (!original) return { error: '缺少 original（你的原句）' };
    if (!corrected && !natural) return { error: '缺少 corrected（改正后的句子）' };
    return {
      item: {
        kind: 'fix',
        original,
        corrected: corrected || natural,
        natural: natural && natural !== corrected ? natural : '',
        why_zh: clean(pick(v, ['why_zh', 'explanation_zh', 'why', 'explanation', 'reason', 'note']), 300),
        type: normalizeType(pick(v, ['type', 'category', 'error_type'])),
        focus: clean(pick(v, ['focus', 'pattern', 'target', 'chunk', 'key_point']), 140)
      }
    };
  }

  function normScores(v) {
    if (!isObj(v)) return null;
    const out = {};
    let any = false;
    for (const k of ['overall', 'fluency', 'grammar', 'vocabulary', 'naturalness']) {
      const n = toNum(v[k], 0, 100);
      out[k] = n;
      if (n != null) any = true;
    }
    return any ? out : null;
  }

  function normWins(v) {
    return asArray(v).map(x => {
      if (typeof x === 'string') return { sentence: clean(x, 300), why_zh: '' };
      if (!isObj(x)) return null;
      return {
        sentence: clean(pick(x, ['sentence', 'text', 'original', 'you_said']), 300),
        why_zh: clean(pick(x, ['why_zh', 'why', 'reason', 'note']), 200)
      };
    }).filter(x => x && x.sentence).slice(0, 8);
  }

  function normalizePack(raw, opts) {
    const now = (opts && opts.now) || Date.now();
    const warnings = [];
    if (Array.isArray(raw) && isObj(raw[0])) {
      warnings.push('粘贴的内容里有多份 Pack，只导入了第一份');
      raw = raw[0];
    }
    if (!isObj(raw)) return { errors: ['内容不是一个 JSON 对象（应该以 { 开头）'], warnings };
    if (isObj(raw.pack)) raw = raw.pack;
    else if (isObj(raw.daily_pack)) raw = raw.daily_pack;

    let date = clean(pick(raw, ['date', 'day']), 20);
    if (!isDateKey(date)) {
      if (date) warnings.push('日期「' + date + '」格式不对，已改成今天');
      date = dateKey(now);
    }
    let revision = parseInt(pick(raw, ['revision', 'rev']), 10);
    if (!(revision >= 1)) revision = 1;

    const pack = {
      date,
      revision,
      title: clean(pick(raw, ['title', 'topic', 'theme']), 120) || '未命名的对话',
      summary_zh: clean(pick(raw, ['summary_zh', 'summary', 'review_zh', 'overall_zh', 'overall']), 1200),
      topics: toStrList(pick(raw, ['topics', 'tags']), 8, 40),
      minutes: toNum(pick(raw, ['minutes', 'speaking_minutes', 'duration']), 0, 600),
      scores: normScores(pick(raw, ['scores', 'score'])),
      went_well: normWins(pick(raw, ['went_well', 'wentWell', 'what_went_well', 'highlights', 'good_sentences'])),
      next_targets: toStrList(pick(raw, ['next_targets', 'nextTargets', 'active_targets', 'targets']), 6, 140,
        x => (isObj(x) ? pick(x, ['term', 'focus', 'text']) : x)),
      next_steps_zh: toStrList(pick(raw, ['next_steps_zh', 'next_steps', 'suggestions', 'next_suggestions_zh']), 6, 200)
    };

    const items = [];
    const groups = [
      ['vocab', ['vocabulary', 'vocab', 'words'], '单词'],
      ['expr', ['expressions', 'phrases', 'chunks', 'useful_expressions'], '表达'],
      ['fix', ['feedback', 'corrections', 'fixes', 'errors', 'mistakes'], '纠错']
    ];
    for (const [kind, keys, label] of groups) {
      asArray(pick(raw, keys)).forEach((v, i) => {
        const r = kind === 'fix' ? normFix(v) : normPhrase(v, kind);
        if (r.error) warnings.push(label + '第 ' + (i + 1) + ' 条' + r.error + '，已跳过');
        else items.push(r.item);
      });
    }
    const errors = [];
    if (!items.length) {
      errors.push('没有可导入的单词、表达或纠错内容。这个 Pack 可以保留作聊天复盘，但目前没有可进入复习的素材；请补充真实对话中值得练的内容，或直接跳过导入。');
    }
    return { pack, items, warnings, errors };
  }

  function parsePackText(text, opts) {
    const r = extractJson(text);
    if (r.error) return { errors: [r.error], warnings: [] };
    return normalizePack(r.value, opts);
  }

  // ---------- 条目 ----------
  function itemKey(it) {
    return it.kind + ':' + normalizeText(it.kind === 'fix' ? it.original : it.term);
  }
  function findDuplicates(state, items) {
    const index = new Map();
    for (const it of Object.values(state.items)) {
      if (it && it.status !== 'removed') index.set(itemKey(it), it.id);
    }
    const seen = new Set();
    return items.map(it => {
      const k = itemKey(it);
      if (index.has(k)) return index.get(k);
      if (seen.has(k)) return 'draft';
      seen.add(k);
      return null;
    });
  }
  function stripPrivate(obj) {
    const out = {};
    for (const k of Object.keys(obj)) if (k[0] !== '_') out[k] = obj[k];
    return out;
  }
  // 按类型轮流排列，让每天的新条目里单词、表达、纠错都有
  function interleaveByKind(list) {
    const buckets = KINDS.map(k => list.filter(x => x.kind === k));
    const out = [];
    const max = Math.max(0, ...buckets.map(b => b.length));
    for (let i = 0; i < max; i++) for (const b of buckets) if (b[i]) out.push(b[i]);
    return out;
  }

  function packsOnDate(state, date) {
    return Object.values(state.packs)
      .filter(p => p && !p.deleted && p.date === date)
      .sort((a, b) => b.revision - a.revision || b.importedAt - a.importedAt);
  }

  function applyImport(state, draft, opts) {
    const now = (opts && opts.now) || Date.now();
    const deviceId = (opts && opts.deviceId) || 'local';
    const existing = packsOnDate(state, draft.pack.date);
    let revision = draft.pack.revision || 1;
    if (existing.length) revision = Math.max(revision, existing[0].revision + 1);
    const packId = uid('pk');
    const keep = interleaveByKind(draft.items.filter(d => d._decision !== 'skip'));
    const itemIds = [];
    let active = 0;
    let saved = 0;
    keep.forEach((d, idx) => {
      const item = Object.assign(stripPrivate(d), {
        id: uid('it'),
        status: d._decision === 'saved' ? 'saved' : 'active',
        packId,
        date: draft.pack.date,
        createdAt: now + idx,
        updatedAt: now,
        srs: newSrs()
      });
      state.items[item.id] = item;
      itemIds.push(item.id);
      if (item.status === 'active') active++; else saved++;
    });
    state.packs[packId] = Object.assign(clone(draft.pack), {
      id: packId,
      revision,
      itemIds,
      importedAt: now,
      updatedAt: now,
      deleted: false
    });
    recordActivity(state, deviceId, dateKey(now), 'i', 1);
    return { packId, revision, active, saved, skipped: draft.items.length - keep.length };
  }

  // ---------- 复习调度（简化版 SM-2） ----------
  // rating: 1 忘了 / 2 有提示才想起 / 3 想起来了 / 4 脱口而出
  function schedule(srs, rating, now) {
    const s = Object.assign(newSrs(), srs);
    const prev = s.state;
    let ease = s.ease || 2.5;
    let interval = s.interval || 0;
    s.reps += 1;
    s.last = now;
    if (!s.first) s.first = now;

    if (rating <= 1) {
      if (prev === 'review') s.lapses += 1;
      s.state = 'learning';
      s.interval = 0;
      s.ease = round2(Math.max(1.3, ease - 0.2));
      s.due = now + 10 * MINUTE;
      return s;
    }
    if (prev === 'review' && interval >= 1) {
      if (rating === 2) {
        interval = Math.max(1, interval * 1.2);
        ease = Math.max(1.3, ease - 0.15);
      } else if (rating === 3) {
        interval = Math.max(interval + 1, interval * ease);
      } else {
        interval = Math.max(interval + 2, interval * ease * 1.3);
        ease = Math.min(3, ease + 0.15);
      }
    } else {
      const table = prev === 'learning' ? { 2: 1, 3: 1, 4: 3 } : { 2: 1, 3: 2, 4: 4 };
      interval = table[rating];
      if (rating === 2) ease = Math.max(1.3, ease - 0.15);
      if (rating === 4) ease = Math.min(3, ease + 0.15);
    }
    interval = Math.min(MAX_INTERVAL, Math.round(interval * 10) / 10);
    s.state = 'review';
    s.interval = interval;
    s.ease = round2(ease);
    s.due = addDaysTs(startOfDay(now), Math.max(1, Math.round(interval)));
    return s;
  }

  function formatDays(d) {
    if (d < 30) return d + '天';
    if (d < 365) return Math.round(d / 30) + '个月';
    return Math.round(d / 365) + '年';
  }

  // extra = 加练模式：只有「忘了」会改动计划，其余不变
  function previewIntervals(srs, now, extra) {
    const out = {};
    for (const r of [1, 2, 3, 4]) {
      if (r === 1) { out[r] = '10分钟'; continue; }
      if (extra && srs.state !== 'new') { out[r] = '不变'; continue; }
      const s = schedule(srs, r, now);
      out[r] = formatDays(Math.max(1, Math.round(s.interval)));
    }
    return out;
  }

  function applyRating(state, itemId, rating, opts) {
    const now = (opts && opts.now) || Date.now();
    const item = state.items[itemId];
    if (!item) return null;
    const keepPlan = opts && opts.extra && rating >= 2 && item.srs.state !== 'new';
    if (!keepPlan) item.srs = schedule(item.srs, rating, now);
    item.updatedAt = now;
    recordActivity(state, (opts && opts.deviceId) || 'local', dateKey(now), 'r', 1);
    return item.srs;
  }

  function isMastered(item) {
    return item.status === 'active' && item.srs.state === 'review' && item.srs.interval >= MASTERED_DAYS;
  }
  function activeItems(state, track) {
    return Object.values(state.items).filter(i =>
      i && i.status === 'active' && KINDS.includes(i.kind) && (!track || track === 'all' || i.kind === track));
  }
  function newRemaining(state, now) {
    const sod = startOfDay(now);
    let introduced = 0;
    for (const i of Object.values(state.items)) if (i && i.srs && i.srs.first >= sod) introduced++;
    const cap = Number.isFinite(+state.settings.newPerDay) ? +state.settings.newPerDay : 15;
    return Math.max(0, cap - introduced);
  }
  function buildQueue(state, opts) {
    const now = (opts && opts.now) || Date.now();
    const items = activeItems(state, opts && opts.track);
    const eod = endOfDay(now);
    const due = items
      .filter(i => i.srs.state !== 'new' && i.srs.due <= eod)
      .sort((a, b) => (a.srs.due - b.srs.due) || (b.srs.lapses - a.srs.lapses));
    const cap = Number.isFinite(+state.settings.reviewsPerDay) ? +state.settings.reviewsPerDay : 100;
    const fresh = items
      .filter(i => i.srs.state === 'new')
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1))
      .slice(0, newRemaining(state, now));
    return due.slice(0, Math.max(0, cap)).map(i => i.id).concat(fresh.map(i => i.id));
  }
  function buildExtraQueue(state, opts) {
    const n = (opts && opts.n) || 10;
    return activeItems(state, opts && opts.track)
      .filter(i => i.srs.state !== 'new')
      .sort((a, b) => (b.srs.lapses - a.srs.lapses) || (a.srs.ease - b.srs.ease) || (a.srs.interval - b.srs.interval))
      .slice(0, n)
      .map(i => i.id);
  }
  function countByTrack(state, now) {
    const out = {};
    for (const t of ['all'].concat(KINDS)) {
      const q = buildQueue(state, { track: t, now });
      let fresh = 0;
      for (const id of q) if (state.items[id].srs.state === 'new') fresh++;
      out[t] = { due: q.length - fresh, new: fresh, total: q.length };
    }
    return out;
  }
  function dueLabel(item, now) {
    if (item.status === 'saved') return '收藏';
    if (item.status === 'removed') return '已删除';
    if (item.srs.state === 'new') return '新';
    const days = Math.round((startOfDay(item.srs.due) - startOfDay(now)) / DAY);
    if (days <= 0) return '今天复习';
    if (isMastered(item)) return '已掌握';
    if (days === 1) return '明天复习';
    return days + '天后复习';
  }

  // ---------- 活动与统计 ----------
  function recordActivity(state, deviceId, day, field, inc) {
    const d = state.activity[day] || (state.activity[day] = {});
    const c = d[deviceId] || (d[deviceId] = { r: 0, i: 0 });
    c[field] = (c[field] || 0) + inc;
  }
  function dayTotals(state, day) {
    const out = { r: 0, i: 0 };
    const d = state.activity[day];
    if (!d) return out;
    for (const dev of Object.keys(d)) {
      out.r += d[dev].r || 0;
      out.i += d[dev].i || 0;
    }
    return out;
  }
  function isActiveDay(state, day) {
    const t = dayTotals(state, day);
    return t.r + t.i > 0;
  }
  function streak(state, now) {
    const today = isActiveDay(state, dateKey(now));
    let ts = today ? now : addDaysTs(now, -1);
    let days = 0;
    while (isActiveDay(state, dateKey(ts)) && days < 3660) {
      days++;
      ts = addDaysTs(ts, -1);
    }
    return { days, today };
  }
  function reviewsInLastDays(state, now, n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dayTotals(state, dateKey(addDaysTs(now, -i))).r;
    return sum;
  }
  // 周一开头，最后一列是本周；未来的格子为 null
  function heatmapData(state, now, weeks) {
    const end = startOfDay(now);
    const dow = (new Date(end).getDay() + 6) % 7;
    const firstMonday = addDaysTs(addDaysTs(end, -dow), -(weeks - 1) * 7);
    const cells = [];
    let activeDays = 0;
    for (let i = 0; i < weeks * 7; i++) {
      const ts = addDaysTs(firstMonday, i);
      if (ts > end) { cells.push(null); continue; }
      const day = dateKey(ts);
      const t = dayTotals(state, day);
      const v = t.r + t.i * 5;
      if (v > 0) activeDays++;
      cells.push({ day, reviews: t.r, imports: t.i, level: v === 0 ? 0 : v < 10 ? 1 : v < 25 ? 2 : v < 50 ? 3 : 4 });
    }
    return { weeks, cells, activeDays };
  }
  function libraryStats(state, now) {
    const byKind = {};
    for (const k of KINDS) byKind[k] = { all: 0, active: 0, saved: 0, mastered: 0 };
    let active = 0;
    let saved = 0;
    let mastered = 0;
    for (const it of Object.values(state.items)) {
      if (!it || it.status === 'removed' || !byKind[it.kind]) continue;
      const b = byKind[it.kind];
      b.all++;
      if (it.status === 'active') { b.active++; active++; }
      if (it.status === 'saved') { b.saved++; saved++; }
      if (isMastered(it)) { b.mastered++; mastered++; }
    }
    let wins = 0;
    for (const p of Object.values(state.packs)) if (p && !p.deleted) wins += (p.went_well || []).length;
    return { active, saved, mastered, wins, byKind };
  }
  function errorTypeStats(state) {
    const counts = {};
    let total = 0;
    for (const it of Object.values(state.items)) {
      if (!it || it.kind !== 'fix' || it.status === 'removed') continue;
      const t = FIX_TYPES[it.type] ? it.type : 'other';
      counts[t] = (counts[t] || 0) + 1;
      total++;
    }
    const list = Object.keys(counts)
      .map(type => ({ type, label: FIX_TYPES[type], count: counts[type] }))
      .sort((a, b) => b.count - a.count);
    return { total, list };
  }

  // ---------- 日报 ----------
  function latestPack(state) {
    return Object.values(state.packs)
      .filter(p => p && !p.deleted)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.revision - a.revision || b.importedAt - a.importedAt)[0] || null;
  }
  function packsByDate(state) {
    const map = new Map();
    for (const p of Object.values(state.packs)) {
      if (!p || p.deleted) continue;
      if (!map.has(p.date)) map.set(p.date, []);
      map.get(p.date).push(p);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, list]) => ({ date, revisions: list.sort((a, b) => b.revision - a.revision) }));
  }
  function packItems(state, packId) {
    const p = state.packs[packId];
    const ids = p ? p.itemIds : [];
    const list = ids.map(id => state.items[id]).filter(it => it && it.status !== 'removed');
    return list.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  }
  function scoreSeries(state) {
    const latestByDate = packsByDate(state).map(g => g.revisions[0]);
    return latestByDate
      .filter(p => p.scores)
      .map(p => {
        const vals = ['fluency', 'grammar', 'vocabulary', 'naturalness'].map(k => p.scores[k]).filter(v => v != null);
        const value = p.scores.overall != null ? p.scores.overall
          : vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        return { date: p.date, value };
      })
      .filter(x => x.value != null)
      .reverse()
      .slice(-30);
  }

  // 下次聊天要刻意用上的 3 条
  function pickTargets(state, max) {
    const n = max || 3;
    const out = [];
    const used = new Set();
    const pool = Object.values(state.items).filter(i => i && i.status !== 'removed');
    const latest = latestPack(state);
    if (latest) {
      for (const t of latest.next_targets || []) {
        const nt = normalizeText(t);
        if (!nt) continue;
        const hit = pool.find(i => normalizeText(i.term || i.focus) === nt || normalizeText(i.focus) === nt)
          || pool.find(i => nt.length >= 4 && (normalizeText(i.term || '').includes(nt) || normalizeText(i.focus || '').includes(nt)));
        if (hit && used.has(hit.id)) continue;
        if (hit) used.add(hit.id);
        out.push({
          text: hit ? (hit.kind === 'fix' ? (hit.focus || t) : hit.term) : t,
          meaning: hit ? (hit.kind === 'fix' ? hit.corrected : (hit.meaning_en || hit.meaning_zh || '')) : '',
          itemId: hit ? hit.id : null
        });
        if (out.length >= n) return out;
      }
    }
    const weak = pool
      .filter(i => i.status === 'active' && (i.kind === 'expr' || i.kind === 'fix') && !used.has(i.id) && i.srs.state !== 'new')
      .sort((a, b) => (b.srs.lapses - a.srs.lapses) || (a.srs.ease - b.srs.ease));
    for (const i of weak) {
      if (out.length >= n) break;
      out.push({
        text: i.kind === 'fix' ? (i.focus || i.corrected) : i.term,
        meaning: i.kind === 'fix' ? i.corrected : (i.meaning_en || ''),
        itemId: i.id
      });
    }
    return out;
  }

  function buildOpener(targets) {
    const list = (targets || []).filter(t => t && t.text);
    const lines = ["Hi! Let's start today's English practice."];
    if (list.length) {
      lines.push('', "Today I'd like to naturally use these:");
      list.forEach((t, i) => {
        const showMeaning = t.meaning && normalizeText(t.meaning) !== normalizeText(t.text);
        lines.push((i + 1) + '. ' + t.text + (showMeaning ? ' (' + t.meaning + ')' : ''));
      });
      lines.push('', "Please create natural chances for me to use them, but don't tell me when. If I use one well, don't interrupt. At the end, tell me which ones I used and how well.");
    }
    lines.push('', 'Start by asking me how my day went.');
    return lines.join('\n');
  }

  // ---------- 提示 ----------
  function hintPattern(term) {
    return clean(term, 200).split(' ').map(w => {
      if (/^(\.\.\.|…|sth|sb|something|someone)$/i.test(w)) return w;
      let first = true;
      return w.replace(/[A-Za-z]/g, ch => {
        if (first) { first = false; return ch; }
        return '_';
      });
    }).join(' ');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function blankExample(example, term) {
    if (!example || !term) return '';
    const words = clean(term, 200).replace(/\.\.\.|…/g, ' ').replace(/\b(sth|sb|something|someone)\b/gi, ' ')
      .trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    const last = words.length - 1;
    const parts = words.map((w, i) => {
      if (i === last && /^[A-Za-z-]{4,}$/.test(w)) {
        const stem = w.length > 4 ? w.replace(/(e|y)$/i, '') : w;
        return escapeRe(stem) + "[A-Za-z]*";
      }
      return escapeRe(w);
    });
    const re = new RegExp('(^|[^A-Za-z])(' + parts.join('\\s+') + ')(?![A-Za-z])', 'i');
    if (!re.test(example)) return '';
    return example.replace(re, (m, pre) => pre + '_____');
  }

  // ---------- 口语匹配 ----------
  function tokens(s) { return matchNormalize(s).split(' ').filter(Boolean); }
  function lcsLen(a, b) {
    const dp = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let prev = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[b.length];
  }
  function stemMatch(tok, target) {
    if (tok === target) return true;
    if (target.length < 4 || tok.length < 3) return false;
    const n = Math.max(4, target.length - 2);
    return tok.slice(0, n) === target.slice(0, n);
  }
  function coverage(spokenToks, answerToks) {
    if (!answerToks.length) return 0;
    let hit = 0;
    for (const t of answerToks) if (spokenToks.some(s => stemMatch(s, t))) hit++;
    return hit / answerToks.length;
  }
  function matchSpoken(alternatives, answers) {
    const alts = (alternatives || []).filter(Boolean);
    let best = { score: 0, transcript: alts[0] || '', answer: (answers && answers[0]) || '' };
    for (const alt of alts) {
      const st = tokens(alt);
      const ns = ' ' + st.join(' ') + ' ';
      for (const ans of answers || []) {
        const at = tokens(ans).filter(t => !/^(sth|sb|something|someone)$/.test(t));
        if (!at.length || !st.length) continue;
        let score;
        if (ns.includes(' ' + at.join(' ') + ' ')) score = 1;
        else score = Math.max(2 * lcsLen(st, at) / (st.length + at.length), coverage(st, at) * 0.95);
        if (score > best.score) best = { score, transcript: alt, answer: ans };
      }
    }
    best.score = round2(best.score);
    best.level = best.score >= 0.9 ? 'exact' : best.score >= 0.6 ? 'close' : 'miss';
    return best;
  }

  // ---------- 同步合并 ----------
  function stableStringify(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ta = a.updatedAt || 0;
    const tb = b.updatedAt || 0;
    if (ta !== tb) return ta > tb ? a : b;
    return stableStringify(a) >= stableStringify(b) ? a : b;
  }
  function mergeMaps(a, b) {
    const out = {};
    const keys = [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))].sort();
    for (const k of keys) out[k] = clone(pickNewer((a || {})[k], (b || {})[k]));
    return out;
  }
  function mergeActivity(a, b) {
    const out = {};
    const days = [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))].sort();
    for (const day of days) {
      const da = (a || {})[day] || {};
      const db = (b || {})[day] || {};
      out[day] = {};
      for (const dev of [...new Set(Object.keys(da).concat(Object.keys(db)))].sort()) {
        const ca = da[dev] || {};
        const cb = db[dev] || {};
        out[day][dev] = {};
        for (const f of [...new Set(Object.keys(ca).concat(Object.keys(cb)))].sort()) {
          out[day][dev][f] = Math.max(ca[f] || 0, cb[f] || 0);
        }
      }
    }
    return out;
  }
  function mergeStates(local, remote) {
    if (!remote) return migrateState(local);
    if (!local) return migrateState(remote);
    const a = migrateState(local);
    const b = migrateState(remote);
    return {
      version: 1,
      items: mergeMaps(a.items, b.items),
      packs: mergeMaps(a.packs, b.packs),
      activity: mergeActivity(a.activity, b.activity),
      settings: clone(pickNewer(a.settings, b.settings))
    };
  }

  const api = {
    SCHEMA, KINDS, KIND_LABEL, FIX_TYPES, DAY, MINUTE, MASTERED_DAYS,
    uid, clone, dateKey, isDateKey, startOfDay, endOfDay, addDaysTs, tsFromDateKey, formatDateCN,
    clean, normalizeText, matchNormalize, normalizeType,
    defaultSettings, emptyState, newSrs, migrateState,
    extractJson, normalizePack, parsePackText,
    itemKey, findDuplicates, applyImport, packsOnDate,
    schedule, previewIntervals, applyRating, formatDays, isMastered,
    activeItems, newRemaining, buildQueue, buildExtraQueue, countByTrack, dueLabel,
    recordActivity, dayTotals, streak, reviewsInLastDays, heatmapData, libraryStats, errorTypeStats,
    latestPack, packsByDate, packItems, scoreSeries, pickTargets, buildOpener,
    hintPattern, blankExample, matchSpoken,
    stableStringify, mergeStates
  };
  root.SLCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
