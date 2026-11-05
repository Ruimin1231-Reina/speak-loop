// 故事（第一人称复述）、关键句、说法升级、复述间隔、分句与高亮
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const NOW = new Date(2026, 9, 28, 20, 0, 0).getTime();

function storyPack() {
  return {
    schema: 'speak-loop/pack@1',
    date: '2026-10-28',
    title: 'Moving to a new city',
    topics: ['life'],
    expressions: [{ term: 'settle in', meaning_en: 'become comfortable in a new place' }],
    upgrades: [{ basic: 'It was very hard.', better: 'It was tougher than I expected.', why_zh: '更具体' }],
    story: {
      kind: 'diary',
      title: 'My first month in a new city',
      full: [
        'Last month I moved to a new city for work. The first week was tougher than I expected.',
        'I did not know anyone, so I joined a running club. Now I am starting to settle in.'
      ],
      short: 'I moved to a new city last month. It was hard at first, but a running club helped me settle in.',
      outline: ['Moved for work', 'Tough first week', 'Running club → settling in'],
      key_sentences: [
        { sentence: 'The first week was tougher than I expected.', cue: 'How the first week felt' },
        'Now I am starting to settle in.'
      ]
    }
  };
}

test('normalizePack: 读取故事、关键句和说法升级', () => {
  const r = C.normalizePack(storyPack(), { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.story.kind, 'diary');
  assert.equal(r.story.full.length, 2);
  assert.equal(r.story.short.length, 1, '字符串形式的短版也能读成段落');
  assert.equal(r.story.outline.length, 3);
  assert.deepEqual(r.story.topics, ['life'], '故事没写话题时沿用 Pack 的');
  const sentences = r.items.filter(i => i.form === 'sentence');
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].kind, 'expr');
  assert.equal(sentences[0].cue, 'How the first week felt');
  const up = r.items.find(i => i.form === 'upgrade');
  assert.equal(up.kind, 'fix');
  assert.equal(up.original, 'It was very hard.');
  assert.equal(up.corrected, 'It was tougher than I expected.');
});

