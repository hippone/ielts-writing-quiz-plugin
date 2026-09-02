import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const OUTCOMES = new Set(["met", "partially_met", "not_met", "inconclusive"]);
const ASSISTANCE_LEVELS = new Set(["L0", "L1", "L2", "L3"]);
const EVIDENCE_KINDS = new Set([
  "method_session",
  "same_prompt_rewrite",
  "quiz",
  "different_topic_transfer",
  "delayed_transfer",
]);

const OUTCOME_FROM_LABEL = new Map([
  ["达到", "met"],
  ["部分达到", "partially_met"],
  ["未达到", "not_met"],
  ["证据不足", "inconclusive"],
]);

export const LEARNING_METHODS = Object.freeze([
  { id: "argument-ladder", title: "论证追问链", tasks: ["task2"], sessions: 3, trigger: "有观点但论证展开不足", proof: "学习者写出的解释链与陌生题段落" },
  { id: "model-to-transfer", title: "范文拆解到迁移", tasks: ["task1", "task2"], sessions: 3, trigger: "能看懂范文但无法迁移", proof: "功能图、规则卡与闭卷新题" },
  { id: "feedback-rewrite-transfer", title: "反馈—重写—迁移", tasks: ["task1", "task2"], sessions: 3, trigger: "批改后相同问题仍反复出现", proof: "原稿、重写与不同话题迁移" },
  { id: "error-led-language-control", title: "个人错误账本", tasks: ["task1", "task2"], sessions: 5, trigger: "语法、拼写或搭配重复出错", proof: "个人规则与后续作文复发观察" },
  { id: "timed-completion", title: "限时完成训练", tasks: ["task1", "task2"], sessions: 3, trigger: "考试时间内无法完成", proof: "完整稿、时间线与单点复盘" },
  { id: "task1-feature-selection", title: "Task 1 特征选择", tasks: ["task1"], sessions: 4, trigger: "不会选择主要特征或堆砌数字", proof: "准确的总体特征与两组细节" },
  { id: "short-horizon-scaffold", title: "短期结构脚手架", tasks: ["task1", "task2"], sessions: 3, trigger: "临考且难以完成切题全文", proof: "不携带固定句的陌生题独立输出" },
  { id: "ai-assisted-self-review", title: "AI 辅助自审", tasks: ["task1", "task2"], sessions: 3, trigger: "需要第二双眼睛并能自行判断建议", proof: "问题取舍、理由与学习者重写" },
  { id: "keyword-first-start", title: "关键词起步", tasks: ["task1", "task2"], sessions: 3, trigger: "面对完整作文无法开始", proof: "关键词到句子再到段落的升级" },
]);

const METHOD_BY_ID = new Map(LEARNING_METHODS.map((method) => [method.id, method]));

export class LearningMemoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LearningMemoryError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field, max = 1200) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new LearningMemoryError("INVALID_INPUT", `${field} must be a non-empty string no longer than ${max} characters`);
  }
  return value.trim().replace(/\s+/gu, " ").replace(/-->/gu, "—>");
}

