const state = {
  dashboard: null,
  documents: [],
  questions: [],
  preview: [],
  previewName: "",
  quiz: null,
  quizIndex: 0,
  examAnswers: new Map(),
};

const typeLabels = {
  single: "单选题",
  multiple: "多选题",
  boolean: "判断题",
  fill: "填空题",
  short: "简答题",
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  document.querySelector("#file-input").addEventListener("change", previewFile);
  document.querySelector("#quiz-form").addEventListener("submit", startQuiz);
  document.querySelector("#settings-form").addEventListener("submit", saveSettings);
  document.querySelector("#quiz-setup-summary").addEventListener("click", expandQuizSetup);
  refreshAll();
});

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-go], [data-view]");
    if (!target) return;
    const view = target.dataset.go || target.dataset.view;
    if (view) showView(view);
  });
}

function showView(view) {
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelector(`#${view}-view`).classList.add("active");
  const titles = { dashboard: "今日复习面板", upload: "导入资料", library: "题库", quiz: "开始速测", records: "复盘记录", settings: "模型设置" };
  document.querySelector("#page-title").textContent = titles[view];
}

async function refreshAll() {
  await Promise.all([loadDashboard(), loadDocuments(), loadQuestions(), loadSettings()]);
  await loadRecords();
}

async function loadDocuments() {
  state.documents = await api("/api/documents");
  const list = document.querySelector("#document-list");
  list.innerHTML = state.documents.length ? `
    <div class="panel document-manager">
      <p class="eyebrow">BATCH MANAGE</p>
      <h3>按上传文档管理</h3>
      <p class="muted">整份删除适合重新识别文档，不会影响其他资料。</p>
      ${state.documents.map((document) => `
        <div class="document-row">
          <div><strong>${escapeHtml(document.name)}</strong><span class="muted">${document.questionCount} 道题 · ${escapeHtml(document.type.toUpperCase())}</span></div>
          <button class="danger-btn" data-delete-document="${document.id}">整批删除</button>
        </div>`).join("")}
    </div>` : "";
  list.querySelectorAll("[data-delete-document]").forEach((button) => button.addEventListener("click", deleteDocument));
}

async function deleteDocument(event) {
  const document = state.documents.find((item) => item.id === event.target.dataset.deleteDocument);
  if (!confirm(`确认整批删除“${document.name}”及其中 ${document.questionCount} 道题吗？`)) return;
  const result = await api(`/api/documents/${document.id}`, { method: "DELETE" });
  notice(`已整批删除 ${result.questionCount} 道题。`);
  await refreshAll();
}

