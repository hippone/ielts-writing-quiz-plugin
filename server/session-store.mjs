import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const STATES = new Set(["question", "hint", "feedback", "complete"]);
const OUTCOMES = new Set(["resolved", "partial", "not_resolved"]);
const MOVE_STATUSES = new Set([
  "reaches_target",
  "stops_early",
  "adjacent_outcome",
  "unsupported",
  "off_target",
]);
const SUPPORT_KINDS = new Set(["direction", "thinking_frame", "parallel_example"]);

export class QuizStateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "QuizStateError";
    this.code = code;
    this.details = details;
  }
}

function requireString(value, field, { min = 1, max = 6000 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new QuizStateError("INVALID_INPUT", `${field} must be a string between ${min} and ${max} characters`);
  }
  return value;
}

function optionalString(value, field, max = 6000) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) {
    throw new QuizStateError("INVALID_INPUT", `${field} must be a string no longer than ${max} characters`);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventFingerprint(input) {
  const payload = { ...input };
  delete payload.eventId;
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) {
    throw new QuizStateError("INVALID_INPUT", "items must contain between 1 and 10 questions");
  }
  const ids = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new QuizStateError("INVALID_INPUT", `items[${index}] must be an object`);
    }
    const id = requireString(item.id, `items[${index}].id`, { max: 120 });
    if (ids.has(id)) throw new QuizStateError("INVALID_INPUT", `duplicate item id: ${id}`);
    ids.add(id);
    if (!["easy", "medium", "hard"].includes(item.difficulty)) {
      throw new QuizStateError("INVALID_INPUT", `items[${index}].difficulty is invalid`);
    }
    return {
      id,
      difficulty: item.difficulty,
      blocker: requireString(item.blocker, `items[${index}].blocker`, { max: 1000 }),
      evidenceQuote: requireString(item.evidenceQuote, `items[${index}].evidenceQuote`, { max: 2000 }),
      question: requireString(item.question, `items[${index}].question`, { max: 4000 }),
      assistLevel: 0,
      support: null,
      draftResponse: "",
      feedback: null,
      attempts: [],
    };
  });
}

function validateEvaluation(evaluation, learnerResponse) {
  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    throw new QuizStateError("INVALID_EVALUATION", "evaluation is required for submit_answer");
  }
  if (!OUTCOMES.has(evaluation.outcome)) {
    throw new QuizStateError("INVALID_EVALUATION", "evaluation.outcome is invalid");
  }
  const evidenceQuote = optionalString(evaluation.evidenceQuote, "evaluation.evidenceQuote", 2000);
  if (evidenceQuote && !learnerResponse.includes(evidenceQuote)) {
    throw new QuizStateError("INVALID_EVALUATION", "evaluation.evidenceQuote must be an exact substring of learnerResponse");
  }
  if (!Array.isArray(evaluation.observedMoves) || evaluation.observedMoves.length > 5) {
    throw new QuizStateError("INVALID_EVALUATION", "evaluation.observedMoves must be an array of at most 5 items");
  }
  const observedMoves = evaluation.observedMoves.map((move, index) => {
    if (!move || typeof move !== "object" || Array.isArray(move)) {
      throw new QuizStateError("INVALID_EVALUATION", `evaluation.observedMoves[${index}] must be an object`);
    }
    if (!MOVE_STATUSES.has(move.status)) {
      throw new QuizStateError("INVALID_EVALUATION", `evaluation.observedMoves[${index}].status is invalid`);
    }
    return {
      text: requireString(move.text, `evaluation.observedMoves[${index}].text`, { max: 1200 }),
      status: move.status,
    };
  });
  if (!Array.isArray(evaluation.missingLinks) || evaluation.missingLinks.length > 5) {
    throw new QuizStateError("INVALID_EVALUATION", "evaluation.missingLinks must be an array of at most 5 items");
  }
  const missingLinks = evaluation.missingLinks.map((link, index) =>
    requireString(link, `evaluation.missingLinks[${index}]`, { max: 1200 }),
  );
  const expectedNextAction = evaluation.outcome === "resolved" ? "next" : "retry";
  if (evaluation.nextAction !== expectedNextAction) {
    throw new QuizStateError("INVALID_EVALUATION", `evaluation.nextAction must be ${expectedNextAction}`);
  }
  if (evaluation.outcome !== "resolved" && missingLinks.length === 0) {
    throw new QuizStateError("INVALID_EVALUATION", "an unresolved evaluation requires at least one missing link");
  }
  if (!learnerResponse.trim() && evaluation.outcome !== "not_resolved") {
    throw new QuizStateError("INVALID_EVALUATION", "an empty response must be not_resolved");
  }
  if (learnerResponse.trim() && !evidenceQuote) {
    throw new QuizStateError("INVALID_EVALUATION", "a non-empty response requires an exact evidence quote");
  }
  if (evaluation.outcome === "resolved") {
    if (!evidenceQuote || observedMoves.length === 0 || !observedMoves.some((move) => move.status === "reaches_target")) {
      throw new QuizStateError("INVALID_EVALUATION", "a resolved evaluation requires exact evidence and a move that reaches the target");
    }
    if (missingLinks.length !== 0) {
      throw new QuizStateError("INVALID_EVALUATION", "a resolved evaluation cannot contain missing links");
    }
  }
  return {
    outcome: evaluation.outcome,
    evidenceQuote,
    observedMoves,
    missingLinks,
    nextAction: expectedNextAction,
  };
}

