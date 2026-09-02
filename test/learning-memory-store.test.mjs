import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LearningMemoryError, LearningMemoryStore } from "../server/learning-memory-store.mjs";

function setup() {
  return new LearningMemoryStore(mkdtempSync(join(tmpdir(), "ielts-learning-memory-")));
}

function startInput(overrides = {}) {
  return {
    expectedRevision: 0,
    eventId: "start-1",
    methodId: "argument-ladder",
    taskType: "task2",
    targetWeakness: "论证解释链断裂",
    reason: "作文有观点，但原因到结果之间缺少中间机制",
    baselineEvidence: "This policy is useful, so society will improve.",
    ...overrides,
  };
}

test("stores one human-readable line and refreshes concise learning memory", () => {
  const store = setup();
  const started = store.start(startInput());

  assert.equal(started.revision, 1);
  assert.equal(started.activeMethod.id, "argument-ladder");
  assert.deepEqual(started.progress, { completedSessions: 0, plannedSessions: 3 });
  assert.equal(started.skillStatus, "repairing");

  const memory = readFileSync(store.memoryPath, "utf8");
  assert.match(memory, /当前主弱点：论证解释链断裂/u);
  assert.match(memory, /当前方法：【论证追问链】/u);
  assert.match(memory, /开始【论证追问链】/u);
  assert.equal(memory.split("\n").filter((line) => /^- \d{4}-/u.test(line)).length, 1);
  assert.equal(statSync(store.memoryPath).mode & 0o777, 0o600);
});

test("rejects stale windows and replays an identical event idempotently", () => {
  const store = setup();
  store.start(startInput());

  assert.throws(() => store.recordCheckpoint({
    expectedRevision: 0,
    eventId: "checkpoint-stale",
    evidenceKind: "method_session",
    sessionNumber: 1,
    outcome: "partially_met",
    assistanceLevel: "L1",
    timed: false,
    evidence: "补出了结果，但仍缺少中间机制",
    nextAction: "继续第 2 次训练",
  }), (error) => error instanceof LearningMemoryError && error.code === "STALE_REVISION");

  const replay = store.start(startInput());
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.revision, 1);

  assert.throws(() => store.start(startInput({ reason: "不同内容" })),
    (error) => error instanceof LearningMemoryError && error.code === "EVENT_ID_REUSE");
});

test("records sessions in order and keeps Quiz evidence separate from mastery", () => {
  const store = setup();
  store.start(startInput());

  assert.throws(() => store.recordCheckpoint({
    expectedRevision: 1,
    eventId: "skip-session",
    evidenceKind: "method_session",
    sessionNumber: 2,
    outcome: "met",
    assistanceLevel: "L0",
    timed: false,
    evidence: "完成了解释链",
    nextAction: "继续",
  }), (error) => error instanceof LearningMemoryError && error.code === "SESSION_ORDER_CONFLICT");

  const session = store.recordCheckpoint({
    expectedRevision: 1,
    eventId: "session-1",
    evidenceKind: "method_session",
    sessionNumber: 1,
    outcome: "partially_met",
    assistanceLevel: "L1",
    timed: false,
    evidence: "写出了原因和结果，但机制仍需提示",
    nextAction: "在新话题继续第 2 次训练",
  });
  assert.deepEqual(session.progress, { completedSessions: 1, plannedSessions: 3 });

  const quiz = store.recordCheckpoint({
    expectedRevision: 2,
    eventId: "quiz-1",
    evidenceKind: "quiz",
    outcome: "met",
    assistanceLevel: "L0",
    timed: false,
    evidence: "独立补全了一步因果关系",
    nextAction: "回到作文完成重写",
  });
  assert.equal(quiz.skillStatus, "repairing");
});

