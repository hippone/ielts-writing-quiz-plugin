import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { QuizSessionStore, QuizStateError } from "./session-store.mjs";
import { LearningMemoryError, LearningMemoryStore } from "./learning-memory-store.mjs";

const server = new McpServer({ name: "ielts-writing-quiz", version: "0.2.0" });
const store = new QuizSessionStore();
const learningMemory = new LearningMemoryStore();

const itemShape = z.object({
  id: z.string().min(1).max(120),
  difficulty: z.enum(["easy", "medium", "hard"]),
  blocker: z.string().min(1).max(1000),
  evidenceQuote: z.string().min(1).max(2000),
  question: z.string().min(1).max(4000),
}).strict();

const observedMoveShape = z.object({
  text: z.string().min(1).max(1200),
  status: z.enum(["reaches_target", "stops_early", "adjacent_outcome", "unsupported", "off_target"]),
}).strict();

const evaluationShape = z.object({
  outcome: z.enum(["resolved", "partial", "not_resolved"]),
  evidenceQuote: z.string().max(2000),
  observedMoves: z.array(observedMoveShape).max(5),
  missingLinks: z.array(z.string().min(1).max(1200)).max(5),
  nextAction: z.enum(["retry", "next"]),
}).strict();

const supportShape = z.object({
  level: z.number().int().min(1).max(3),
  kind: z.enum(["direction", "thinking_frame", "parallel_example"]),
  text: z.string().min(1).max(1200),
}).strict();

function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function fail(error) {
  const payload = error instanceof QuizStateError || error instanceof LearningMemoryError
    ? { error: { code: error.code, message: error.message, details: error.details } }
    : { error: { code: "INTERNAL_ERROR", message: "The quiz session operation failed." } };
  if (!(error instanceof QuizStateError) && !(error instanceof LearningMemoryError)) console.error(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

server.registerTool("quiz_create_session", {
  title: "Create IELTS Writing quiz session",
  description: "Persist a complete set of model-generated quiz items and return the first public question state. The active Codex model must generate the items before calling this tool.",
  inputSchema: {
    locale: z.enum(["zh", "en"]),
    taskType: z.enum(["task1", "task2"]),
    items: z.array(itemShape).min(1).max(10),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async (input) => {
  try { return ok(store.create(input)); } catch (error) { return fail(error); }
});

server.registerTool("quiz_get_session", {
  title: "Get IELTS Writing quiz session",
  description: "Load the authoritative current public state before processing any card action or resuming a quiz.",
  inputSchema: { sessionId: z.string().min(1).max(160) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ sessionId }) => {
  try { return ok(store.read(sessionId)); } catch (error) { return fail(error); }
});

server.registerTool("quiz_get_latest_session", {
  title: "Get latest IELTS Writing quiz session",
  description: "Load the most recently updated local quiz session when the user asks to resume without a session ID.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try { return ok(store.readLatest()); } catch (error) { return fail(error); }
});

server.registerTool("quiz_delete_session", {
  title: "Delete IELTS Writing quiz session",
  description: "Permanently delete one locally persisted quiz session, including learner drafts and attempts.",
  inputSchema: { sessionId: z.string().min(1).max(160) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ sessionId }) => {
  try { return ok(store.delete(sessionId)); } catch (error) { return fail(error); }
});

server.registerTool("quiz_commit_transition", {
  title: "Commit IELTS Writing quiz transition",
  description: "Validate and persist one model-prepared quiz transition. Load the latest session first. The server checks revision, item, state, exact learner evidence, support level, and next-action consistency.",
  inputSchema: {
    sessionId: z.string().min(1).max(160),
    eventId: z.string().min(1).max(160),
    expectedRevision: z.number().int().min(1),
    action: z.enum(["request_hint", "submit_answer", "retry", "next"]),
    itemId: z.string().min(1).max(120),
    draftResponse: z.string().max(6000).optional(),
    learnerResponse: z.string().max(6000).optional(),
    support: supportShape.optional(),
    evaluation: evaluationShape.optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return ok(store.commit(input)); } catch (error) { return fail(error); }
});

server.registerTool("learning_list_methods", {
  title: "List IELTS Writing learning methods",
  description: "Return the fixed nine-method catalog, optionally filtered by IELTS task. Use the active Codex model to choose from compatible methods using essay evidence and learner context.",
  inputSchema: { taskType: z.enum(["task1", "task2"]).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ taskType }) => {
  try { return ok({ methods: learningMemory.listMethods(taskType) }); } catch (error) { return fail(error); }
});

server.registerTool("learning_get_memory", {
  title: "Get IELTS Writing learning memory",
  description: "Read the current concise learning summary and one-line event history from the local Markdown memory before any update.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try { return ok(learningMemory.read()); } catch (error) { return fail(error); }
});

server.registerTool("learning_start_method", {
  title: "Start one IELTS Writing learning method",
  description: "Start one compatible method for one evidence-grounded weakness. Only one method may be active, and the update appends one natural-language Markdown event.",
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    eventId: z.string().min(1).max(160),
    methodId: z.string().min(1).max(120),
    taskType: z.enum(["task1", "task2"]),
    targetWeakness: z.string().min(1).max(500),
    reason: z.string().min(1).max(800),
    baselineEvidence: z.string().min(1).max(1200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return ok(learningMemory.start(input)); } catch (error) { return fail(error); }
});

server.registerTool("learning_record_checkpoint", {
  title: "Record one IELTS Writing learning checkpoint",
  description: "Append one meaningful method, rewrite, Quiz, or transfer result to Markdown and refresh the concise learning memory. This does not assign an IELTS band score.",
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    eventId: z.string().min(1).max(160),
    evidenceKind: z.enum(["method_session", "same_prompt_rewrite", "quiz", "different_topic_transfer", "delayed_transfer"]),
    sessionNumber: z.number().int().min(1).max(5).optional(),
    outcome: z.enum(["met", "partially_met", "not_met", "inconclusive"]),
    assistanceLevel: z.enum(["L0", "L1", "L2", "L3"]),
    timed: z.boolean(),
    evidence: z.string().min(1).max(1200),
    nextAction: z.string().min(1).max(800),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return ok(learningMemory.recordCheckpoint(input)); } catch (error) { return fail(error); }
});

server.registerTool("learning_switch_method", {
  title: "Switch IELTS Writing learning method",
  description: "Explicitly switch the active method after learner confirmation while preserving the prior method's Markdown history.",
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    eventId: z.string().min(1).max(160),
    toMethodId: z.string().min(1).max(120),
    reason: z.string().min(1).max(800),
    learnerConfirmed: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return ok(learningMemory.switchMethod(input)); } catch (error) { return fail(error); }
});

server.registerTool("learning_close_method", {
  title: "Close IELTS Writing learning method",
  description: "Close the active method with one concise conclusion. Closing a method never creates a mastery or IELTS band claim.",
  inputSchema: {
    expectedRevision: z.number().int().min(0),
    eventId: z.string().min(1).max(160),
    conclusion: z.string().min(1).max(800),
    nextAction: z.string().min(1).max(800),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return ok(learningMemory.closeMethod(input)); } catch (error) { return fail(error); }
});

process.on("SIGINT", () => { store.close(); process.exit(0); });
process.on("SIGTERM", () => { store.close(); process.exit(0); });

await server.connect(new StdioServerTransport());
