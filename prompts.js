/*
 * Speak Loop · prompts.js
 * ChatGPT prompt builders. {{ABOUT_ME}} is replaced by optional local context.
 * Keep PACK_TEMPLATE compatible with core.js normalizePack.
 */
(function (root) {
  'use strict';

  const SCHEMA = 'speak-loop/pack@1';
  const DEFAULT_ABOUT_ME = 'I am a Chinese learner of English. I want to speak more naturally and confidently.';
  const PACK_COMMAND = '生成今日 Pack';
  const START_CONVERSATION_COMMAND = "Hi! I'd like to practise everyday English conversation. Please start with one short question.";
  const CHECK_COMMAND = 'check that';

  function localDate(value) {
    const d = value instanceof Date ? value : value == null ? new Date() : new Date(value);
    if (Number.isNaN(d.getTime())) return localDate();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function packTemplate(date) {
    return {
      schema: SCHEMA,
      date: date || 'YYYY-MM-DD',
      revision: 1,
      title: 'short everyday-conversation topic',
      summary_zh: '简短中文复盘；没有可靠依据可留空',
      topics: [],
      minutes: null,
      scores: { overall: null, fluency: null, grammar: null, vocabulary: null, naturalness: null },
      vocabulary: [],
      expressions: [],
      feedback: [],
      went_well: [],
      next_targets: [],
      next_steps_zh: [],
      upgrades: [],
      story: { kind: 'diary', title: '', topics: [], full: [], short: [], outline: [], key_sentences: [] }
    };
  }

  function templateJson(date) { return JSON.stringify(packTemplate(date), null, 2); }

  const PACK_RULES = `Return exactly ONE \`\`\`json code block and nothing else. It must be valid JSON with double quotes, no comments, and no trailing commas.
Use only the real text in this conversation. Never invent biography, scores, speaking time, exact quotations, or things the learner said. A voice transcript may differ from actual speech; text alone cannot assess pronunciation or actual speaking duration. Keep minutes and every score value null unless the learner explicitly supplied a reliable value; do not estimate. Never give IELTS or any other official score.

Use this schema exactly:
{{PACK_TEMPLATE}}

Rules:
- vocabulary: 0-5 items shaped as {"term":"","pos":"","meaning_en":"","meaning_zh":"","example":"","context":""}.
- expressions: 0-5 items shaped as {"term":"","meaning_en":"","meaning_zh":"","usage":"","example":"","context":""}.
- For vocabulary and expressions, include only reusable items grounded in this conversation. \`meaning_en\` is a short English definition; \`example\` is a new illustrative example, not a quote from the learner; \`context\` briefly describes what the learner was trying to say. Empty optional strings are allowed.
- feedback: 0-3 items shaped as {"original":"","corrected":"","natural":"","why_zh":"","type":"","focus":""}. Include only clear, meaningful issues grounded in the conversation. \`original\` must be supported by clear transcript text; \`corrected\` is the smallest useful correction. \`natural\` is optional, only when it offers a genuinely helpful alternative. Do not correct valid variants just to prefer one wording. \`type\` is tense, article, preposition, collocation, word_choice, structure, agreement, chinglish, or other; do not infer pronunciation from text.
- went_well: 0-3 items shaped as {"sentence":"","why_zh":""}, using only clearly supported transcript text; fewer or none is fine.
- next_targets: up to 3 strings copied from eligible vocabulary/expression terms or feedback focus. Leave empty when there are no grounded targets.
- next_steps_zh: an array of brief Chinese suggestion strings, or empty. \`summary_zh\` may also be brief or empty. Never fill quotas. If there is no eligible material, return empty arrays rather than fake items.
- upgrades: 0-3 items shaped as {"basic":"","better":"","why_zh":""}: a plain way the learner said something in this conversation, and a more precise or natural way to say it (for example "I was very busy." → "I've been swamped lately.").
- story: a polished first-person retelling of what the learner talked about, written the way the learner could say it to a friend. It is a retelling, not a quotation. Use only facts, events and opinions the learner actually expressed; never add new details, feelings, names or outcomes. Use the corrected and more natural versions of the learner's sentences, and reuse this Pack's expressions where they fit. Natural spoken English slightly above the learner's level. Replace real names and identifying details of other people, clients or companies with general descriptions.
  - kind: "diary" for an ordinary chat about the day; "story" when the learner told one experience or case.
  - full: an array of paragraphs, about 120-350 words in total, scaled to how much the learner said (up to about 600 words for a long story).
  - short: a 30-60 second version (40-120 words) as 1-3 paragraphs.
  - outline: 3-7 short English keyword cues in order, such as "Moved for work → tough first week → joined a running club".
  - key_sentences: 2-6 items shaped as {"sentence":"","cue":""}; each sentence copied word for word from full, and cue a short English hint of what it says (not a translation).
  - If the learner said too little to retell, set story to null.`;

  const PROJECT_INSTRUCTIONS = `# About me (optional, unverified context)
{{ABOUT_ME}}
Treat this only as optional context supplied by the learner, not as confirmed biography. Never invent or repeat personal details. The learner's level is initially unknown: adapt gradually from their answers.

# During our conversation (voice or text)
You are an everyday English conversation partner, not a constant teacher. The learner should do most of the talking and think in English.
- Default to ordinary daily-life conversation unless the learner asks for another scenario. React to their idea first, then ask ONE short follow-up question at a time. Keep your turns short.
- Use natural spoken English and adapt difficulty from the learner's answers. Do not assume a level, profession, background, or interests.
- Do not correct every mistake. Recast only when meaning is unclear or the learner asks for help.
- If the learner says "check that" or "纠正一下", give a minimal correction of the last sentence if needed. Optionally add one natural alternative only if it is useful; do not imply valid alternatives are wrong. Then continue the conversation.
- If the learner gets stuck and uses Chinese, offer a natural English way to say it, invite them to try it once, then continue.
- If the learner brings target expressions, create natural chances to use them without announcing it.
- Quietly note only clear, reusable material grounded in the conversation. Never produce a Daily Pack unless asked. Do not speak the Pack aloud; return JSON text only.

# Daily Pack (only when the learner says "生成今日 Pack", "Daily Pack", or similar)
${PACK_RULES.replace('{{PACK_TEMPLATE}}', templateJson())}`;

  function projectInstructions(aboutMe) {
    const me = String(aboutMe || '').trim() || DEFAULT_ABOUT_ME;
    return PROJECT_INSTRUCTIONS.replace('{{ABOUT_ME}}', me);
  }

  function configuredPackCommand() { return PACK_COMMAND; }

  function standalonePackRequest(now) {
    return `Please create a Daily Pack for this conversation using the exact schema and rules below. Today’s local date is ${localDate(now)}. Return exactly one JSON code block and do not speak it aloud.\n\n${PACK_RULES.replace('{{PACK_TEMPLATE}}', templateJson(localDate(now)))}`;
  }

  function repairPackRequest(now) {
    return `Please repair the Daily Pack you just produced. Keep only material grounded in the real conversation; remove anything uncertain or invented. Do not add scores, speaking time, pronunciation claims, or quotations not clearly supported by the transcript. Keep the conversation date (${localDate(now)}) when applicable, return exactly one valid JSON code block, and do not speak it aloud. Use this exact schema and rules:\n\n${PACK_RULES.replace('{{PACK_TEMPLATE}}', templateJson(localDate(now)))}`;
  }

  // For recaps ChatGPT already wrote in this chat (a polished story, a short version, an expression table…).
  function convertRecapRequest(now) {
    return `Please convert the recap you wrote earlier in this conversation (for example a polished story, a shorter version, a list of useful expressions and tips) into a Speak Loop Daily Pack. Today's local date is ${localDate(now)}; use the date of the conversation if it is clear.
- Keep the story's content and wording. Fix only clear language errors, and do not add new facts. Put the long version in story.full and the shorter version in story.short, then write the outline and key_sentences.
- Put the useful expressions from the recap into expressions (up to 15 for this conversion), each with a short meaning_en and a meaning_zh; use precise standard terms (for example "marital property", not "joint money").
- Put tips such as "say X instead of Y" into upgrades. Use feedback only for real mistakes the learner made.
Return exactly one JSON code block and do not speak it aloud. Use this exact schema and rules:

${PACK_RULES.replace('{{PACK_TEMPLATE}}', templateJson(localDate(now)))}`;
  }

  // "Tell it to ChatGPT": practise using a stored story with a live listener.
  const AUDIENCES = [
    'a curious friend from another country who knows nothing about this topic',
    'a colleague from another country who works in the same field and wants the key points',
    'someone you have just met at a dinner party'
  ];
  function retellTask(story, terms, audienceIndex) {
    const audience = AUDIENCES[Math.abs(audienceIndex || 0) % AUDIENCES.length];
    const list = (terms || []).filter(Boolean).slice(0, 10);
    const outline = (story.outline || []).filter(Boolean);
    return [
      `I'm going to tell you a story in English: "${story.title}". Please listen as ${audience}.`,
      outline.length ? `My outline: ${outline.join(' / ')}.` : '',
      'Do not interrupt me while I tell it. When I finish, ask me 3 natural follow-up questions, one at a time, and wait for each answer.',
      list.length ? `At the end, tell me which of these I actually used: ${list.join('; ')}. Then give me one sentence I could say better, and a better version.` : 'At the end, give me one sentence I could say better, and a better version.',
      'Keep your own turns short. I will start when you say "Go ahead."'
    ].filter(Boolean).join('\n');
  }

  const REVISE_EXAMPLE = '请修复刚才的 Pack：只保留本次对话中有依据的内容；不要补凑条目。';
  const api = {
    SCHEMA, DEFAULT_ABOUT_ME, PROJECT_INSTRUCTIONS, PACK_COMMAND, START_CONVERSATION_COMMAND,
    REVISE_EXAMPLE, CHECK_COMMAND, packTemplate, templateJson, localDate,
    projectInstructions, configuredPackCommand, standalonePackRequest, repairPackRequest, convertRecapRequest,
    retellTask
  };
  root.SLPrompts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
