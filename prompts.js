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
      next_steps_zh: []
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
- next_steps_zh: an array of brief Chinese suggestion strings, or empty. \`summary_zh\` may also be brief or empty. Never fill quotas. If there is no eligible material, return empty arrays rather than fake items.`;

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

  const REVISE_EXAMPLE = '请修复刚才的 Pack：只保留本次对话中有依据的内容；不要补凑条目。';
  const api = {
    SCHEMA, DEFAULT_ABOUT_ME, PROJECT_INSTRUCTIONS, PACK_COMMAND, START_CONVERSATION_COMMAND,
    REVISE_EXAMPLE, CHECK_COMMAND, packTemplate, templateJson, localDate,
    projectInstructions, configuredPackCommand, standalonePackRequest, repairPackRequest
  };
  root.SLPrompts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
