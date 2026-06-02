const typeLabels = new Map([
  ["单选题", "single"],
  ["单项选择题", "single"],
  ["多选题", "multiple"],
  ["多项选择题", "multiple"],
  ["判断题", "boolean"],
  ["填空题", "fill"],
  ["简答题", "short"],
  ["问答题", "short"],
]);

function parseQuestions(text) {
  const normalized = normalizeText(text);
  const sections = splitSections(normalized);

  if (sections.length) {
    return sections
      .flatMap(parseSection)
      .filter((question) => question.prompt);
  }

  return splitQuestionBlocks(normalized)
    .map((block) => parseQuestionBlock(block))
    .filter((question) => question.prompt);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function splitSections(text) {
  const sections = [];
  let current = null;

  for (const line of cleanLines(text)) {
    const heading = line.match(/^[一二三四五六七八九十]+、\s*(.+)$/);
    if (heading) {
      current = { title: heading[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return sections;
}

function parseSection(section) {
  const defaultType = inferSectionType(section.title);
  const blocks = defaultType === "short" && /名词解释/.test(section.title)
    ? splitGlossaryBlocks(section.lines)
    : splitSequentialNumberedBlocks(section.lines);

  return blocks.map((block) => parseQuestionBlock(block, defaultType, section.title));
}

function inferSectionType(title) {
  if (/填空/.test(title)) return "fill";
  if (/判断/.test(title)) return "boolean";
  if (/简答|问答|名词解释|设计题/.test(title)) return "short";
  return "";
}

function splitSequentialNumberedBlocks(lines) {
  const blocks = [];
  let current = null;
  let expectedNumber = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\d+)\s*[.、．)]\s*(.*)$/);
    const isQuestionStart =
      match &&
      Number(match[1]) === expectedNumber &&
      looksLikeQuestionStart(lines, index);

    if (isQuestionStart) {
      if (current) blocks.push(current);
      current = [match[2].trim()];
      expectedNumber += 1;
    } else if (current) {
      current.push(lines[index]);
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function looksLikeQuestionStart(lines, startIndex) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^\d+\s*[.、．)]\s*/.test(lines[index])) return false;
    if (isAnswerLabel(lines[index]) || isOptionLine(lines[index])) return true;
  }
  return false;
}

function splitGlossaryBlocks(lines) {
  const blocks = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const isEntryStart =
      !isMetadataLabel(lines[index]) &&
      index + 1 < lines.length &&
      isAnswerLabel(lines[index + 1]);

    if (isEntryStart) {
      if (current) blocks.push(current);
      current = [lines[index]];
    } else if (current) {
      current.push(lines[index]);
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function splitQuestionBlocks(text) {
  const marker = /^\s*(?:\d+\s*[.、．)]|[（(]\s*\d+\s*[）)])\s*/gm;
  const matches = [...text.matchAll(marker)];

  if (!matches.length) {
    return text ? [text] : [];
  }

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return text.slice(start, end).trim();
  });
}

function parseQuestionBlock(block, defaultType = "", sectionTitle = "") {
  const lines = Array.isArray(block) ? cleanLines(block) : cleanLines(block);
  let explicitType = "";
  const options = [];
  const promptLines = [];
  let answerText = "";
  let explanation = "";
  let topic = "";
  let activeField = "prompt";

  for (const originalLine of lines) {
    let line = originalLine;
    const typeMatch = line.match(/^[【\[]\s*([^】\]]+)\s*[】\]]\s*/);

    if (typeMatch && typeLabels.has(typeMatch[1])) {
      explicitType = typeLabels.get(typeMatch[1]);
      line = line.slice(typeMatch[0].length).trim();
      if (!line) continue;
    }

    if (["prompt", "options"].includes(activeField)) {
      const optionMatch = line.match(/^([A-Ha-h])\s*[.、．)]\s*(.+)$/);
      if (optionMatch) {
        options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
        activeField = "options";
        continue;
      }
    }

    const answerMatch = line.match(/^(?:答案|参考答案|正确答案|Answer)\s*[:：]\s*(.*)$/i);
    if (answerMatch) {
      answerText = answerMatch[1].trim();
      activeField = "answer";
      continue;
    }

    const explanationMatch = line.match(/^(?:解析|答案解析|零基础解析|相关知识拓展|Explanation)\s*[:：]\s*(.*)$/i);
    if (explanationMatch) {
      explanation = appendText(explanation, explanationMatch[1]);
      activeField = "explanation";
      continue;
    }

    const topicMatch = line.match(/^(?:考点|知识点|Topic)\s*[:：]\s*(.*)$/i);
    if (topicMatch) {
      topic = topicMatch[1].trim();
      activeField = "topic";
      continue;
    }

    if (activeField === "explanation") {
      explanation = appendText(explanation, line);
    } else if (activeField === "answer") {
      answerText = appendText(answerText, line);
    } else if (activeField === "prompt") {
      promptLines.push(line);
    }
  }

  const prompt = promptLines.join("\n").trim();
  const optionKeys = new Set(options.map((option) => option.key));
  const type = explicitType || defaultType || inferType({ answerText, options, prompt });
  const rawChoiceKeys = ["single", "multiple"].includes(type)
    ? extractLeadingChoiceKeys(answerText)
    : [];
  const answer = normalizeAnswer(answerText, type, optionKeys);
  const hasInvalidChoiceKey = rawChoiceKeys.some((key) => !optionKeys.has(key));
  const normalizedTopic = normalizeTopic(topic) || inferTopic({ prompt, answerText, explanation, sectionTitle });

  return {
    type,
    prompt,
    options,
    answer,
    explanation,
    topic: normalizedTopic,
    needsReview:
      !prompt ||
      answer.length === 0 ||
      hasInvalidChoiceKey ||
      (["single", "multiple"].includes(type) && options.length < 2) ||
      (type === "single" && answer.length !== 1),
  };
}

