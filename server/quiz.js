function checkAnswer(question, answer) {
  return gradeAnswer(question, answer).isCorrect;
}

function gradeAnswer(question, answer) {
  if (question.type === "short") return gradeKeywordAnswer(question, answer);

  const expected = normalizeValues(question.answer, question.type);
  const actual = normalizeValues(answer, question.type);
  const isCorrect = expected.length === actual.length && expected.every((value, index) => value === actual[index]);
  return {
    isCorrect,
    score: isCorrect ? 1 : 0,
    maxScore: 1,
    matchedKeywords: [],
    missingKeywords: [],
  };
}

function gradeKeywordAnswer(question, answer) {
  const submitted = normalizeText(Array.isArray(answer) ? answer.join(" ") : answer);
  const keywords = extractKeywords((question.answer || []).join(" "));

  if (!submitted || !keywords.length) {
    const exact = normalizeText((question.answer || []).join(" ")) === submitted;
    return {
      isCorrect: exact,
      score: exact ? 1 : 0,
      maxScore: 1,
      matchedKeywords: [],
      missingKeywords: [],
    };
  }

  const matchedKeywords = keywords.filter((keyword) => matchesKeyword(submitted, keyword));
  const missingKeywords = keywords.filter((keyword) => !matchedKeywords.includes(keyword));
  const score = Number((matchedKeywords.length / keywords.length).toFixed(2));

  return {
    isCorrect: score >= 0.6,
    score,
    maxScore: 1,
    matchedKeywords,
    missingKeywords,
  };
}

function extractKeywords(text) {
  const normalized = normalizeText(text);
  const keywordText = normalized.replace(/(?:包括|包含|强调|主要有|分为|以及|和|与|及)/g, "、");
  const phraseKeywords = [];
  const clauseKeywords = [];
  const add = (target, value) => {
    const keyword = value
      .replace(/^.+是/, "")
      .replace(/^(?:包括|包含|强调|主要|可以|需要|进行|以及|和|与|及|等|是|指)+/, "")
      .replace(/(?:等|方面|阶段|过程|内容|之一)+$/, "")
      .trim();
    if (keyword.length >= 2 && keyword.length <= 16 && !target.includes(keyword)) target.push(keyword);
  };

  for (const match of keywordText.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:可行性|模型|设计|分析|实现|测试|维护|编码|研究|管理|原则|特点|方法|阶段|索引|事务|约束|完整性|一致性)/g)) {
    add(phraseKeywords, match[0]);
  }

  for (const match of keywordText.matchAll(/(?:^|[是，。；;、：:\n\r])([\u4e00-\u9fa5A-Za-z0-9]{2,8}(?:分配|调度执行|执行|共享|管理))/g)) {
    add(phraseKeywords, match[1]);
  }

  keywordText
    .split(/[，。；;、：:\n\r（）()]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 12)
    .forEach((part) => add(clauseKeywords, part));

  const keywords = phraseKeywords.length ? phraseKeywords : clauseKeywords;
  const focused = keywords.length > 1 ? keywords.filter((keyword) => keyword !== "可行性研究") : keywords;
  return focused.slice(0, 8);
}

function matchesKeyword(answerText, keyword) {
  if (answerText.includes(keyword)) return true;
  const core = keyword.replace(/(?:可行性|模型|设计|分析|实现|测试|维护|编码|研究|管理|原则|特点|方法|阶段|索引|事务|约束|完整性|一致性)$/g, "");
  return core.length >= 2 && answerText.includes(core);
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[“”"']/g, "")
    .trim();
}

function normalizeValues(values, type) {
  const items = Array.isArray(values) ? values : [values];
  return items
    .map((value) => normalizeValue(value, type))
    .filter(Boolean)
    .sort();
}

function normalizeValue(value, type) {
  const text = String(value ?? "").trim();
  if (type === "boolean") {
    if (/^(?:正确|对|是)$/i.test(text)) return "正确";
    if (/^(?:错误|错|否)$/i.test(text)) return "错误";
  }
  if (type === "fill") return text.toLowerCase().replace(/\s+/g, " ");
  return text.toUpperCase();
}

function createVariant(question, random = Math.random) {
  if (!["single", "multiple"].includes(question.type) || question.options.length < 2) {
    return {
      ...question,
      prompt: buildPromptVariant(question),
      sourceQuestionId: question.id,
      variant: true,
    };
  }

  const shuffled = shuffle([...question.options], random);
  const keyMap = new Map();
  const options = shuffled.map((option, index) => {
    const key = String.fromCharCode(65 + index);
    keyMap.set(option.key, key);
    return { key, text: option.text };
  });

  return {
    ...question,
    options,
    answer: question.answer.map((key) => keyMap.get(key)).filter(Boolean).sort(),
    sourceQuestionId: question.id,
    variant: true,
  };
}

function buildPromptVariant(question) {
  if (question.type === "short") {
    return `围绕“${question.topic}”，请换一个角度回答：${question.prompt}`;
  }
  if (question.type === "fill") {
    return `请完成同一考点的填空：${question.prompt}`;
  }
  return question.prompt;
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function publicQuestion(question) {
  const { answer, explanation, ...visible } = question;
  return visible;
}

module.exports = { checkAnswer, createVariant, gradeAnswer, publicQuestion, shuffle };
