const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { extractDocumentText } = require("../server/documents");
const { parseQuestions } = require("../server/parser");

const fixtureDir = path.join(__dirname, "fixtures");

test("extracts a question from a Word document", async () => {
  const text = await extractDocumentText({
    name: "sample-questions.docx",
    content: fs.readFileSync(path.join(fixtureDir, "sample-questions.docx")),
  });
  const questions = parseQuestions(text);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].prompt, "Which protocol is used for web pages?");
  assert.deepEqual(questions[0].answer, ["A"]);
});

test("extracts a question from a text-layer PDF document", async () => {
  const text = await extractDocumentText({
    name: "sample-questions.pdf",
    content: fs.readFileSync(path.join(fixtureDir, "sample-questions.pdf")),
  });
  const questions = parseQuestions(text);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].prompt, "Which protocol is used for web pages?");
  assert.deepEqual(questions[0].answer, ["A"]);
});

test("rejects unsupported file formats with a clear message", async () => {
  await assert.rejects(
    () => extractDocumentText({ name: "sample.doc", content: Buffer.from("test") }),
    /仅支持 Word、PDF 和 TXT 文档/,
  );
});

