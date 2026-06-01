# Local Quiz System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local quiz web application that imports DOCX, PDF, and TXT question documents, lets users review recognized questions, stores data locally, and supports practice, exam, and basic similar-question modes.

**Architecture:** Use a small Node.js HTTP service with SQLite storage and a static single-page browser interface. Keep document extraction, question parsing, local persistence, quiz generation, and HTTP routing in separate modules so each can be tested independently. Use Node's built-in test runner and the built-in SQLite module available in the installed Node.js version.

**Tech Stack:** Node.js, built-in `node:http`, built-in `node:sqlite`, vanilla HTML/CSS/JavaScript, `mammoth` for DOCX text extraction, `pdf-parse` for PDF text extraction.

---

## File Structure

- `package.json`: project scripts and document-reading dependencies.
- `server/index.js`: local HTTP service and route composition.
- `server/db.js`: SQLite initialization, migration execution, and queries.
- `server/parser.js`: question recognition rules.
- `server/documents.js`: TXT, DOCX, and PDF text extraction.
- `server/quiz.js`: quiz selection, answer checking, and basic similar-question variants.
- `server/sql/migrations/2026-06-01-001.sql`: initial database schema.
- `public/index.html`: browser application shell.
- `public/styles.css`: visual design.
- `public/app.js`: page navigation, API calls, forms, and quiz interaction.
- `tests/parser.test.js`: recognition behavior.
- `tests/quiz.test.js`: quiz generation and answer checking.
- `tests/api.test.js`: end-to-end service behavior with temporary storage.
- `tests/fixtures/sample-questions.txt`: representative import document.

### Task 1: Project Skeleton And Database

**Files:**
- Create: `package.json`
- Create: `server/db.js`
- Create: `server/sql/migrations/2026-06-01-001.sql`
- Test: `tests/api.test.js`

- [ ] Write a failing API test that starts the service with a temporary database and expects an empty dashboard.
- [ ] Run `npm test -- --test-name-pattern="dashboard starts empty"` and confirm failure because the service does not exist.
- [ ] Add the package definition, migration, database setup, and service bootstrap needed by the test.
- [ ] Run the focused test and confirm it passes.

### Task 2: Question Recognition

**Files:**
- Create: `server/parser.js`
- Test: `tests/parser.test.js`
- Create: `tests/fixtures/sample-questions.txt`

- [ ] Write failing tests for single choice, multiple choice, true/false, fill-in, short-answer, answer labels, explanation labels, knowledge-point labels, and uncertain recognition.
- [ ] Run `npm test -- tests/parser.test.js` and confirm the tests fail because the parser does not exist.
- [ ] Implement recognition rules for numbered questions, options, labels, type inference, and review flags.
- [ ] Run parser tests and confirm they pass.

### Task 3: Document Extraction And Import API

**Files:**
- Create: `server/documents.js`
- Modify: `server/index.js`
- Modify: `server/db.js`
- Test: `tests/api.test.js`

- [ ] Write failing tests that upload TXT content, preview recognized questions, confirm import, and retrieve the question bank.
- [ ] Run the import-focused tests and confirm failure because import routes do not exist.
- [ ] Add document extraction, preview, confirmation, and question-bank routes.
- [ ] Run the import-focused tests and confirm they pass.

### Task 4: Quiz Behavior

**Files:**
- Create: `server/quiz.js`
- Modify: `server/index.js`
- Modify: `server/db.js`
- Test: `tests/quiz.test.js`
- Test: `tests/api.test.js`

- [ ] Write failing tests for answer checking, option shuffling with preserved answers, quiz creation, practice submission, exam submission, and history storage.
- [ ] Run quiz-focused tests and confirm failure because quiz behavior does not exist.
- [ ] Implement quiz generation, basic variants, answer checking, history storage, and weak-topic summary.
- [ ] Run quiz-focused tests and confirm they pass.

### Task 5: Browser Interface

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Modify: `server/index.js`

- [ ] Add a failing static-page API test that expects the application title and navigation shell.
- [ ] Run the focused test and confirm failure because static pages do not exist.
- [ ] Build the upload, review, library, quiz setup, practice, exam, records, and model-settings views.
- [ ] Run the focused test and confirm it passes.

### Task 6: Representative Documents And Full Verification

**Files:**
- Create: `tests/fixtures/sample-questions.docx`
- Create: `tests/fixtures/sample-questions.pdf`
- Modify: `tests/api.test.js`
- Modify: `README.md`

- [ ] Add failing integration tests for DOCX and text-layer PDF extraction.
- [ ] Run extraction tests and confirm failure until document extraction support is complete.
- [ ] Add representative fixture generation or checked-in fixtures and document local start instructions.
- [ ] Run `npm test` and confirm all automated checks pass.
- [ ] Start the service, inspect the browser interface, upload representative files, run a practice quiz, run an exam, check records, save model settings, and confirm the interface behaves correctly.

### Task 7: Maintenance Finalization

**Files:**
- Modify: `AGENTS.md`
- Modify: `PROJECT_MAINTENANCE.md`

- [ ] Review whether new long-term rules or verified commands should be added to `AGENTS.md`.
- [ ] Remove task-only scratch files.
- [ ] Record the finished maintenance session in Chinese.
- [ ] Run the final automated checks again and inspect the maintenance files.