async function api(route, options = {}) {
  const response = await fetch(route, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败。");
  return payload;
}

async function loadDashboard() {
  state.dashboard = await api("/api/dashboard");
  const dashboard = state.dashboard;
  document.querySelector("#dashboard-view").innerHTML = `
    <div class="stats-grid">
      ${stat("已入库题目", dashboard.questionCount, "BANK")}
      ${stat("资料文档", dashboard.documentCount, "FILES")}
      ${stat("完成测验", dashboard.quizCount, "SPRINTS")}
    </div>
    <div class="grid-two">
      <div class="panel"><p class="eyebrow">WEAK TOPICS</p><h3>优先补漏</h3>${renderWeakTopics(dashboard.weakTopics)}</div>
      <div class="panel"><p class="eyebrow">RECENT</p><h3>最近测验</h3>${renderHistory(dashboard.recentQuizzes)}</div>
    </div>`;
}

function stat(label, value, eyebrow) {
  return `<div class="stat-card"><p class="eyebrow">${eyebrow}</p><span>${label}</span><strong>${value}</strong></div>`;
}

async function previewFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    notice("正在识别文档，请稍候。");
    const buffer = await file.arrayBuffer();
    const contentBase64 = bytesToBase64(new Uint8Array(buffer));
    const preview = await api("/api/import/preview", {
      method: "POST",
      body: JSON.stringify({ name: file.name, contentBase64 }),
    });
    state.preview = preview.questions;
    state.previewName = file.name;
    renderReview();
    notice(`识别到 ${state.preview.length} 道题。请核对后再入库。`);
  } catch (error) {
    notice(error.message, true);
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function renderReview() {
  document.querySelector("#review-area").innerHTML = `
    <div class="section-head"><div><p class="eyebrow">REVIEW BEFORE SAVE</p><h2>核对识别结果</h2></div><button id="confirm-import" class="primary-btn">确认入库</button></div>
    <div class="review-grid">${state.preview.map(reviewCard).join("")}</div>`;
  document.querySelector("#confirm-import").addEventListener("click", confirmImport);
}

function reviewCard(question, index) {
  return `<article class="question-card review-card ${question.needsReview ? "needs-review" : ""}" data-review-index="${index}">
    <div class="question-top"><span class="badge ${question.needsReview ? "warn" : ""}">${question.needsReview ? "需要确认" : "识别完成"}</span><strong>第 ${index + 1} 题</strong></div>
    <div class="review-fields">
      <label>题型<select data-field="type">${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${value === question.type ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="wide-field">题干<textarea data-field="prompt">${escapeHtml(question.prompt)}</textarea></label>
      <label>考点<input data-field="topic" value="${escapeHtml(question.topic)}"></label>
      <label>答案<input data-field="answer" value="${escapeHtml(question.answer.join(";"))}"></label>
      <label>选项<textarea data-field="options" placeholder="每行一项，例如 A. 内容">${escapeHtml(question.options.map((item) => `${item.key}. ${item.text}`).join("\n"))}</textarea></label>
      <label>解析<textarea data-field="explanation">${escapeHtml(question.explanation)}</textarea></label>
    </div>
  </article>`;
}

async function confirmImport() {
  try {
    const questions = [...document.querySelectorAll("[data-review-index]")].map((card) => ({
      type: card.querySelector('[data-field="type"]').value,
      prompt: card.querySelector('[data-field="prompt"]').value.trim(),
      topic: card.querySelector('[data-field="topic"]').value.trim() || "未分类",
      answer: card.querySelector('[data-field="answer"]').value.split(";").map((item) => item.trim()).filter(Boolean),
      options: parseOptions(card.querySelector('[data-field="options"]').value),
      explanation: card.querySelector('[data-field="explanation"]').value.trim(),
      needsReview: false,
    }));
    const result = await api("/api/import/confirm", {
      method: "POST",
      body: JSON.stringify({ name: state.previewName, questions }),
    });
    state.preview = [];
    document.querySelector("#review-area").innerHTML = "";
    notice(`已保存 ${result.questionCount} 道题。`);
    await refreshAll();
    showView("library");
  } catch (error) {
    notice(error.message, true);
  }
}

function parseOptions(value) {
  return value.split("\n").map((line) => line.match(/^\s*([A-Ha-h])[.、．)]\s*(.+)$/)).filter(Boolean).map((match) => ({ key: match[1].toUpperCase(), text: match[2].trim() }));
}

async function loadQuestions() {
  state.questions = await api("/api/questions");
  const list = document.querySelector("#library-list");
  list.innerHTML = state.questions.length ? `<div class="list-stack">${state.questions.map(libraryRow).join("")}</div>` : empty("题库还是空的，先导入一份复习资料。");
  list.querySelectorAll("[data-delete-question]").forEach((button) => button.addEventListener("click", deleteQuestion));
  list.querySelectorAll("[data-edit-question]").forEach((button) => button.addEventListener("click", editQuestion));
  const topics = [...new Set(state.questions.map((question) => question.topic))];
  document.querySelector("#topic-filter").innerHTML = `<option value="">全部考点</option>${topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("")}`;
}

function libraryRow(question) {
  return `<article class="list-row">
    <div class="question-top"><span class="badge">${typeLabels[question.type]}</span><span class="muted">${escapeHtml(question.topic)} · ${escapeHtml(question.documentName)}</span></div>
    <strong>${escapeHtml(question.prompt)}</strong>
    <p class="muted">答案：${escapeHtml(question.answer.join(" / "))}</p>
    <div class="actions"><button class="secondary-btn" data-edit-question="${question.id}">快速编辑</button><button class="danger-btn" data-delete-question="${question.id}">删除</button></div>
  </article>`;
}

async function deleteQuestion(event) {
  if (!confirm("确认删除这道题吗？")) return;
  await api(`/api/questions/${event.target.dataset.deleteQuestion}`, { method: "DELETE" });
  notice("题目已删除。");
  await refreshAll();
}

async function editQuestion(event) {
  const question = state.questions.find((item) => item.id === event.target.dataset.editQuestion);
  const updatedPrompt = window.prompt("修改题干", question.prompt);
  if (!updatedPrompt) return;
  const topic = promptWindow("修改考点", question.topic);
  if (topic === null) return;
  await api(`/api/questions/${question.id}`, { method: "PUT", body: JSON.stringify({ ...question, prompt: updatedPrompt, topic }) });
  notice("题目已更新。");
  await refreshAll();
}

function promptWindow(label, value) {
  return window.prompt(label, value);
}

async function startQuiz(event) {
  event.preventDefault();
  try {
    const form = new FormData(event.target);
    state.quiz = await api("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({
        mode: form.get("mode"),
        count: Number(form.get("count")),
        type: form.get("type"),
        topic: form.get("topic"),
        useVariants: form.get("useVariants") === "on",
      }),
    });
    state.quizIndex = 0;
    state.examAnswers = new Map();
    collapseQuizSetup();
    renderQuizQuestion();
    document.querySelector("#quiz-stage").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    notice(error.message, true);
  }
}

