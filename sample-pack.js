/*
 * Speak Loop · sample-pack.js
 * Example Pack for trying selection and review. The app replaces its date with today.
 * It intentionally uses null metrics: text alone cannot establish speaking time or scores.
 */
(function (root) {
  'use strict';

  const SAMPLE_PACK = {
    schema: 'speak-loop/pack@1',
    date: '',
    revision: 1,
    title: '示例 · 周末和朋友聊天',
    summary_zh: '这是一份示例日报：保留少量能在日常聊天里复用的表达。没有可靠依据的时长和评分保持为空。',
    topics: ['daily life', 'weekend'],
    minutes: null,
    scores: { overall: null, fluency: null, grammar: null, vocabulary: null, naturalness: null },
    vocabulary: [
      {
        term: 'unwind', pos: 'v.',
        meaning_en: 'to relax after being busy or worried', meaning_zh: '放松',
        example: 'I like to take a walk to unwind after work.',
        context: '示例：下班后怎么放松'
      },
      {
        term: 'errand', pos: 'n.',
        meaning_en: 'a short trip to do a practical task', meaning_zh: '跑腿',
        example: 'I have a few errands to run before dinner.',
        context: '示例：周末要办的小事'
      },
      {
        term: 'low-key', pos: 'adj.',
        meaning_en: 'quiet and not involving much activity or attention', meaning_zh: '低调轻松的',
        example: 'We had a low-key weekend at home.',
        context: '示例：描述轻松的周末'
      }
    ],
    expressions: [
      {
        term: 'I have been meaning to ...',
        meaning_en: 'used to say you have wanted or planned to do something for a while', meaning_zh: '我一直想……',
        usage: 'casual, mentioning a delayed plan',
        example: 'I have been meaning to try that new café.',
        context: '示例：聊一直想做的事'
      },
      {
        term: 'nothing fancy',
        meaning_en: 'simple and not special or expensive', meaning_zh: '没什么特别的',
        usage: 'casual, describing a simple plan',
        example: 'We made dinner at home, nothing fancy.',
        context: '示例：聊普通的一餐'
      },
      {
        term: 'go with the flow',
        meaning_en: 'to be relaxed and let events happen without detailed plans', meaning_zh: '顺其自然',
        usage: 'casual, plans and weekends',
        example: 'I did not make a plan; I just went with the flow.',
        context: '示例：聊没有安排的一天'
      }
    ],
    feedback: [
      {
        original: 'I usually stay at home in weekend.',
        corrected: 'I usually stay at home on weekends.',
        natural: '',
        why_zh: '泛指周末常用 on weekends', type: 'preposition', focus: 'on weekends'
      },
      {
        original: 'I am boring these days.',
        corrected: 'I am bored these days.',
        natural: 'Things have been a bit boring lately.',
        why_zh: '人感到无聊用 bored', type: 'word_choice', focus: 'bored / boring'
      },
      {
        original: 'I did not went anywhere.',
        corrected: 'I did not go anywhere.',
        natural: '',
        why_zh: 'did not 后用动词原形', type: 'tense', focus: 'did not go'
      }
    ],
    went_well: [
      { sentence: 'I just wanted a quiet weekend.', why_zh: '简洁自然地表达了需求' },
      { sentence: 'We ended up talking for hours.', why_zh: 'ended up 用得自然' }
    ],
    next_targets: ['I have been meaning to ...', 'nothing fancy', 'on weekends'],
    next_steps_zh: ['下次聊天时选一个目标表达自然用一次'],
    upgrades: [
      { basic: 'It was very relaxing.', better: 'It was exactly what I needed.', why_zh: '更具体，说出了这件事对你的意义' }
    ],
    story: {
      kind: 'diary',
      title: 'A low-key weekend',
      topics: ['daily life', 'weekend'],
      full: [
        'Last weekend was pretty low-key. I usually stay at home on weekends, and this time I just went with the flow.',
        'On Saturday morning I had a few errands to run, so I went to the post office and the supermarket. In the afternoon I took a long walk in the park to unwind.',
        'I have been meaning to try the new café near my place, so on Sunday I finally went there with a friend. We ended up talking for hours. It was nothing fancy, but it was exactly what I needed.',
        "To be honest, I've been a bit bored lately, so a quiet weekend with a good conversation really helped."
      ],
      short: [
        'Last weekend was pretty low-key. I ran a few errands, took a long walk to unwind, and finally tried the new café near my place with a friend. We ended up talking for hours. Nothing fancy, but exactly what I needed.'
      ],
      outline: [
        'Low-key weekend → went with the flow',
        'Saturday: errands → long walk to unwind',
        'Sunday: the new café with a friend → talked for hours',
        'Bored lately → a quiet weekend helped'
      ],
      key_sentences: [
        { sentence: 'I have been meaning to try the new café near my place, so on Sunday I finally went there with a friend.', cue: 'A café you had wanted to try for a while' },
        { sentence: 'We ended up talking for hours.', cue: 'What happened at the café' }
      ]
    }
  };

  root.SL_SAMPLE_PACK = SAMPLE_PACK;
  if (typeof module !== 'undefined' && module.exports) module.exports = SAMPLE_PACK;
})(typeof window !== 'undefined' ? window : globalThis);