test("guards provisional and stable status with independent transfer evidence", () => {
  const store = setup();
  store.start(startInput());

  assert.throws(() => store.recordCheckpoint({
    expectedRevision: 1,
    eventId: "assisted-transfer",
    evidenceKind: "different_topic_transfer",
    outcome: "met",
    assistanceLevel: "L1",
    timed: true,
    evidence: "在提示下完成",
    nextAction: "重试",
  }), (error) => error instanceof LearningMemoryError && error.code === "TRANSFER_EVIDENCE_INSUFFICIENT");

  const provisional = store.recordCheckpoint({
    expectedRevision: 1,
    eventId: "transfer-1",
    evidenceKind: "different_topic_transfer",
    outcome: "met",
    assistanceLevel: "L0",
    timed: true,
    evidence: "在陌生话题中独立写出原因、机制和结果",
    nextAction: "等待延迟复测",
  });
  assert.equal(provisional.skillStatus, "provisional");

  const stable = store.recordCheckpoint({
    expectedRevision: 2,
    eventId: "delayed-1",
    evidenceKind: "delayed_transfer",
    outcome: "met",
    assistanceLevel: "L0",
    timed: true,
    evidence: "一周后在另一个话题再次独立完成",
    nextAction: "选择下一个主弱点",
  });
  assert.equal(stable.skillStatus, "stable");
  assert.match(stable.unproven, /不等同于雅思分数提升证明/u);
});

test("requires confirmed compatible switching and preserves the old method in the log", () => {
  const store = setup();
  store.start(startInput());

  assert.throws(() => store.switchMethod({
    expectedRevision: 1,
    eventId: "switch-unconfirmed",
    toMethodId: "feedback-rewrite-transfer",
    reason: "三次训练后仍无法迁移",
    learnerConfirmed: false,
  }), (error) => error instanceof LearningMemoryError && error.code === "SWITCH_CONFIRMATION_REQUIRED");

  assert.throws(() => store.switchMethod({
    expectedRevision: 1,
    eventId: "switch-incompatible",
    toMethodId: "task1-feature-selection",
    reason: "错误选择",
    learnerConfirmed: true,
  }), (error) => error instanceof LearningMemoryError && error.code === "METHOD_TASK_INCOMPATIBLE");

  const switched = store.switchMethod({
    expectedRevision: 1,
    eventId: "switch-1",
    toMethodId: "feedback-rewrite-transfer",
    reason: "三次训练后相同问题仍在陌生题出现",
    learnerConfirmed: true,
  });
  assert.equal(switched.activeMethod.id, "feedback-rewrite-transfer");
  assert.deepEqual(switched.progress, { completedSessions: 0, plannedSessions: 3 });
  assert.match(readFileSync(store.memoryPath, "utf8"), /旧方法记录完整保留/u);
});

test("closes a method without promoting skill status", () => {
  const store = setup();
  store.start(startInput());
  const closed = store.closeMethod({
    expectedRevision: 1,
    eventId: "close-1",
    conclusion: "完成试跑，但迁移证据不足",
    nextAction: "提交一篇新作文后重新选择",
  });

  assert.equal(closed.activeMethod, null);
  assert.equal(closed.skillStatus, "repairing");
  assert.match(readFileSync(store.memoryPath, "utf8"), /不代表技能掌握或雅思分数提升/u);
});

test("filters the fixed catalog by task compatibility", () => {
  const store = setup();
  assert.equal(store.listMethods().length, 9);
  assert.ok(store.listMethods("task1").every((method) => method.tasks.includes("task1")));
  assert.ok(!store.listMethods("task1").some((method) => method.id === "argument-ladder"));
});

test("rejects event identifiers that could corrupt hidden Markdown guards", () => {
  const store = setup();
  assert.throws(() => store.start(startInput({ eventId: "bad\" -->" })),
    (error) => error instanceof LearningMemoryError && error.code === "INVALID_INPUT");
  assert.equal(store.read().revision, 0);
});

test("recovers a lock left by a terminated writer", () => {
  const store = setup();
  mkdirSync(store.lockPath);
  writeFileSync(join(store.lockPath, "owner"), "99999999\n");
  const started = store.start(startInput());
  assert.equal(started.revision, 1);
});
