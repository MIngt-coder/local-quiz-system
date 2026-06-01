const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const migrationDir = path.join(__dirname, "sql", "migrations");

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(database);
  return createRepository(database);
}

function applyMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    const version = path.basename(file, ".sql");
    const exists = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(version);

    if (!exists) {
      database.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
      database
        .prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)")
        .run(version);
    }
  }
}

function createRepository(database) {
  return {
    close() {
      database.close();
    },

    getDashboard() {
      const questionCount = database.prepare("SELECT COUNT(*) AS count FROM questions").get().count;
      const documentCount = database.prepare("SELECT COUNT(*) AS count FROM documents").get().count;
      const quizCount = database.prepare("SELECT COUNT(*) AS count FROM quizzes WHERE completed_at IS NOT NULL").get().count;
      const weakTopics = database.prepare(`
        SELECT q.topic, COUNT(*) AS wrong_count
        FROM quiz_answers a
        JOIN questions q ON q.id = a.question_id
        WHERE a.is_correct = 0
        GROUP BY q.topic
        ORDER BY wrong_count DESC, q.topic ASC
        LIMIT 5
      `).all().map((row) => ({ topic: row.topic, wrongCount: row.wrong_count }));
      const recentQuizzes = database.prepare(`
        SELECT id, mode, title, correct_count, scorable_count, completed_at
        FROM quizzes
        WHERE completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 5
      `).all().map(mapQuizSummary);

      return {
        questionCount,
        documentCount,
        quizCount,
        weakTopics,
        recentQuizzes,
      };
    },

    saveDocumentWithQuestions({ name, type, questions }) {
      const documentId = randomUUID();
      const insertDocument = database.prepare(`
        INSERT INTO documents (id, name, type, question_count)
        VALUES (?, ?, ?, ?)
      `);
      const insertQuestion = database.prepare(`
        INSERT INTO questions (
          id, document_id, position, type, prompt, options_json, answer_json,
          explanation, topic, needs_review
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      database.exec("BEGIN");
      try {
        insertDocument.run(documentId, name, type, questions.length);
        questions.forEach((question, index) => {
          insertQuestion.run(
            randomUUID(),
            documentId,
            index,
            question.type,
            question.prompt,
            JSON.stringify(question.options || []),
            JSON.stringify(question.answer || []),
            question.explanation || "",
            question.topic || "未分类",
            question.needsReview ? 1 : 0,
          );
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return { documentId, questionCount: questions.length };
    },

    getQuestions() {
      return database
        .prepare(`
          SELECT q.*, d.name AS document_name
          FROM questions q
          LEFT JOIN documents d ON d.id = q.document_id
          ORDER BY d.created_at DESC, q.position ASC
        `)
        .all()
        .map(mapQuestion);
    },

    getDocuments() {
      return database.prepare(`
        SELECT id, name, type, question_count, created_at
        FROM documents
        ORDER BY created_at DESC, rowid DESC
      `).all().map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        questionCount: row.question_count,
        createdAt: row.created_at,
      }));
    },

    deleteDocument(id) {
      const document = database.prepare(`
        SELECT id, question_count
        FROM documents
        WHERE id = ?
      `).get(id);
      if (!document) return null;
      database.prepare("DELETE FROM documents WHERE id = ?").run(id);
      return { questionCount: document.question_count };
    },

    updateQuestion(id, question) {
      database.prepare(`
        UPDATE questions
        SET type = ?, prompt = ?, options_json = ?, answer_json = ?,
            explanation = ?, topic = ?, needs_review = ?
        WHERE id = ?
      `).run(
        question.type,
        question.prompt,
        JSON.stringify(question.options || []),
        JSON.stringify(question.answer || []),
        question.explanation || "",
        question.topic || "未分类",
        question.needsReview ? 1 : 0,
        id,
      );
      return this.getQuestions().find((item) => item.id === id) || null;
    },

    deleteQuestion(id) {
      return database.prepare("DELETE FROM questions WHERE id = ?").run(id).changes > 0;
    },

    createQuiz({ mode, title, questions }) {
      const id = randomUUID();
      database.prepare(`
        INSERT INTO quizzes (id, mode, title, question_ids_json)
        VALUES (?, ?, ?, ?)
      `).run(id, mode, title, JSON.stringify(questions));
      return this.getQuiz(id);
    },

    getQuiz(id) {
      const row = database.prepare("SELECT * FROM quizzes WHERE id = ?").get(id);
      if (!row) return null;
      return {
        id: row.id,
        mode: row.mode,
        title: row.title,
        questions: JSON.parse(row.question_ids_json),
        correctCount: row.correct_count,
        scorableCount: row.scorable_count,
        completedAt: row.completed_at,
      };
    },

    saveQuizAnswer({ quizId, questionId, answer, isCorrect, score }) {
      database.prepare(`
        INSERT INTO quiz_answers (id, quiz_id, question_id, answer_json, is_correct, score)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), quizId, questionId, JSON.stringify(answer || []), isCorrect === null ? null : Number(isCorrect), Number(score) || 0);
    },

    countQuizAnswers(quizId) {
      return database.prepare(`
        SELECT COUNT(DISTINCT question_id) AS count
        FROM quiz_answers
        WHERE quiz_id = ?
      `).get(quizId).count;
    },

    completeQuiz(quizId) {
      const counts = database.prepare(`
        SELECT
          SUM(score) AS correct_count,
          SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END) AS scorable_count
        FROM quiz_answers
        WHERE quiz_id = ?
      `).get(quizId);
      database.prepare(`
        UPDATE quizzes
        SET correct_count = ?, scorable_count = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(counts.correct_count || 0, counts.scorable_count || 0, quizId);
      return this.getQuiz(quizId);
    },

    getHistory() {
      return database.prepare(`
        SELECT id, mode, title, correct_count, scorable_count, completed_at
        FROM quizzes
        WHERE completed_at IS NOT NULL
        ORDER BY completed_at DESC
      `).all().map(mapQuizSummary);
    },

    getQuizDetails(id) {
      const quiz = this.getQuiz(id);
      if (!quiz) return null;
      const answers = database.prepare(`
        SELECT question_id, answer_json, is_correct, score
        FROM quiz_answers
        WHERE quiz_id = ?
        ORDER BY created_at ASC, rowid ASC
      `).all(id);
      const answerByQuestionId = new Map(
        answers.map((answer) => [answer.question_id, answer]),
      );

      return {
        id: quiz.id,
        mode: quiz.mode,
        title: quiz.title,
        correctCount: quiz.correctCount,
        scorableCount: quiz.scorableCount,
        completedAt: quiz.completedAt,
        questions: quiz.questions.map((question) => {
          const saved = answerByQuestionId.get(question.sourceQuestionId || question.id);
          return {
            prompt: question.prompt,
            type: question.type,
            topic: question.topic,
            submittedAnswer: saved ? JSON.parse(saved.answer_json) : [],
            correctAnswer: question.answer,
            score: saved ? Number(saved.score) || 0 : 0,
            isCorrect: saved?.is_correct === null || saved?.is_correct === undefined
              ? null
              : Boolean(saved.is_correct),
            explanation: question.explanation,
          };
        }),
      };
    },

    getSettings() {
      const rows = database.prepare("SELECT key, value FROM settings").all();
      const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      return {
        apiBaseUrl: settings.apiBaseUrl || "",
        apiKeyConfigured: Boolean(settings.apiKey),
        model: settings.model || "",
        enabled: false,
      };
    },

    saveSettings(settings) {
      const statement = database.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      for (const key of ["apiBaseUrl", "model"]) {
        statement.run(key, settings[key] || "");
      }
      if (settings.apiKey) statement.run("apiKey", settings.apiKey);
      return this.getSettings();
    },

    generateId() {
      return randomUUID();
    },
  };
}

function mapQuizSummary(row) {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    correctCount: row.correct_count,
    scorableCount: row.scorable_count,
    completedAt: row.completed_at,
  };
}

function mapQuestion(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    documentName: row.document_name || "",
    type: row.type,
    prompt: row.prompt,
    options: JSON.parse(row.options_json),
    answer: JSON.parse(row.answer_json),
    explanation: row.explanation,
    topic: row.topic,
    needsReview: Boolean(row.needs_review),
    sourceQuestionId: row.source_question_id,
  };
}

module.exports = { openDatabase };
