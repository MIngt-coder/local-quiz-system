const assert = require("node:assert/strict");
const { test } = require("node:test");

const { checkAnswer, createVariant, gradeAnswer } = require("../server/quiz");

test("checks objective answers exactly", () => {
  assert.equal(checkAnswer({ type: "single", answer: ["B"] }, ["B"]), true);
  assert.equal(checkAnswer({ type: "multiple", answer: ["A", "D"] }, ["D", "A"]), true);
  assert.equal(checkAnswer({ type: "boolean", answer: ["正确"] }, ["对"]), true);
  assert.equal(checkAnswer({ type: "fill", answer: ["ACID"] }, [" acid "]), true);
  assert.equal(checkAnswer({ type: "single", answer: ["B"] }, ["A"]), false);
});

test("grades short answers by matched keywords instead of exact wording", () => {
  const result = gradeAnswer({
    type: "short",
    answer: ["可行性研究包括技术可行性、经济可行性、操作可行性和法律可行性。"],
  }, ["需要分析技术是否能实现，也要看经济成本和操作上是否可执行。"]);

  assert.equal(result.isCorrect, true);
  assert.equal(result.score > 0 && result.score < 1, true);
  assert.deepEqual(result.matchedKeywords, ["技术可行性", "经济可行性", "操作可行性"]);
  assert.deepEqual(result.missingKeywords, ["法律可行性"]);
});

test("does not give keyword score for unrelated short answers", () => {
  const result = gradeAnswer({
    type: "short",
    answer: ["瀑布模型强调需求分析、概要设计、详细设计、编码实现、测试维护。"],
  }, ["这道题主要讨论数据库索引和查询速度。"]);

  assert.equal(result.isCorrect, false);
  assert.equal(result.score, 0);
});

test("grades concept answers by meaning-bearing words", () => {
  const result = gradeAnswer({
    type: "short",
    answer: ["进程是资源分配的基本单位，线程是调度执行的基本单位。"],
  }, ["进程主要负责资源分配，线程负责调度执行。"]);

  assert.equal(result.isCorrect, true);
  assert.deepEqual(result.matchedKeywords, ["资源分配", "调度执行"]);
});

test("creates a choice variant while preserving the correct option meaning", () => {
  const variant = createVariant({
    id: "question-1",
    type: "single",
    prompt: "数据库索引的主要作用是？",
    options: [
      { key: "A", text: "增加数据重复" },
      { key: "B", text: "加快查询速度" },
      { key: "C", text: "删除所有约束" },
    ],
    answer: ["B"],
    topic: "数据库索引",
  }, () => 0);

  assert.equal(variant.variant, true);
  assert.equal(variant.sourceQuestionId, "question-1");
  const correctOption = variant.options.find((option) => option.key === variant.answer[0]);
  assert.equal(correctOption.text, "加快查询速度");
});