test('normalizePack: 只有故事、没有其他素材也能导入；故事没有正文会提示', () => {
  const onlyStory = { date: '2026-10-28', story: { full: 'One paragraph only.\n\nAnd a second one.' } };
  const r = C.normalizePack(onlyStory, { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal(r.story.full.length, 2);
  assert.equal(r.story.kind, 'story');
  const bad = C.normalizePack({ date: '2026-10-28', story: { title: 'x' }, expressions: ['go with the flow'] }, { now: NOW });
  assert.equal(bad.story, null);
  assert.ok(bad.warnings.some(w => w.includes('故事缺少正文')));
  const empty = C.normalizePack({ date: '2026-10-28', story: null }, { now: NOW });
  assert.equal(empty.errors.length, 1);
});

function importStory(state, extra) {
  const r = C.normalizePack(storyPack(), { now: NOW });
  const draft = Object.assign({
    pack: r.pack,
    story: r.story,
    items: r.items.map(i => Object.assign({ _decision: 'active' }, i))
  }, extra || {});
  draft._storyDup = C.findStoryDuplicate(state, r.story, r.pack.date);
  return C.applyImport(state, draft, { now: NOW, deviceId: 'devA' });
}

test('applyImport: 保存故事并和 Pack 关联；重新导入同名故事会替换旧的并保留进度', () => {
  const s = C.emptyState();
  const r1 = importStory(s);
  const st = s.stories[r1.storyId];
  assert.ok(st);
  assert.equal(s.packs[r1.packId].storyId, r1.storyId);
  assert.equal(st.packId, r1.packId);
  assert.equal(st.retell.step, 0);
  assert.equal(st.retell.due, C.addDaysTs(C.startOfDay(NOW), 1), '导入后第二天讲第一次');
  C.applyRetell(s, r1.storyId, true, { now: NOW });
  const r2 = importStory(s);
  assert.equal(s.stories[r1.storyId].status, 'removed');
  assert.equal(s.stories[r2.storyId].retell.step, 1, '替换时保留复述进度');
  assert.equal(C.activeStories(s).length, 1);
  const r3 = importStory(C.emptyState(), { _storyDecision: 'skip' });
  assert.equal(r3.storyId, null);
});

test('复述间隔：讲顺了逐步拉长，卡住了退一步并明天再来；提示逐步减少', () => {
  let r = C.newRetell(NOW);
  const day = n => C.addDaysTs(C.startOfDay(NOW), n);
  r = C.scheduleRetell(r, true, NOW); assert.equal(r.step, 1); assert.equal(r.due, day(2));
  r = C.scheduleRetell(r, true, NOW); assert.equal(r.step, 2); assert.equal(r.due, day(4));
  r = C.scheduleRetell(r, true, NOW); assert.equal(r.step, 3); assert.equal(r.due, day(12));
  r = C.scheduleRetell(r, false, NOW); assert.equal(r.step, 2); assert.equal(r.due, day(1)); assert.equal(r.lapses, 1);
  assert.equal(C.retellCueLevel(0), 'outline+terms');
  assert.equal(C.retellCueLevel(2), 'outline');
  assert.equal(C.retellCueLevel(5), 'title');
  for (let i = 0; i < 10; i++) r = C.scheduleRetell(r, true, NOW);
  assert.equal(r.step, C.RETELL_GAPS.length, '步数有上限');
});

test('今天要讲的故事、关键表达清单、到期标签', () => {
  const s = C.emptyState();
  const r1 = importStory(s);
  assert.equal(C.storiesDue(s, NOW).length, 0, '导入当天不用讲');
  assert.equal(C.storiesDue(s, NOW + C.DAY).length, 1);
  assert.equal(C.storyDueLabel(s.stories[r1.storyId], NOW), '明天讲');
  const terms = C.storyTerms(s, s.stories[r1.storyId]);
  assert.ok(terms.includes('settle in'));
  assert.ok(terms.includes('It was tougher than I expected.'));
  assert.ok(!terms.some(t => t.startsWith('The first week')), '关键句不算在表达清单里');
  assert.equal(C.retellVersion(s.stories[r1.storyId]), 'short', '第一次讲 1 分钟版');
  assert.equal(C.libraryStats(s, NOW).stories, 1);
});

test('splitSentences: 处理缩写、引号、小数和问句', () => {
  assert.deepEqual(C.splitSentences('I met Dr. Smith at 3.5 km. He said "hi!" Then we left? Yes.'),
    ['I met Dr. Smith at 3.5 km.', 'He said "hi!"', 'Then we left?', 'Yes.']);
  assert.deepEqual(C.splitSentences('We need e.g. more time. OK'), ['We need e.g. more time.', 'OK']);
  assert.deepEqual(C.splitSentences(''), []);
  const st = { full: ['A. B.', 'C.'], short: [] };
  assert.deepEqual(C.storyParagraphs(st, 'short'), [['A.', 'B.'], ['C.']], '没有短版时用完整版');
  assert.equal(C.wordCount("I've been a lawyer for two years."), 7);
});

test('highlightRanges: 词形变化、占位词、弯引号、重叠合并', () => {
  const text = 'The court ruled in our favor. I’ve been a lawyer for years, and we distinguished between gifts and tips.';
  const show = rs => rs.map(([a, b]) => text.slice(a, b));
  assert.deepEqual(show(C.highlightRanges(text, ['rule in someone\'s favor'])), ['ruled in', 'favor']);
  assert.deepEqual(show(C.highlightRanges(text, ["I've been a ... for ..."])), ['I’ve been a']);
  assert.deepEqual(show(C.highlightRanges(text, ['distinguish between A and B'])), ['distinguished between']);
  assert.deepEqual(show(C.highlightRanges(text, ['the court', 'court ruled'])), ['The court ruled']);
  assert.deepEqual(C.highlightRanges(text, ['banana split']), []);
});

test('mergeStates 合并故事；migrateState 清理坏的故事', () => {
  const a = C.emptyState();
  const b = C.emptyState();
  a.stories.x = { id: 'x', title: 'old', full: ['a'], updatedAt: 1 };
  b.stories.x = { id: 'x', title: 'new', full: ['b'], updatedAt: 2 };
  b.stories.y = { id: 'y', title: 'only b', full: ['c'], updatedAt: 3 };
  const m = C.mergeStates(a, b);
  assert.equal(m.stories.x.title, 'new');
  assert.ok(m.stories.y);
  assert.equal(C.stableStringify(C.mergeStates(b, a)), C.stableStringify(m));
  const mig = C.migrateState({ stories: { bad: { title: 'no text' }, ok: { full: ['x'] } } });
  assert.deepEqual(Object.keys(mig.stories), ['ok']);
  assert.equal(mig.stories.ok.status, 'active');
  assert.equal(mig.stories.ok.retell.step, 0);
  assert.deepEqual(C.migrateState({}).stories, {}, '旧数据没有 stories 也能用');
});