function validateSupport(support, expectedLevel) {
  if (!support || typeof support !== "object" || Array.isArray(support)) {
    throw new QuizStateError("INVALID_SUPPORT", "support is required for request_hint");
  }
  if (support.level !== expectedLevel || !Number.isInteger(support.level)) {
    throw new QuizStateError("INVALID_SUPPORT", `support.level must be ${expectedLevel}`);
  }
  if (!SUPPORT_KINDS.has(support.kind)) {
    throw new QuizStateError("INVALID_SUPPORT", "support.kind is invalid");
  }
  return {
    level: support.level,
    kind: support.kind,
    text: requireString(support.text, "support.text", { max: 1200 }),
  };
}

function currentItem(session) {
  return session.items[session.currentIndex] ?? null;
}

export function projectSession(session, extra = {}) {
  const item = currentItem(session);
  return {
    schemaVersion: session.schemaVersion,
    sessionId: session.sessionId,
    revision: session.revision,
    state: session.state,
    locale: session.locale,
    taskType: session.taskType,
    progress: {
      current: session.state === "complete" ? session.items.length : session.currentIndex + 1,
      total: session.items.length,
    },
    currentItem: item
      ? {
          id: item.id,
          difficulty: item.difficulty,
          blocker: item.blocker,
          evidenceQuote: item.evidenceQuote,
          question: item.question,
          assistLevel: item.assistLevel,
          support: item.support,
          draftResponse: item.draftResponse,
          feedback: item.feedback,
          attemptCount: item.attempts.length,
        }
      : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...extra,
  };
}

