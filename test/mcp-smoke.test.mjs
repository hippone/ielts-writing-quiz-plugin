import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio server lists and executes the persistent quiz tools", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(here, "..");
  const mcpConfig = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(join(pluginRoot, ".mcp.json"), "utf8")));
  const configured = mcpConfig.mcpServers.ielts_writing_quiz;
  const testDirectory = mkdtempSync(join(tmpdir(), "ielts-quiz-mcp-"));
  const databasePath = join(testDirectory, "sessions.sqlite");
  const learningDataDirectory = join(testDirectory, "learning-memory");
  const transport = new StdioClientTransport({
    command: configured.command,
    args: configured.args,
    cwd: pluginRoot,
    env: {
      IELTS_QUIZ_DB_PATH: databasePath,
      IELTS_LEARNING_DATA_DIR: learningDataDirectory,
      HOME: process.env.HOME,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "ielts-writing-quiz-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "learning_close_method",
        "learning_get_memory",
        "learning_list_methods",
        "learning_record_checkpoint",
        "learning_review_direction",
        "learning_start_method",
        "learning_switch_method",
        "plugin_check_update",
        "quiz_commit_transition",
        "quiz_create_session",
        "quiz_delete_session",
        "quiz_get_latest_session",
        "quiz_get_session",
      ],
    );

    const methods = await client.callTool({
      name: "learning_list_methods",
      arguments: { taskType: "task2" },
    });
    assert.equal(methods.structuredContent.methods.length, 8);

    const emptyMemory = await client.callTool({ name: "learning_get_memory", arguments: {} });
    assert.equal(emptyMemory.structuredContent.revision, 0);

    const startedMethod = await client.callTool({
      name: "learning_start_method",
      arguments: {
        expectedRevision: 0,
        eventId: "mcp-start-1",
        methodId: "argument-ladder",
        taskType: "task2",
        targetWeakness: "论证解释链断裂",
        reason: "作文证据显示观点与结果之间缺少机制",
        baselineEvidence: "This is helpful, so society improves.",
      },
    });
    assert.equal(startedMethod.isError, undefined);
    assert.equal(startedMethod.structuredContent.activeMethod.id, "argument-ladder");
    assert.equal(startedMethod.structuredContent.revision, 1);

    const direction = await client.callTool({ name: "learning_review_direction", arguments: {} });
    assert.equal(direction.structuredContent.action, "continue_method");
    assert.equal(direction.structuredContent.revision, 1);

    const created = await client.callTool({
      name: "quiz_create_session",
      arguments: {
        locale: "zh",
        taskType: "task2",
        items: [{
          id: "q1",
          difficulty: "medium",
          blocker: "补全因果关系",
          evidenceQuote: "图书馆延长开放时间",
          question: "虚构场景：社区中心延长开放时间。已知信息：晚间访客增加。你的任务：补出访客增加与课程报名增加之间的一步推理。",
        }],
      },
    });
    assert.equal(created.isError, undefined);
    assert.equal(created.structuredContent.state, "question");

    const loaded = await client.callTool({
      name: "quiz_get_session",
      arguments: { sessionId: created.structuredContent.sessionId },
    });
    assert.equal(loaded.structuredContent.revision, 1);
    assert.equal(loaded.structuredContent.currentItem.id, "q1");

    const latest = await client.callTool({ name: "quiz_get_latest_session", arguments: {} });
    assert.equal(latest.structuredContent.sessionId, created.structuredContent.sessionId);
  } finally {
    await client.close();
  }
});
