const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { parseQuestions } = require("../server/parser");

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures", "sample-questions.txt"),
  "utf8",
);

test("recognizes five common question types and metadata", () => {
  const questions = parseQuestions(fixture);

  assert.equal(questions.length, 5);
  assert.deepEqual(
    questions.map((question) => question.type),
    ["single", "multiple", "boolean", "fill", "short"],
  );
  assert.equal(questions[0].prompt, "数据库索引的主要作用是？");
  assert.deepEqual(questions[0].options, [
    { key: "A", text: "增加数据重复" },
    { key: "B", text: "加快查询速度" },
    { key: "C", text: "删除所有约束" },
    { key: "D", text: "替代数据备份" },
  ]);
  assert.deepEqual(questions[1].answer, ["A", "B", "D"]);
  assert.deepEqual(questions[2].answer, ["正确"]);
  assert.deepEqual(questions[3].answer, ["ACID"]);
  assert.equal(questions[4].topic, "进程与线程");
  assert.equal(questions[0].explanation, "索引可以减少查询时需要扫描的数据量。");
  assert.equal(questions.every((question) => question.needsReview === false), true);
});

test("marks incomplete questions for review instead of discarding them", () => {
  const questions = parseQuestions(`
1、下面哪一项需要人工确认？
A. 甲
B. 乙

2、请解释缓存雪崩。
考点：缓存
  `);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, "single");
  assert.equal(questions[0].needsReview, true);
  assert.equal(questions[1].type, "short");
  assert.equal(questions[1].topic, "缓存");
  assert.equal(questions[1].needsReview, true);
});

test("infers fill and boolean questions without explicit type labels", () => {
  const questions = parseQuestions(`
1. TCP 是面向连接的协议。
答案：对

2. CPU 调度的基本单位是 ____。
答案：线程
  `);

  assert.equal(questions[0].type, "boolean");
  assert.deepEqual(questions[0].answer, ["正确"]);
  assert.equal(questions[1].type, "fill");
  assert.deepEqual(questions[1].answer, ["线程"]);
});

test("keeps learning notes out of answers and only accepts real choice keys", () => {
  const questions = parseQuestions(`
一、选择题：题目、答案和零基础解析
1. 在结构化分析方法中，用于描述系统数据流动和处理过程的图形工具是（）。
A. UML图
B. 数据流图（DFD）
C. 程序流程图
D. 实体联系图
答案：B 数据流图（DFD）
零基础解析：数据流图DFD用于描述数据流动。
相关知识拓展：E-R图偏数据库实体关系；UML偏面向对象建模。

二、填空题：题目、答案和零基础解析
1. 螺旋模型最显著的特点是引入了________分析。
答案：风险
零基础解析：螺旋模型最核心的关键词是风险。
相关知识拓展：瀑布=顺序阶段；螺旋=风险分析。
  `);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, "single");
  assert.deepEqual(questions[0].answer, ["B"]);
  assert.match(questions[0].explanation, /数据流图DFD用于描述数据流动/);
  assert.equal(questions[1].type, "fill");
  assert.deepEqual(questions[1].answer, ["风险"]);
  assert.match(questions[1].explanation, /螺旋模型最核心的关键词是风险/);
});

test("recognizes unnumbered glossary entries and does not attach them to the last fill answer", () => {
  const questions = parseQuestions(`
二、填空题：题目、答案和零基础解析
1. 集成测试主要检查模块之间的________是否正确。
答案：接口
零基础解析：模块组合时最容易出问题的是接口。

三、名词解释：题目、答案和零基础解析
黑盒测试
答案：黑盒测试也叫功能测试，只根据需求检查输入和输出。
零基础解析：理解时把程序想成一个黑盒子。

内聚度
答案：内聚度是指模块内部各元素之间联系的紧密程度。
零基础解析：内聚看模块内部。
  `);

  assert.equal(questions.length, 3);
  assert.deepEqual(questions[0].answer, ["接口"]);
  assert.equal(questions[1].prompt, "黑盒测试");
  assert.deepEqual(questions[1].answer, ["黑盒测试也叫功能测试，只根据需求检查输入和输出。"]);
  assert.equal(questions[2].prompt, "内聚度");
});

test("keeps numbered details inside a multiline short answer", () => {
  const questions = parseQuestions(`
四、简答题：题目、答案和零基础解析
1. 详细设计包含哪些内容？
答案：
1. 算法逻辑设计
2. 数据结构设计
零基础解析：概要设计看整体，详细设计看内部。

2. 什么是需求工程？
答案：需求工程是获取、分析和管理软件需求的过程。
  `);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, "short");
  assert.deepEqual(questions[0].answer, ["1. 算法逻辑设计\n2. 数据结构设计"]);
  assert.equal(questions[1].prompt, "什么是需求工程？");
});

test("infers focused topics when the document does not provide clean topic labels", () => {
  const questions = parseQuestions(`
一、选择题：题目、答案和零基础解析
1. 在结构化分析方法中，用于描述系统数据流动和处理过程的图形工具是（）。
A. UML图
B. 数据流图（DFD）
C. 程序流程图
D. 实体联系图
答案：B

二、填空题：题目、答案和零基础解析
1. 螺旋模型最显著的特点是引入了________分析。
答案：风险

三、简答题：题目、答案和零基础解析
1. 请说明需求工程的主要工作。
答案：需求工程包括需求获取、需求分析和需求管理。
  `);

  assert.deepEqual(
    questions.map((question) => question.topic),
    ["数据流图", "螺旋模型", "需求工程"],
  );
});
