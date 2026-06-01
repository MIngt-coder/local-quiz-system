const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-system-"));
  tempDirs.push(dir);
  return dir;
}

async function withServer(run) {
  const { createServer } = require("../server/index");
  const tempDir = makeTempDir();
  const server = createServer({ databasePath: path.join(tempDir, "quiz.sqlite") });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postJson(baseUrl, route, payload) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function importFixture(baseUrl) {
  const content = fs.readFileSync(
    path.join(__dirname, "fixtures", "sample-questions.txt"),
    "utf8",
  );
  const previewResponse = await postJson(baseUrl, "/api/import/preview", {
    name: "期末复习题.txt",
    contentBase64: Buffer.from(content).toString("base64"),
  });
  const preview = await previewResponse.json();
  return postJson(baseUrl, "/api/import/confirm", {
    name: "期末复习题.txt",
    questions: preview.questions,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("dashboard starts empty", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      questionCount: 0,
      documentCount: 0,
      quizCount: 0,
      weakTopics: [],
      recentQuizzes: [],
    });
  });
});

test("previews txt questions, confirms import, and returns the question bank", async () => {
  const content = fs.readFileSync(
    path.join(__dirname, "fixtures", "sample-questions.txt"),
    "utf8",
  );

  await withServer(async (baseUrl) => {
    const previewResponse = await postJson(baseUrl, "/api/import/preview", {
      name: "期末复习题.txt",
      contentBase64: Buffer.from(content).toString("base64"),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.questions.length, 5);
    assert.equal(preview.questions[0].topic, "数据库索引");

    const confirmResponse = await postJson(baseUrl, "/api/import/confirm", {
      name: "期末复习题.txt",
      questions: preview.questions,
    });
    assert.equal(confirmResponse.status, 201);
    const confirmed = await confirmResponse.json();
    assert.equal(confirmed.questionCount, 5);

    const questionsResponse = await fetch(`${baseUrl}/api/questions`);
    assert.equal(questionsResponse.status, 200);
    const questions = await questionsResponse.json();
    assert.equal(questions.length, 5);
    assert.equal(questions[1].type, "multiple");

    const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`);
    assert.deepEqual(await dashboardResponse.json(), {
      questionCount: 5,
      documentCount: 1,
      quizCount: 0,
      weakTopics: [],
      recentQuizzes: [],
    });
  });
});

test("runs practice and exam quizzes, then stores history", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await importFixture(baseUrl)).status, 201);

    const practiceResponse = await postJson(baseUrl, "/api/quizzes", {
      mode: "practice",
      count: 1,
      type: "single",
      useVariants: true,
    });
    assert.equal(practiceResponse.status, 201);
    const practice = await practiceResponse.json();
    assert.equal(practice.mode, "practice");
    assert.equal(practice.questions.length, 1);
    assert.equal("answer" in practice.questions[0], false);

    const sourceQuestions = await (await fetch(`${baseUrl}/api/questions`)).json();
    const sourceSingle = sourceQuestions.find((question) => question.type === "single");
    const practiceAnswer = await postJson(
      baseUrl,
      `/api/quizzes/${practice.id}/answer`,
      { questionId: practice.questions[0].id, answer: sourceSingle.answer },
    );
    assert.equal(practiceAnswer.status, 200);
    assert.equal(typeof (await practiceAnswer.json()).isCorrect, "boolean");

    const examResponse = await postJson(baseUrl, "/api/quizzes", {
      mode: "exam",
      count: 2,
    });
    const exam = await examResponse.json();
    assert.equal(exam.questions.length, 2);

    const sourceById = new Map(sourceQuestions.map((question) => [question.id, question]));
    const examSubmit = await postJson(baseUrl, `/api/quizzes/${exam.id}/submit`, {
      answers: exam.questions.map((question) => ({
        questionId: question.id,
        answer: sourceById.get(question.id).answer,
      })),
    });
    assert.equal(examSubmit.status, 200);
    const examResult = await examSubmit.json();
    assert.equal(examResult.completed, true);
    assert.equal(examResult.scorableCount >= 1, true);

    const historyResponse = await fetch(`${baseUrl}/api/history`);
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.length, 2);
  });
});

test("randomizes quiz question order before taking the requested count", async () => {
  const { createServer } = require("../server/index");
  const tempDir = makeTempDir();
  const server = createServer({
    databasePath: path.join(tempDir, "quiz.sqlite"),
    random: () => 0,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await importFixture(baseUrl);
    const sourceQuestions = await (await fetch(`${baseUrl}/api/questions`)).json();
    const quiz = await (await postJson(baseUrl, "/api/quizzes", {
      mode: "practice",
      count: 3,
    })).json();

    assert.equal(quiz.questions.length, 3);
    assert.notDeepEqual(
      quiz.questions.map((question) => question.id),
      sourceQuestions.slice(0, 3).map((question) => question.id),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("serves the browser application shell and saves model settings", async () => {
  await withServer(async (baseUrl) => {
    const pageResponse = await fetch(baseUrl);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /期末速测台/);
    assert.match(page, /data-view="upload"/);
    assert.match(page, /data-view="library"/);
    assert.match(page, /data-view="records"/);
    assert.match(page, /data-view="settings"/);

    const saveResponse = await postJson(baseUrl, "/api/settings", {
      apiBaseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      model: "example-model",
    });
    assert.equal(saveResponse.status, 200);

    const settings = await (await fetch(`${baseUrl}/api/settings`)).json();
    assert.deepEqual(settings, {
      apiBaseUrl: "https://example.test/v1",
      apiKeyConfigured: true,
      model: "example-model",
      enabled: false,
    });
  });
});

test("records weak topics after a wrong practice answer", async () => {
  await withServer(async (baseUrl) => {
    await importFixture(baseUrl);
    const quiz = await (await postJson(baseUrl, "/api/quizzes", {
      mode: "practice",
      count: 1,
      type: "single",
    })).json();

    const answerResponse = await postJson(baseUrl, `/api/quizzes/${quiz.id}/answer`, {
      questionId: quiz.questions[0].id,
      answer: ["A"],
    });
    assert.equal((await answerResponse.json()).isCorrect, false);

    const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    assert.deepEqual(dashboard.weakTopics, [
      { topic: "数据库索引", wrongCount: 1 },
    ]);
  });
});

test("lists imported documents and deletes one document with all of its questions", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await importFixture(baseUrl)).status, 201);

    const documentsResponse = await fetch(`${baseUrl}/api/documents`);
    assert.equal(documentsResponse.status, 200);
    const documents = await documentsResponse.json();
    assert.equal(documents.length, 1);
    assert.equal(documents[0].name, "期末复习题.txt");
    assert.equal(documents[0].questionCount, 5);

    const deleteResponse = await fetch(`${baseUrl}/api/documents/${documents[0].id}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), {
      deleted: true,
      questionCount: 5,
    });

    assert.deepEqual(await (await fetch(`${baseUrl}/api/questions`)).json(), []);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/documents`)).json(), []);
  });
});

test("returns completed quiz details for review", async () => {
  await withServer(async (baseUrl) => {
    await importFixture(baseUrl);
    const quiz = await (await postJson(baseUrl, "/api/quizzes", {
      mode: "practice",
      count: 1,
      type: "single",
    })).json();

    await postJson(baseUrl, `/api/quizzes/${quiz.id}/answer`, {
      questionId: quiz.questions[0].id,
      answer: ["A"],
    });

    const detailsResponse = await fetch(`${baseUrl}/api/quizzes/${quiz.id}/results`);
    assert.equal(detailsResponse.status, 200);
    const details = await detailsResponse.json();
    assert.equal(details.title, "速成练习");
    assert.equal(details.questions.length, 1);
    assert.equal(details.questions[0].prompt, "数据库索引的主要作用是？");
    assert.deepEqual(details.questions[0].submittedAnswer, ["A"]);
    assert.deepEqual(details.questions[0].correctAnswer, ["B"]);
    assert.equal(details.questions[0].isCorrect, false);
  });
});
