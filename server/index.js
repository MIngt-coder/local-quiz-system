const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./db");
const { extractDocumentText } = require("./documents");
const { parseQuestions } = require("./parser");
const { createVariant, gradeAnswer, publicQuestion, shuffle } = require("./quiz");

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 12 * 1024 * 1024) {
      throw new Error("文件过大，请上传小于 12 MB 的文档。");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function createServer(options = {}) {
  const databasePath = options.databasePath || path.join(__dirname, "..", "data", "quiz.sqlite");
  const random = options.random || Math.random;
  const repository = openDatabase(databasePath);

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/api/dashboard") {
        sendJson(response, 200, repository.getDashboard());
        return;
      }

      if (request.method === "GET" && request.url === "/api/questions") {
        sendJson(response, 200, repository.getQuestions());
        return;
      }

      if (request.method === "GET" && request.url === "/api/documents") {
        sendJson(response, 200, repository.getDocuments());
        return;
      }

      const documentMatch = request.url.match(/^\/api\/documents\/([^/]+)$/);
      if (request.method === "DELETE" && documentMatch) {
        const deleted = repository.deleteDocument(documentMatch[1]);
        if (!deleted) throw new Error("没有找到这份上传文档。");
        sendJson(response, 200, { deleted: true, ...deleted });
        return;
      }

      const questionMatch = request.url.match(/^\/api\/questions\/([^/]+)$/);
      if (request.method === "PUT" && questionMatch) {
        const updated = repository.updateQuestion(questionMatch[1], await readJson(request));
        if (!updated) throw new Error("没有找到这道题。");
        sendJson(response, 200, updated);
        return;
      }

      if (request.method === "DELETE" && questionMatch) {
        if (!repository.deleteQuestion(questionMatch[1])) throw new Error("没有找到这道题。");
        sendJson(response, 200, { deleted: true });
        return;
      }

      if (request.method === "POST" && request.url === "/api/import/preview") {
        const body = await readJson(request);
        const content = Buffer.from(body.contentBase64 || "", "base64");
        const text = await extractDocumentText({ name: body.name, content });
        const questions = parseQuestions(text);
        if (!questions.length) {
          throw new Error("没有识别到题目，请检查文档中的题目编号。");
        }
        sendJson(response, 200, { name: body.name, questions });
        return;
      }

      if (request.method === "POST" && request.url === "/api/import/confirm") {
        const body = await readJson(request);
        if (!body.name || !Array.isArray(body.questions) || !body.questions.length) {
          throw new Error("请先确认至少一道题目。");
        }
        const type = path.extname(body.name).slice(1).toLowerCase();
        sendJson(response, 201, repository.saveDocumentWithQuestions({
          name: body.name,
          type,
          questions: body.questions,
        }));
        return;
      }

      if (request.method === "POST" && request.url === "/api/quizzes") {
        const body = await readJson(request);
        const mode = body.mode === "exam" ? "exam" : "practice";
        let questions = repository.getQuestions();
        if (body.type) questions = questions.filter((question) => question.type === body.type);
        if (body.topic) questions = questions.filter((question) => question.topic === body.topic);
        questions = shuffle([...questions], random).slice(0, Math.max(1, Number(body.count) || 10));
        if (!questions.length) throw new Error("当前筛选条件下没有可用题目。");
        if (body.useVariants) questions = questions.map((question) => createVariant(question, random));
        const quiz = repository.createQuiz({
          mode,
          title: body.title || (mode === "exam" ? "模拟考试" : "速成练习"),
          questions,
        });
        sendJson(response, 201, {
          ...quiz,
          questions: quiz.questions.map(publicQuestion),
        });
        return;
      }

      const practiceMatch = request.url.match(/^\/api\/quizzes\/([^/]+)\/answer$/);
      if (request.method === "POST" && practiceMatch) {
        const quiz = repository.getQuiz(practiceMatch[1]);
        if (!quiz) throw new Error("没有找到这次测验。");
        const body = await readJson(request);
        const question = quiz.questions.find((item) => item.id === body.questionId);
        if (!question) throw new Error("没有找到这道题。");
        const grade = gradeAnswer(question, body.answer || []);
        repository.saveQuizAnswer({
          quizId: quiz.id,
          questionId: question.sourceQuestionId || question.id,
          answer: body.answer || [],
          isCorrect: grade.isCorrect,
          score: grade.score,
        });
        const answeredCount = repository.countQuizAnswers(quiz.id);
        const completed = answeredCount >= quiz.questions.length;
        if (completed) repository.completeQuiz(quiz.id);
        sendJson(response, 200, {
          ...grade,
          answer: question.answer,
          explanation: question.explanation,
          completed,
        });
        return;
      }

      const submitMatch = request.url.match(/^\/api\/quizzes\/([^/]+)\/submit$/);
      if (request.method === "POST" && submitMatch) {
        const quiz = repository.getQuiz(submitMatch[1]);
        if (!quiz) throw new Error("没有找到这次测验。");
        const body = await readJson(request);
        const submittedAnswers = new Map((body.answers || []).map((item) => [item.questionId, item.answer || []]));
        const results = quiz.questions.map((question) => {
          const answer = submittedAnswers.get(question.id) || [];
          const grade = gradeAnswer(question, answer);
          repository.saveQuizAnswer({
            quizId: quiz.id,
            questionId: question.sourceQuestionId || question.id,
            answer,
            isCorrect: grade.isCorrect,
            score: grade.score,
          });
          return {
            questionId: question.id,
            ...grade,
            answer: question.answer,
            explanation: question.explanation,
          };
        });
        const completedQuiz = repository.completeQuiz(quiz.id);
        sendJson(response, 200, {
          completed: true,
          correctCount: completedQuiz.correctCount,
          scorableCount: completedQuiz.scorableCount,
          results,
        });
        return;
      }

      if (request.method === "GET" && request.url === "/api/history") {
        sendJson(response, 200, repository.getHistory());
        return;
      }

      const resultsMatch = request.url.match(/^\/api\/quizzes\/([^/]+)\/results$/);
      if (request.method === "GET" && resultsMatch) {
        const details = repository.getQuizDetails(resultsMatch[1]);
        if (!details) throw new Error("没有找到这次测验。");
        sendJson(response, 200, details);
        return;
      }

      if (request.method === "GET" && request.url === "/api/settings") {
        sendJson(response, 200, repository.getSettings());
        return;
      }

      if (request.method === "POST" && request.url === "/api/settings") {
        sendJson(response, 200, repository.saveSettings(await readJson(request)));
        return;
      }

      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        serveStatic(request.url, response);
        return;
      }

      sendJson(response, 404, { error: "未找到请求的内容。" });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "请求处理失败。" });
    }
  });

  server.on("close", () => repository.close());
  return server;
}

function serveStatic(url, response) {
  const pathOnly = url.split("?")[0];
  const requestedPath = pathOnly === "/" ? "/index.html" : pathOnly;
  const allowedFiles = new Map([
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ]);
  const file = allowedFiles.get(requestedPath);
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("未找到页面。");
    return;
  }
  response.writeHead(200, {
    "Content-Type": file[1],
    "Cache-Control": "no-store, max-age=0",
  });
  response.end(fs.readFileSync(path.join(__dirname, "..", "public", file[0])));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`期末速测系统已启动：http://localhost:${port}`);
  });
}

module.exports = { createServer };