function requireEventId(value) {
  const eventId = requireText(value, "eventId", 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(eventId)) {
    throw new LearningMemoryError("INVALID_INPUT", "eventId must use only letters, numbers, dot, underscore, colon, or hyphen");
  }
  return eventId;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(input) {
  const payload = { ...input };
  delete payload.eventId;
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function displayOutcome(outcome) {
  return {
    met: "达到",
    partially_met: "部分达到",
    not_met: "未达到",
    inconclusive: "证据不足",
  }[outcome];
}

function displayEvidenceKind(kind, sessionNumber) {
  if (kind === "method_session") return `第 ${sessionNumber} 次方法训练`;
  return {
    same_prompt_rewrite: "同题重写",
    quiz: "Quiz 观察",
    different_topic_transfer: "陌生题迁移检查",
    delayed_transfer: "延迟迁移复测",
  }[kind];
}

function attribute(source, name, fallback = "") {
  const match = source.match(new RegExp(`${name}="([^"]*)"`, "u"));
  return match?.[1] ?? fallback;
}

function visibleValue(source, label, fallback = "尚无") {
  const line = source.split("\n").find((candidate) => candidate.startsWith(`- ${label}：`));
  return line ? line.slice(`- ${label}：`.length).trim() : fallback;
}

function initialState() {
  return {
    revision: 0,
    lastEventId: "",
    activeRunId: "",
    activeMethodId: "",
    taskType: "",
    plannedSessions: 0,
    latestSession: 0,
    skillStatus: "open",
    targetWeakness: "尚无",
    latestEvidence: "尚无",
    unproven: "尚未形成训练证据",
    nextAction: "提交作文或段落，识别一个当前主弱点",
  };
}

export class LearningMemoryStore {
  constructor(dataDirectory = process.env.IELTS_LEARNING_DATA_DIR || join(homedir(), ".codex", "data", "ielts-writing-quiz", "learning-memory")) {
    this.dataDirectory = dataDirectory;
    this.memoryPath = join(dataDirectory, "LEARNING_MEMORY.md");
    this.lockPath = join(dataDirectory, ".learning-write.lock");
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    chmodSync(dataDirectory, 0o700);
  }

  listMethods(taskType) {
    if (taskType !== undefined && !["task1", "task2"].includes(taskType)) {
      throw new LearningMemoryError("INVALID_INPUT", "taskType must be task1 or task2");
    }
    return LEARNING_METHODS.filter((method) => !taskType || method.tasks.includes(taskType));
  }

  read() {
    const state = this.#readState();
    return this.#project(state);
  }

  reviewDirection() {
    const state = this.#readState();
    const checkpoints = this.#currentRunCheckpoints();
    const evidenceWindow = checkpoints.slice(-3);
    const recentThreeNotMet = evidenceWindow.length === 3
      && evidenceWindow.every((checkpoint) => checkpoint.outcome === "not_met");

    if (!state.activeMethodId) {
      return this.#direction(state, evidenceWindow, {
        action: "diagnose_weakness",
        signal: "no_active_method",
        reason: "当前没有活动方法，需要先用学习者原文确认一个主弱点。",
      });
    }
    if (state.skillStatus === "stable") {
      return this.#direction(state, evidenceWindow, {
        action: "close_or_choose_next",
        signal: "stable_local_evidence",
        reason: "已有延迟、限时、无帮助的陌生题证据，可以结束当前方法或选择下一个主弱点。",
      });
    }
    if (state.skillStatus === "provisional") {
      return this.#direction(state, evidenceWindow, {
        action: "run_delayed_transfer",
        signal: "provisional_transfer_met",
        reason: "陌生题已暂定通过，下一项有效证据应是延迟迁移复测。",
      });
    }
    if (state.skillStatus === "same_prompt_resolved") {
      return this.#direction(state, evidenceWindow, {
        action: "run_different_topic_transfer",
        signal: "same_prompt_resolved",
        reason: "同题修复不能证明迁移，下一项有效证据应来自不同话题。",
      });
    }

    const latestCheckpoint = checkpoints.at(-1);
    const trialComplete = state.latestSession >= state.plannedSessions;
    if (trialComplete
      && latestCheckpoint?.context === "陌生题迁移检查"
      && latestCheckpoint.outcome === "not_met") {
      return this.#direction(state, evidenceWindow, {
        action: "consider_switch",
        signal: "trial_complete_transfer_failed",
        reason: "规定训练次数已完成，但当前弱点在陌生题中仍未解决；可以提出切换建议，实际切换仍需学习者确认。",
        requiresLearnerConfirmation: true,
      });
    }
    if (recentThreeNotMet) {
      return this.#direction(state, evidenceWindow, {
        action: "reduce_scope",
        signal: "recent_3_not_met",
        reason: "最近三个关键检查点都未解决同一主弱点，应先把任务缩小到最小可练动作。",
      });
    }
    if (trialComplete) {
      return this.#direction(state, evidenceWindow, {
        action: "run_different_topic_transfer",
        signal: "trial_complete_transfer_missing",
        reason: "规定训练次数已完成，但还缺少陌生题迁移证据。",
      });
    }
    return this.#direction(state, evidenceWindow, {
      action: "continue_method",
      signal: "insufficient_switch_evidence",
      reason: "现有证据不足以支持切换，继续当前方法并只记录会改变下一步的检查点。",
    });
  }

  start(input) {
    return this.#mutate(input, (state) => {
      if (state.activeMethodId) {
        throw new LearningMemoryError("ACTIVE_METHOD_EXISTS", "Finish or explicitly switch the active method before starting another one", {
          activeMethodId: state.activeMethodId,
        });
      }
      const method = this.#method(input.methodId, input.taskType);
      const targetWeakness = requireText(input.targetWeakness, "targetWeakness", 500);
      const reason = requireText(input.reason, "reason", 800);
      const baselineEvidence = requireText(input.baselineEvidence, "baselineEvidence", 1200);
      const activeRunId = `run-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
      const next = {
        ...state,
        activeRunId,
        activeMethodId: method.id,
        taskType: input.taskType,
        plannedSessions: method.sessions,
        latestSession: 0,
        skillStatus: "repairing",
        targetWeakness,
        latestEvidence: `基线：“${baselineEvidence}”`,
        unproven: "尚未证明同题修复或陌生题迁移",
        nextAction: `完成【${method.title}】第 1 次训练`,
      };
      return {
        state: next,
        sentence: `因“${targetWeakness}”开始【${method.title}】，基线证据为“${baselineEvidence}”，计划训练 ${method.sessions} 次；选择原因：${reason}。`,
        kind: "method_started",
      };
    });
  }

  recordCheckpoint(input) {
    return this.#mutate(input, (state) => {
      const method = this.#activeMethod(state);
      if (!EVIDENCE_KINDS.has(input.evidenceKind)) {
        throw new LearningMemoryError("INVALID_INPUT", "evidenceKind is invalid");
      }
      if (!OUTCOMES.has(input.outcome)) throw new LearningMemoryError("INVALID_INPUT", "outcome is invalid");
      if (!ASSISTANCE_LEVELS.has(input.assistanceLevel)) throw new LearningMemoryError("INVALID_INPUT", "assistanceLevel is invalid");
      if (typeof input.timed !== "boolean") throw new LearningMemoryError("INVALID_INPUT", "timed must be boolean");
      const evidence = requireText(input.evidence, "evidence", 1200);
      const nextAction = requireText(input.nextAction, "nextAction", 800);
      let latestSession = state.latestSession;
      if (input.evidenceKind === "method_session") {
        if (!Number.isInteger(input.sessionNumber) || input.sessionNumber < 1 || input.sessionNumber > state.plannedSessions) {
          throw new LearningMemoryError("INVALID_INPUT", `sessionNumber must be between 1 and ${state.plannedSessions}`);
        }
        if (input.sessionNumber < state.latestSession || input.sessionNumber > state.latestSession + 1) {
          throw new LearningMemoryError("SESSION_ORDER_CONFLICT", "Method sessions must be recorded in order without skipping a session", {
            latestSession: state.latestSession,
          });
        }
        latestSession = Math.max(latestSession, input.sessionNumber);
      }
      let skillStatus = state.skillStatus;
      let unproven = state.unproven;
      if (input.evidenceKind === "same_prompt_rewrite" && input.outcome === "met") {
        skillStatus = "same_prompt_resolved";
        unproven = "同题已经修复，但尚未证明陌生题无帮助迁移";
      }
      if (input.evidenceKind === "different_topic_transfer" && input.outcome === "met") {
        if (input.assistanceLevel !== "L0" || !input.timed) {
          throw new LearningMemoryError("TRANSFER_EVIDENCE_INSUFFICIENT", "Provisional status requires a timed, assistance-free different-topic transfer check");
        }
        skillStatus = "provisional";
        unproven = "陌生题已暂定通过，但尚未完成延迟复测";
      }
      if (input.evidenceKind === "delayed_transfer" && input.outcome === "met") {
        if (state.skillStatus !== "provisional" || input.assistanceLevel !== "L0" || !input.timed) {
          throw new LearningMemoryError("DELAYED_TRANSFER_EVIDENCE_INSUFFICIENT", "Stable status requires an earlier provisional result and a timed, assistance-free delayed transfer check");
        }
        skillStatus = "stable";
        unproven = "当前证据支持较稳定表现，但不等同于雅思分数提升证明";
      }
      if (["different_topic_transfer", "delayed_transfer"].includes(input.evidenceKind)
        && input.outcome === "not_met" && ["provisional", "stable"].includes(state.skillStatus)) {
        skillStatus = "regressed";
        unproven = "迁移表现出现回退，需要重新确认当前主弱点";
      }
      const context = displayEvidenceKind(input.evidenceKind, input.sessionNumber);
      return {
        state: {
          ...state,
          latestSession,
          skillStatus,
          latestEvidence: `${context}【${displayOutcome(input.outcome)}】：${evidence}`,
          unproven,
          nextAction,
        },
        sentence: `在【${method.title}】的${context}中，结果为【${displayOutcome(input.outcome)}】，帮助程度为【${input.assistanceLevel}】，${input.timed ? "采用限时" : "未采用限时"}；关键证据是“${evidence}”，下一步是“${nextAction}”。`,
        kind: "checkpoint_recorded",
      };
    });
  }

  switchMethod(input) {
    return this.#mutate(input, (state) => {
      const from = this.#activeMethod(state);
      if (input.learnerConfirmed !== true) {
        throw new LearningMemoryError("SWITCH_CONFIRMATION_REQUIRED", "Method switching requires explicit learner confirmation");
      }
      const to = this.#method(input.toMethodId, state.taskType);
      if (to.id === from.id) throw new LearningMemoryError("INVALID_INPUT", "The replacement method must differ from the active method");
      const reason = requireText(input.reason, "reason", 800);
      const nextRunId = `run-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
      return {
        state: {
          ...state,
          activeRunId: nextRunId,
          activeMethodId: to.id,
          plannedSessions: to.sessions,
          latestSession: 0,
          nextAction: `完成【${to.title}】第 1 次训练`,
          latestEvidence: `已保留【${from.title}】记录；切换原因为：${reason}`,
        },
        sentence: `用户确认从【${from.title}】切换到【${to.title}】，旧方法记录完整保留；切换原因：${reason}。`,
        kind: "method_switched",
      };
    });
  }

  closeMethod(input) {
    return this.#mutate(input, (state) => {
      const method = this.#activeMethod(state);
      const conclusion = requireText(input.conclusion, "conclusion", 800);
      const nextAction = requireText(input.nextAction, "nextAction", 800);
      return {
        state: {
          ...state,
          activeRunId: "",
          activeMethodId: "",
          plannedSessions: 0,
          latestSession: 0,
          latestEvidence: `【${method.title}】已结束：${conclusion}`,
          nextAction,
        },
        sentence: `结束【${method.title}】，结论为“${conclusion}”，下一步是“${nextAction}”；方法结束本身不代表技能掌握或雅思分数提升。`,
        kind: "method_closed",
      };
    });
  }

  #mutate(input, transition) {
    const eventId = requireEventId(input.eventId);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new LearningMemoryError("INVALID_INPUT", "expectedRevision must be a non-negative integer");
    }
    this.#acquireLock();
    try {
      const state = this.#readState();
      const eventFingerprint = fingerprint(input);
      const prior = this.#findEvent(eventId);
      if (prior) {
        if (prior.fingerprint !== eventFingerprint) {
          throw new LearningMemoryError("EVENT_ID_REUSE", "eventId was already used for a different learning-memory update");
        }
        return { ...this.#project(state), idempotentReplay: true };
      }
      if (state.revision !== input.expectedRevision) {
        throw new LearningMemoryError("STALE_REVISION", "Learning memory changed in another window; reload it before writing", {
          expectedRevision: input.expectedRevision,
          actualRevision: state.revision,
        });
      }
      const result = transition(state);
      const next = {
        ...result.state,
        revision: state.revision + 1,
        lastEventId: eventId,
      };
      const timestamp = new Date().toISOString();
      const eventLine = `- ${timestamp}：${result.sentence} <!-- event="${eventId}" revision="${next.revision}" kind="${result.kind}" fingerprint="${eventFingerprint}" -->`;
      this.#writeMemory(next, eventLine);
      return this.#project(next);
    } finally {
      this.#releaseLock();
    }
  }

  #method(methodId, taskType) {
    const method = METHOD_BY_ID.get(methodId);
    if (!method) throw new LearningMemoryError("METHOD_NOT_FOUND", "The requested learning method is not in the nine-method catalog", { methodId });
    if (!method.tasks.includes(taskType)) {
      throw new LearningMemoryError("METHOD_TASK_INCOMPATIBLE", "The requested learning method does not support this IELTS task", { methodId, taskType });
    }
    return method;
  }

  #activeMethod(state) {
    if (!state.activeMethodId) throw new LearningMemoryError("NO_ACTIVE_METHOD", "There is no active learning method");
    return this.#method(state.activeMethodId, state.taskType);
  }

  #readState() {
    if (!existsSync(this.memoryPath)) return initialState();
    const source = readFileSync(this.memoryPath, "utf8");
    const header = source.split("\n").find((line) => line.startsWith("<!-- learning-harness ")) ?? "";
    const revision = Number(attribute(header, "revision", "0"));
    const plannedSessions = Number(attribute(header, "planned-sessions", "0"));
    const latestSession = Number(attribute(header, "latest-session", "0"));
    if (![revision, plannedSessions, latestSession].every(Number.isInteger)) {
      throw new LearningMemoryError("MEMORY_CORRUPT", "LEARNING_MEMORY.md contains invalid harness counters");
    }
    return {
      revision,
      lastEventId: attribute(header, "last-event"),
      activeRunId: attribute(header, "active-run"),
      activeMethodId: attribute(header, "active-method"),
      taskType: attribute(header, "task"),
      plannedSessions,
      latestSession,
      skillStatus: attribute(header, "skill-status", "open"),
      targetWeakness: visibleValue(source, "当前主弱点"),
      latestEvidence: visibleValue(source, "最近关键证据"),
      unproven: visibleValue(source, "尚未证明"),
      nextAction: visibleValue(source, "下一步"),
    };
  }

  #project(state) {
    const method = state.activeMethodId ? METHOD_BY_ID.get(state.activeMethodId) : null;
    return {
      schemaVersion: "learning_memory.v1",
      revision: state.revision,
      targetWeakness: state.targetWeakness,
      activeRunId: state.activeRunId || null,
      activeMethod: method ? { id: method.id, title: method.title } : null,
      taskType: state.taskType || null,
      progress: method ? { completedSessions: state.latestSession, plannedSessions: state.plannedSessions } : null,
      skillStatus: state.skillStatus,
      latestEvidence: state.latestEvidence,
      unproven: state.unproven,
      nextAction: state.nextAction,
      files: { memory: this.memoryPath },
    };
  }

  #direction(state, evidenceWindow, decision) {
    return {
      schemaVersion: "learning_direction.v1",
      revision: state.revision,
      targetWeakness: state.targetWeakness,
      activeMethod: state.activeMethodId
        ? { id: state.activeMethodId, title: METHOD_BY_ID.get(state.activeMethodId)?.title }
        : null,
      progress: state.activeMethodId
        ? { completedSessions: state.latestSession, plannedSessions: state.plannedSessions }
        : null,
      skillStatus: state.skillStatus,
      evidenceWindow,
      recentThreeNotMet: evidenceWindow.length === 3
        && evidenceWindow.every((checkpoint) => checkpoint.outcome === "not_met"),
      requiresLearnerConfirmation: false,
      ...decision,
    };
  }

  #currentRunCheckpoints() {
    if (!existsSync(this.memoryPath)) return [];
    const lines = readFileSync(this.memoryPath, "utf8").split("\n");
    let runStart = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (/kind="(?:method_started|method_switched)"/u.test(lines[index])) runStart = index;
    }
    if (runStart < 0) return [];
    return lines.slice(runStart + 1).flatMap((line) => {
      if (!/kind="checkpoint_recorded"/u.test(line)) return [];
      const match = line.match(/的(.+?)中，结果为【(达到|部分达到|未达到|证据不足)】/u);
      if (!match) {
        throw new LearningMemoryError("MEMORY_CORRUPT", "A learning checkpoint cannot be read from LEARNING_MEMORY.md");
      }
      return [{ context: match[1], outcome: OUTCOME_FROM_LABEL.get(match[2]) }];
    });
  }

  #writeMemory(state, eventLine) {
    const method = state.activeMethodId ? METHOD_BY_ID.get(state.activeMethodId) : null;
    const prior = existsSync(this.memoryPath) ? readFileSync(this.memoryPath, "utf8") : "";
    const historyMarker = "## 关键记录";
    const historyIndex = prior.lastIndexOf(historyMarker);
    const priorHistory = historyIndex >= 0
      ? prior.slice(historyIndex + historyMarker.length).trim()
      : "> 每次只保留一条会改变后续学习决策的事实。";
    const history = `${priorHistory}\n\n${eventLine}`;
    const content = `<!-- learning-harness revision="${state.revision}" last-event="${state.lastEventId}" active-run="${state.activeRunId}" active-method="${state.activeMethodId}" task="${state.taskType}" planned-sessions="${state.plannedSessions}" latest-session="${state.latestSession}" skill-status="${state.skillStatus}" -->\n# IELTS Writing 学习记忆\n\n- 当前主弱点：${state.targetWeakness}\n- 当前方法：${method ? `【${method.title}】` : "无活动方法"}\n- 当前训练进度：${method ? `${state.latestSession}/${state.plannedSessions}` : "无"}\n- 当前技能状态：${state.skillStatus}\n- 最近关键证据：${state.latestEvidence}\n- 尚未证明：${state.unproven}\n- 下一步：${state.nextAction}\n\n> 本文件由学习 Harness 根据关键事件更新。方法完成、同题修复、Quiz 表现与陌生题迁移是不同结论。\n\n## 关键记录\n\n${history}\n`;
    this.#atomicWrite(this.memoryPath, content);
  }

  #findEvent(eventId) {
    if (!existsSync(this.memoryPath)) return null;
    const escaped = eventId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = readFileSync(this.memoryPath, "utf8").match(new RegExp(`event="${escaped}"[^>]*fingerprint="([a-f0-9]{64})"`, "u"));
    return match ? { fingerprint: match[1] } : null;
  }

  #atomicWrite(path, content) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  }

  #acquireLock() {
    try {
      mkdirSync(this.lockPath, { mode: 0o700 });
      writeFileSync(join(this.lockPath, "owner"), `${process.pid}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") {
        const ownerPath = join(this.lockPath, "owner");
        let ownerPid = Number.NaN;
        try {
          ownerPid = Number(readFileSync(ownerPath, "utf8").trim());
        } catch {
          // A just-created lock without an owner marker is treated as active.
        }
        if (Number.isInteger(ownerPid) && ownerPid > 0) {
          try {
            process.kill(ownerPid, 0);
          } catch (processError) {
            if (processError?.code === "ESRCH") {
              rmSync(this.lockPath, { recursive: true, force: true });
              return this.#acquireLock();
            }
          }
        }
        throw new LearningMemoryError("WRITE_CONFLICT", "Another window is updating the learning memory; retry after it finishes");
      }
      throw error;
    }
  }

  #releaseLock() {
    if (existsSync(this.lockPath)) rmSync(this.lockPath, { recursive: true, force: true });
  }
}