function collapseQuizSetup() {
  const form = document.querySelector("#quiz-form");
  const data = new FormData(form);
  const mode = data.get("mode") === "exam" ? "模拟考试" : "练习模式";
  const type = typeLabels[data.get("type")] || "全部题型";
  const topic = data.get("topic") || "全部考点";
  document.querySelector("#quiz-setup").classList.add("hidden");
  const summary = document.querySelector("#quiz-setup-summary");
  summary.innerHTML = `<span><strong>${mode}</strong> · ${data.get("count")} 题 · ${type} · ${escapeHtml(topic)}</span><button class="secondary-btn" type="button">调整设置</button>`;
  summary.classList.remove("hidden");
}

function expandQuizSetup() {
  document.querySelector("#quiz-setup").classList.remove("hidden");
  document.querySelector("#quiz-setup-summary").classList.add("hidden");
}

function renderQuizQuestion() {
  const question = state.quiz.questions[state.quizIndex];
  document.querySelector("#quiz-stage").innerHTML = `
    <article class="question-card">
      <div class="question-top"><span class="badge">${state.quiz.mode === "exam" ? "模拟考试" : "练习模式"} · ${state.quizIndex + 1}/${state.quiz.questions.length}</span><span class="muted">${escapeHtml(question.topic)}</span></div>
      <h3>${escapeHtml(question.prompt)}</h3>
      <form id="answer-form">
        ${answerFields(question)}
        <button class="primary-btn" type="submit">${state.quiz.mode === "exam" && state.quizIndex === state.quiz.questions.length - 1 ? "交卷" : "提交答案"}</button>
      </form>
      <div id="answer-feedback"></div>
    </article>`;
  document.querySelector("#answer-form").addEventListener("submit", submitQuizAnswer);
}

function answerFields(question) {
  if (question.options.length) {
    const inputType = question.type === "multiple" ? "checkbox" : "radio";
    return `<div class="choice-list">${question.options.map((option) => `<label class="choice-line"><input type="${inputType}" name="answer" value="${option.key}"><strong>${option.key}</strong> ${escapeHtml(option.text)}</label>`).join("")}</div>`;
  }
  if (question.type === "boolean") {
    return `<div class="choice-list"><label class="choice-line"><input type="radio" name="answer" value="正确">正确</label><label class="choice-line"><input type="radio" name="answer" value="错误">错误</label></div>`;
  }
  return `<label class="choice-list">你的答案<textarea name="text-answer" placeholder="在这里作答"></textarea></label>`;
}

