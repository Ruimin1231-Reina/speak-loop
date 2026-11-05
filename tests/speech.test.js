// 声音排序：高级/增强/自然的排在前面，Eloquence 和趣味声音排在最后
const test = require('node:test');
const assert = require('node:assert/strict');

const VOICES = [
  { name: 'Eddy (英语（美国）)', lang: 'en-US', voiceURI: 'com.apple.eloquence.en-US.Eddy', localService: true },
  { name: 'Bubbles', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.Bubbles', localService: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true },
  { name: 'Daniel', lang: 'en-GB', voiceURI: 'com.apple.voice.compact.en-GB.Daniel', localService: true },
  { name: 'Ava (Premium)', lang: 'en-US', voiceURI: 'com.apple.voice.premium.en-US.Ava', localService: true },
  { name: 'Evan (Enhanced)', lang: 'en-US', voiceURI: 'com.apple.voice.enhanced.en-US.Evan', localService: true },
  { name: 'Microsoft Ava Online (Natural) - English (United States)', lang: 'en-US', voiceURI: 'Microsoft Ava Online (Natural) - English (United States)', localService: false },
  { name: 'Tingting', lang: 'zh-CN', voiceURI: 'com.apple.voice.compact.zh-CN.Tingting', localService: true }
];

globalThis.window = {
  speechSynthesis: { getVoices: () => VOICES, addEventListener: () => {}, cancel() {}, speak() {} },
  SpeechSynthesisUtterance: function () {}
};
require('../speech.js');
const S = globalThis.window.SLSpeech;
S.init();

test('自然的声音排在前面，生硬的排在后面，中文声音不出现', () => {
  const names = S.englishVoices().map(v => v.name);
  assert.equal(names.length, 7);
  assert.equal(names[0], 'Ava (Premium)');
  assert.ok(names.indexOf('Microsoft Ava Online (Natural) - English (United States)') < names.indexOf('Samantha'));
  assert.ok(names.indexOf('Evan (Enhanced)') < names.indexOf('Samantha'));
  assert.ok(names.indexOf('Samantha') < names.indexOf('Eddy (英语（美国）)'));
  assert.equal(names[names.length - 1], 'Bubbles');
});

test('没选过声音时自动用最好的；选过的照样用', () => {
  assert.equal(S.bestVoice('').name, 'Ava (Premium)');
  assert.equal(S.bestVoice('com.apple.voice.compact.en-GB.Daniel').name, 'Daniel');
  assert.equal(S.bestVoice('not-installed-any-more').name, 'Ava (Premium)');
});

test('列表里的标签', () => {
  const label = n => S.voiceQuality(VOICES.find(v => v.name.startsWith(n))).label;
  assert.equal(label('Ava (Premium)'), '高音质');
  assert.equal(label('Evan'), '优化音质');
  // 中文界面下名字是本地化的，也能认出来
  assert.equal(S.voiceQuality({ name: 'Zoe（高音质）', lang: 'en-US', voiceURI: 'x.Zoe' }).label, '高音质');
  assert.equal(S.voiceQuality({ name: 'Nathan（优化音质）', lang: 'en-US', voiceURI: 'x.Nathan' }).label, '优化音质');
  assert.equal(label('Microsoft'), '自然');
  assert.equal(label('Eddy'), '较生硬');
  assert.equal(label('Bubbles'), '趣味声音');
  assert.equal(label('Samantha'), '');
});
