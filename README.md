# IELTS Writing Quiz Plugin

A complete Codex plugin for persistent, evidence-grounded IELTS Writing micro-quizzes. It uses the active Codex model to generate hints and evaluate learner moves, while a local MCP server owns authoritative quiz state and transition validation.

## Included

- Codex plugin manifest and MCP configuration
- IELTS Writing Quiz skill and all reference instructions
- Local SQLite-backed quiz session server
- Codex card renderer
- Node.js and Python tests
- Locked production dependencies

## Requirements

- Codex desktop app
- Node.js 22.5 or newer
- Python 3 for card rendering and its tests

## Install dependencies

```bash
npm ci
```

## Test

```bash
npm test
python3 test/render_quiz_state_test.py
```

## Run the MCP server directly

```bash
npm start
```

The plugin manifest is at `.codex-plugin/plugin.json`. The bundled `.mcp.json` is configured for the Node.js runtime included with the macOS Codex/ChatGPT desktop app. If you run the source outside that app bundle, change the MCP command to a compatible Node.js 22.5+ executable.

Quiz sessions are stored locally at `~/.codex/data/ielts-writing-quiz/sessions.sqlite` unless `IELTS_QUIZ_DB_PATH` is set. Session databases and learner data are intentionally excluded from this repository.

## Privacy boundary

Learner essays, drafts, attempts, and quiz session databases are local runtime data. Do not commit them to source control.