async function submitQuizAnswer(event) {
  event.preventDefault();
  const question = state.quiz.questions[state.quizIndex];
  const answer = collectAnswer(event.target);
  if (state.quiz.mode === "exam") {
    state.examAnswers.set(question.id, answer);
    if (state.quizIndex < state.quiz.questions.length - 1) {
      state.quizIndex += 1;
      renderQuizQuestion();
      return;
    }
    const result = await api(`/api/quizzes/${state.quiz.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers: [...state.examAnswers].map(([questionId, value]) => ({ questionId, answer: value })) }),
    });
    renderCompletion(result);
    await refreshAll();
    return;
  }
  const result = await api(`/api/quizzes/${state.quiz.id}/answer`, {
    method: "POST",
    body: JSON.stringify({ questionId: question.id, answer }),
  });
  const feedback = document.querySelector("#answer-feedback");
  feedback.innerHTML = `${renderAnswerFeedback(result)}<div class="actions" style="margin-top:14px"><button id="next-question" class="secondary-btn">${result.completed ? "查看记录" : "下一题"}</button></div>`;
  document.querySelector("#next-question").addEventListener("click", async () => {
    if (result.completed) {
      await refreshAll();
      showView("records");
    } else {
      state.quizIndex += 1;
      renderQuizQuestion();
    }
  });
}

function collectAnswer(form) {
  const text = form.elements["text-answer"];
  if (text) return [text.value];
  return [...form.querySelectorAll('[name="answer"]:checked')].map((item) => item.value);
}

function renderCompletion(result) {
  document.querySelector("#quiz-stage").innerHTML = `<div class="panel"><p class="eyebrow">COMPLETED</p><h2>本轮完成</h2><p>本轮得分 <strong>${formatScore(result.correctCount)}</strong> / ${result.scorableCount}</p><button class="secondary-btn" data-go="records">查看复盘记录</button></div>`;
}

async function loadRecords() {
  const history = await api("/api/history");
  const records = document.querySelector("#records-list");
  records.innerHTML = `<div class="grid-two"><div class="panel"><p class="eyebrow">WEAK TOPICS</p><h3>薄弱考点</h3>${renderWeakTopics((state.dashboard || {}).weakTopics || [], true)}</div><div class="panel"><p class="eyebrow">HISTORY</p><h3>历史测验</h3>${renderHistory(history, true)}</div></div><div id="quiz-details"></div>`;
  records.querySelectorAll("[data-practice-topic]").forEach((button) => button.addEventListener("click", startWeakTopicPractice));
  records.querySelectorAll("[data-history-id]").forEach((button) => button.addEventListener("click", showQuizDetails));
}

function renderWeakTopics(items, interactive = false) {
  return items.length ? items.map((item) => interactive
    ? `<div class="topic-action"><span>${escapeHtml(item.topic)} <span class="muted">错题 ${item.wrongCount} 次</span></span><button class="secondary-btn" data-practice-topic="${escapeHtml(item.topic)}">强化练习</button></div>`
    : `<p>${escapeHtml(item.topic)} <span class="muted">错题 ${item.wrongCount} 次</span></p>`).join("") : empty("完成测验后，这里会显示需要优先补漏的考点。");
}

function renderHistory(items, interactive = false) {
  return items.length ? items.map((item) => interactive
    ? `<button class="record-link" data-history-id="${item.id}"><span>${escapeHtml(item.title)}</span><span class="muted">得分 ${formatScore(item.correctCount)}/${item.scorableCount} · ${escapeHtml(item.mode === "exam" ? "模拟考试" : "练习")} · 查看详情</span></button>`
    : `<p>${escapeHtml(item.title)} <span class="muted">得分 ${formatScore(item.correctCount)}/${item.scorableCount} · ${escapeHtml(item.mode === "exam" ? "模拟考试" : "练习")}</span></p>`).join("") : empty("还没有完成的测验。");
}

function startWeakTopicPractice(event) {
  const form = document.querySelector("#quiz-form");
  showView("quiz");
  expandQuizSetup();
  form.elements.mode.value = "practice";
  form.elements.topic.value = event.target.dataset.practiceTopic;
  form.elements.useVariants.checked = true;
  form.requestSubmit();
}

async function showQuizDetails(event) {
  const details = await api(`/api/quizzes/${event.currentTarget.dataset.historyId}/results`);
  document.querySelector("#quiz-details").innerHTML = `
    <div class="panel quiz-details">
      <p class="eyebrow">QUIZ DETAILS</p>
      <h3>${escapeHtml(details.title)} · 得分 ${formatScore(details.correctCount)}/${details.scorableCount}</h3>
      ${details.questions.map((question, index) => `
        <article class="list-row">
          <strong>${index + 1}. ${escapeHtml(question.prompt)}</strong>
          <p class="muted">你的答案：${escapeHtml(question.submittedAnswer.join(" / ") || "未作答")}</p>
          <p class="muted">参考答案：${escapeHtml(question.correctAnswer.join(" / "))}</p>
          <span class="badge ${question.isCorrect === false ? "warn" : ""}">${question.isCorrect ? `得分 ${formatScore(question.score)}` : "需要再练"}</span>
        </article>`).join("")}
    </div>`;
  document.querySelector("#quiz-details").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadSettings() {
  const settings = await api("/api/settings");
  const form = document.querySelector("#settings-form");
  form.elements.apiBaseUrl.value = settings.apiBaseUrl;
  form.elements.model.value = settings.model;
  form.elements.apiKey.placeholder = settings.apiKeyConfigured ? "密钥已保存，留空表示不修改" : "输入密钥";
}

async function saveSettings(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  await api("/api/settings", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
  event.target.elements.apiKey.value = "";
  notice("模型设置已保存。首版不会联网调用。");
  await loadSettings();
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function renderAnswerFeedback(result) {
  const keywordLines = [
    result.matchedKeywords?.length ? `命中关键词：${escapeHtml(result.matchedKeywords.join("、"))}` : "",
    result.missingKeywords?.length ? `还差关键词：${escapeHtml(result.missingKeywords.join("、"))}` : "",
  ].filter(Boolean).join("<br>");
  return `<div class="answer-box ${result.isCorrect ? "" : "wrong"}">
    <strong>${result.isCorrect ? "已拿到本题主要分数" : "需要再看一眼"} · 得分 ${formatScore(result.score)} / ${result.maxScore || 1}</strong><br>
    参考答案：${escapeHtml(result.answer.join(" / "))}<br>
    ${keywordLines ? `${keywordLines}<br>` : ""}${escapeHtml(result.explanation || "暂无解析")}
  </div>`;
}

function formatScore(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function notice(message, isError = false) {
  const box = document.querySelector("#notice");
  box.textContent = message;
  box.style.borderLeftColor = isError ? "var(--coral)" : "var(--forest)";
  box.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}