function normalizeTopic(topic) {
  const text = String(topic || "")
    .replace(/^[《【\[]|[》】\]]$/g, "")
    .replace(/(?:题目|答案|解析|零基础|相关知识拓展|选择题|单选题|多选题|判断题|填空题|简答题|问答题|名词解释)/g, "")
    .replace(/[：:，,。；;、\s]+$/g, "")
    .replace(/^[：:，,。；;、\s]+/g, "")
    .trim();

  if (!text || text.length < 2 || text.length > 18) return "";
  return text;
}

function inferTopic({ prompt, answerText, explanation, sectionTitle }) {
  const text = `${prompt}\n${answerText}\n${explanation}`;
  const knownTopics = [
    ["数据库索引", /索引|查询速度|B\+?树|B树|扫描数据/],
    ["数据库事务", /事务|ACID|原子性|一致性|隔离性|持久性/],
    ["数据完整性", /完整性|实体完整性|参照完整性|用户定义完整性/],
    ["关系模型", /关系模型|关系数据库|关系代数/],
    ["数据流图", /数据流图|DFD|结构化分析/],
    ["需求工程", /需求工程|需求获取|需求分析|需求管理/],
    ["可行性研究", /可行性|技术可行性|经济可行性|操作可行性|法律可行性/],
    ["软件测试", /软件测试|测试用例|集成测试|单元测试|系统测试/],
    ["黑盒测试", /黑盒测试|功能测试|输入和输出/],
    ["白盒测试", /白盒测试|结构测试|路径覆盖|语句覆盖/],
    ["软件设计", /概要设计|详细设计|模块设计|接口设计|内聚|耦合/],
    ["螺旋模型", /螺旋模型|风险分析/],
    ["瀑布模型", /瀑布模型|顺序阶段/],
    ["进程与线程", /进程|线程|资源分配|调度执行/],
    ["CPU 调度", /CPU|调度算法|时间片|优先级调度/],
    ["网络协议", /网络协议|TCP|UDP|HTTP|IP协议|面向连接/],
    ["缓存机制", /缓存|缓存雪崩|缓存穿透|缓存击穿/],
  ];

  const matched = knownTopics.find(([, pattern]) => pattern.test(text));
  if (matched) return matched[0];

  const sectionTopic = normalizeTopic(sectionTitle);
  if (sectionTopic) return sectionTopic;

  const compact = text.replace(/\s+/g, "");
  const leadMatch = compact.match(/^([\u4e00-\u9fa5A-Za-z0-9]{2,12})(?:的|是|指|主要|最显著|基本|包含|包括|有哪些|是什么)/);
  if (leadMatch) return leadMatch[1];

  const bracketMatch = compact.match(/[（(]([\u4e00-\u9fa5A-Za-z0-9]{2,12})[）)]/);
  if (bracketMatch) return bracketMatch[1];

  return "未分类";
}

function cleanLines(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split("\n");
  return lines.map((line) => line.trim()).filter(Boolean);
}

function appendText(current, line) {
  return [current, line.trim()].filter(Boolean).join("\n");
}

function isOptionLine(line) {
  return /^[A-Ha-h]\s*[.、．)]\s*.+$/.test(line);
}

function isAnswerLabel(line) {
  return /^(?:答案|参考答案|正确答案|Answer)\s*[:：]/i.test(line);
}

function isMetadataLabel(line) {
  return /^(?:答案|参考答案|正确答案|Answer|解析|答案解析|零基础解析|相关知识拓展|Explanation|考点|知识点|Topic)\s*[:：]/i.test(line);
}

function inferType({ answerText, options, prompt }) {
  if (options.length) {
    return extractLeadingChoiceKeys(answerText).length > 1 ? "multiple" : "single";
  }

  if (/^(?:正确|错误|对|错|是|否)$/i.test(answerText.trim())) {
    return "boolean";
  }

  if (/_{2,}|（\s*）|\(\s*\)/.test(prompt)) {
    return "fill";
  }

  return "short";
}

function normalizeAnswer(answerText, type, optionKeys = new Set()) {
  const text = answerText.trim();
  if (!text) return [];

  if (type === "single" || type === "multiple") {
    return [...new Set(extractLeadingChoiceKeys(text).filter((key) => optionKeys.has(key)))].sort();
  }

  if (type === "boolean") {
    if (/^(?:正确|对|是)$/i.test(text)) return ["正确"];
    if (/^(?:错误|错|否)$/i.test(text)) return ["错误"];
  }

  if (type === "fill") {
    return text
      .split(/\s*(?:[；;|]|\/+|／+)\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [text];
}

function extractLeadingChoiceKeys(answerText) {
  const match = answerText
    .trim()
    .match(/^[【[(（]?\s*([A-H](?:\s*[,，、;；/ ]?\s*[A-H])*)\s*(?=$|[.。、,，;；:：)）\]】\s])/i);
  return match ? (match[1].toUpperCase().match(/[A-H]/g) || []) : [];
}

module.exports = { parseQuestions };
