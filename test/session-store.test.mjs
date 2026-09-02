import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { QuizSessionStore, QuizStateError } from "../server/session-store.mjs";

const items = [
  {
    id: "q1",
    difficulty: "medium",
    blocker: "Make the missing causal link visible",
    evidenceQuote: "opening hours",
    question: "虚构场景：社区延长体育馆开放时间。已知信息：晚间有更多居民到馆。你的任务：补出到馆人数增加与课程报名增加之间的一步推理。",
  },
  {
    id: "q2",
    difficulty: "hard",
    blocker: "Choose a relevant comparison",
    evidenceQuote: "two groups",
    question: "虚构场景：两类通勤者改用公交。已知信息：A组从20%升至35%，B组从50%升至55%。你的任务：写出最值得报告的一项比较。",
  },
];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "ielts-quiz-"));
  return new QuizSessionStore(join(directory, "sessions.sqlite"));
}

test("persists hint, evaluation, retry, next, completion and idempotency", () => {
  const store = setup();
  try {
    const created = store.create({ locale: "zh", taskType: "task2", items });
    assert.equal(created.state, "question");
    assert.equal(created.revision, 1);

    const hinted = store.commit({
      sessionId: created.sessionId,
      eventId: "event-hint-1",
      expectedRevision: 1,
      action: "request_hint",
      itemId: "q1",
      draftResponse: "草稿",
      support: { level: 1, kind: "direction", text: "先问：更多人到馆后，哪一种可观察行为会直接变化？" },
    });
    assert.equal(hinted.state, "hint");
    assert.equal(hinted.currentItem.draftResponse, "草稿");

    const partial = store.commit({
      sessionId: created.sessionId,
      eventId: "event-submit-1",
      expectedRevision: 2,
      action: "submit_answer",
      itemId: "q1",
      learnerResponse: "更多居民到馆，所以体育馆更受欢迎。",
      evaluation: {
        outcome: "partial",
        evidenceQuote: "更多居民到馆",
        observedMoves: [{ text: "居民到馆人数增加", status: "stops_early" }],
        missingLinks: ["没有说明更多到馆者如何转化为更多课程报名。"],
        nextAction: "retry",
      },
    });
    assert.equal(partial.state, "feedback");
    assert.equal(partial.currentItem.attemptCount, 1);

    assert.throws(() => store.commit({
      sessionId: created.sessionId,
      eventId: "event-next-too-early",
      expectedRevision: 3,
      action: "next",
      itemId: "q1",
    }), (error) => error instanceof QuizStateError && error.code === "INVALID_TRANSITION");

    const retry = store.commit({
      sessionId: created.sessionId,
      eventId: "event-retry-1",
      expectedRevision: 3,
      action: "retry",
      itemId: "q1",
    });
    assert.equal(retry.state, "hint");

    const resolved = store.commit({
      sessionId: created.sessionId,
      eventId: "event-submit-2",
      expectedRevision: 4,
      action: "submit_answer",
      itemId: "q1",
      learnerResponse: "更多居民到馆后，会有更多人看到并尝试课程，因此报名人数可能增加。",
      evaluation: {
        outcome: "resolved",
        evidenceQuote: "更多人看到并尝试课程",
        observedMoves: [{ text: "更多到馆者接触并尝试课程，从而增加报名", status: "reaches_target" }],
        missingLinks: [],
        nextAction: "next",
      },
    });
    assert.equal(resolved.currentItem.attemptCount, 2);

    const second = store.commit({
      sessionId: created.sessionId,
      eventId: "event-next-1",
      expectedRevision: 5,
      action: "next",
      itemId: "q1",
    });
    assert.equal(second.state, "question");
    assert.equal(second.currentItem.id, "q2");

    const replay = store.commit({
      sessionId: created.sessionId,
      eventId: "event-next-1",
      expectedRevision: 5,
      action: "next",
      itemId: "q1",
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.revision, second.revision);

    assert.throws(() => store.commit({
      sessionId: created.sessionId,
      eventId: "event-next-1",
      expectedRevision: 6,
      action: "request_hint",
      itemId: "q2",
      support: { level: 1, kind: "direction", text: "不同内容" },
    }), (error) => error instanceof QuizStateError && error.code === "EVENT_ID_REUSE");

    assert.throws(() => store.commit({
      sessionId: created.sessionId,
      eventId: "event-stale",
      expectedRevision: 5,
      action: "request_hint",
      itemId: "q2",
      support: { level: 1, kind: "direction", text: "提示" },
    }), (error) => error instanceof QuizStateError && error.code === "STALE_REVISION");
  } finally {
    store.close();
  }
});

test("rejects invented evidence and inconsistent next actions", () => {
  const store = setup();
  try {
    const created = store.create({ locale: "zh", taskType: "task2", items: [items[0]] });
    assert.throws(() => store.commit({
      sessionId: created.sessionId,
      eventId: "bad-evidence",
      expectedRevision: 1,
      action: "submit_answer",
      itemId: "q1",
      learnerResponse: "只有这一句。",
      evaluation: {
        outcome: "partial",
        evidenceQuote: "并不存在的原文",
        observedMoves: [],
        missingLinks: ["缺少推理步骤。"],
        nextAction: "retry",
      },
    }), (error) => error instanceof QuizStateError && error.code === "INVALID_EVALUATION");

    assert.throws(() => store.commit({
      sessionId: created.sessionId,
      eventId: "empty-resolved",
      expectedRevision: 1,
      action: "submit_answer",
      itemId: "q1",
      learnerResponse: "",
      evaluation: {
        outcome: "resolved",
        evidenceQuote: "",
        observedMoves: [],
        missingLinks: [],
        nextAction: "next",
      },
    }), (error) => error instanceof QuizStateError && error.code === "INVALID_EVALUATION");
  } finally {
    store.close();
  }
});

test("loads the latest session, deletes exact sessions, and restricts database permissions", () => {
  const store = setup();
  try {
    const first = store.create({ locale: "zh", taskType: "task2", items: [items[0]] });
    const second = store.create({ locale: "zh", taskType: "task1", items: [items[1]] });
    assert.equal(statSync(store.databasePath).mode & 0o777, 0o600);
    assert.equal(store.readLatest().sessionId, second.sessionId);
    assert.equal((store.db.prepare("SELECT COUNT(*) AS count FROM quiz_sessions").get()).count, 2);
    assert.deepEqual(store.delete(first.sessionId), { deleted: true, sessionId: first.sessionId });
    assert.throws(() => store.read(first.sessionId), (error) => error.code === "SESSION_NOT_FOUND");
  } finally {
    store.close();
  }
});