export class QuizSessionStore {
  constructor(databasePath = process.env.IELTS_QUIZ_DB_PATH || join(homedir(), ".codex", "data", "ielts-writing-quiz", "sessions.sqlite")) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(databasePath), 0o700);
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        session_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  close() {
    this.db.close();
  }

  create({ locale, taskType, items }) {
    if (!["zh", "en"].includes(locale)) throw new QuizStateError("INVALID_INPUT", "locale must be zh or en");
    if (!["task1", "task2"].includes(taskType)) throw new QuizStateError("INVALID_INPUT", "taskType must be task1 or task2");
    const now = new Date().toISOString();
    const session = {
      schemaVersion: "quiz_session.v1",
      sessionId: `qs_${randomUUID()}`,
      revision: 1,
      state: "question",
      locale,
      taskType,
      currentIndex: 0,
      items: normalizeItems(items),
      processedEvents: [],
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(
      "INSERT INTO quiz_sessions (session_id, revision, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(session.sessionId, session.revision, JSON.stringify(session), now, now);
    return projectSession(session);
  }

  get(sessionId) {
    requireString(sessionId, "sessionId", { max: 160 });
    const row = this.db.prepare("SELECT payload FROM quiz_sessions WHERE session_id = ?").get(sessionId);
    if (!row) throw new QuizStateError("SESSION_NOT_FOUND", "quiz session was not found", { sessionId });
    const session = JSON.parse(row.payload);
    if (!STATES.has(session.state)) throw new QuizStateError("SESSION_CORRUPT", "quiz session has an invalid state");
    return session;
  }

  read(sessionId) {
    return projectSession(this.get(sessionId));
  }

  readLatest() {
    const row = this.db.prepare("SELECT payload FROM quiz_sessions ORDER BY updated_at DESC, rowid DESC LIMIT 1").get();
    if (!row) throw new QuizStateError("SESSION_NOT_FOUND", "no saved quiz session was found");
    return projectSession(JSON.parse(row.payload));
  }

  delete(sessionId) {
    requireString(sessionId, "sessionId", { max: 160 });
    const result = this.db.prepare("DELETE FROM quiz_sessions WHERE session_id = ?").run(sessionId);
    if (result.changes !== 1) throw new QuizStateError("SESSION_NOT_FOUND", "quiz session was not found", { sessionId });
    return { deleted: true, sessionId };
  }

  commit(input) {
    const sessionId = requireString(input.sessionId, "sessionId", { max: 160 });
    const eventId = requireString(input.eventId, "eventId", { max: 160 });
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new QuizStateError("INVALID_INPUT", "expectedRevision must be a positive integer");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const session = this.get(sessionId);
      const fingerprint = eventFingerprint(input);
      const processedEvents = Array.isArray(session.processedEvents) ? session.processedEvents : [];
      const priorEvent = processedEvents.find((entry) => entry.eventId === eventId);
      if (priorEvent) {
        if (priorEvent.fingerprint !== fingerprint) {
          throw new QuizStateError("EVENT_ID_REUSE", "eventId was already used for a different transition");
        }
        this.db.exec("COMMIT");
        return { ...clone(priorEvent.result), idempotentReplay: true };
      }
      if (Array.isArray(session.processedEventIds) && session.processedEventIds.includes(eventId)) {
        throw new QuizStateError("EVENT_ID_REUSE", "eventId was used by an older plugin version and cannot be replayed safely");
      }
      if (session.revision !== input.expectedRevision) {
        throw new QuizStateError("STALE_REVISION", "the card is stale; load the latest session before continuing", {
          expectedRevision: input.expectedRevision,
          actualRevision: session.revision,
        });
      }
      this.applyAction(session, input);
      session.revision += 1;
      session.updatedAt = new Date().toISOString();
      const projected = projectSession(session);
      processedEvents.push({ eventId, fingerprint, result: projected });
      session.processedEvents = processedEvents.slice(-100);
      const result = this.db.prepare(
        "UPDATE quiz_sessions SET revision = ?, payload = ?, updated_at = ? WHERE session_id = ? AND revision = ?",
      ).run(session.revision, JSON.stringify(session), session.updatedAt, session.sessionId, input.expectedRevision);
      if (result.changes !== 1) throw new QuizStateError("STALE_REVISION", "the session changed before the action was saved");
      this.db.exec("COMMIT");
      return projected;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  applyAction(session, input) {
    const item = currentItem(session);
    if (!item || session.state === "complete") {
      throw new QuizStateError("INVALID_TRANSITION", "the quiz is already complete");
    }
    if (input.itemId !== item.id) {
      throw new QuizStateError("ITEM_MISMATCH", "itemId does not match the current question", {
        expectedItemId: item.id,
      });
    }
    switch (input.action) {
      case "request_hint": {
        if (!["question", "hint"].includes(session.state)) {
          throw new QuizStateError("INVALID_TRANSITION", "a hint can only be requested while answering");
        }
        if (item.assistLevel >= 3) throw new QuizStateError("SUPPORT_EXHAUSTED", "all three support levels have already been used");
        const support = validateSupport(input.support, item.assistLevel + 1);
        item.assistLevel = support.level;
        item.support = support;
        item.draftResponse = optionalString(input.draftResponse, "draftResponse");
        session.state = "hint";
        break;
      }
      case "submit_answer": {
        if (!["question", "hint"].includes(session.state)) {
          throw new QuizStateError("INVALID_TRANSITION", "an answer can only be submitted while answering");
        }
        const learnerResponse = optionalString(input.learnerResponse, "learnerResponse");
        const evaluation = validateEvaluation(input.evaluation, learnerResponse);
        item.draftResponse = learnerResponse;
        item.feedback = evaluation;
        item.attempts.push({
          learnerResponse,
          evaluation: clone(evaluation),
          assistLevel: item.assistLevel,
          submittedAt: new Date().toISOString(),
        });
        session.state = "feedback";
        break;
      }
      case "retry": {
        if (session.state !== "feedback" || !item.feedback || item.feedback.outcome === "resolved") {
          throw new QuizStateError("INVALID_TRANSITION", "retry is available only after a partial or unresolved answer");
        }
        session.state = item.support ? "hint" : "question";
        item.feedback = null;
        break;
      }
      case "next": {
        if (session.state !== "feedback" || item.feedback?.outcome !== "resolved") {
          throw new QuizStateError("INVALID_TRANSITION", "next is available only after the target move is resolved");
        }
        if (session.currentIndex === session.items.length - 1) {
          session.state = "complete";
        } else {
          session.currentIndex += 1;
          session.state = "question";
        }
        break;
      }
      default:
        throw new QuizStateError("INVALID_INPUT", "action must be request_hint, submit_answer, retry, or next");
    }
  }
}
