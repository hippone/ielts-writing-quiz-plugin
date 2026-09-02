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
  const databasePath = join(mkdtempSync(join(tmpdir(), "ielts-quiz-mcp-")), "sessions.sqlite");
  const transport = new StdioClientTransport({
    command: configured.command,
    args: configured.args,
    cwd: pluginRoot,
    env: { IELTS_QUIZ_DB_PATH: databasePath, HOME: process.env.HOME },
    stderr: "pipe",
  });
  const client = new Client({ name: "ielts-writing-quiz-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["quiz_commit_transition", "quiz_create_session", "quiz_delete_session", "quiz_get_latest_session", "quiz_get_session"],
    );

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
