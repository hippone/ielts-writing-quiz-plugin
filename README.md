# IELTS Writing Quiz Plugin

A Codex plugin for persistent, evidence-grounded IELTS Writing micro-quizzes and
lightweight learning-method guidance. It uses the active Codex model to diagnose one
current blocker, choose from nine writing methods, generate practice, and evaluate
learner moves. A local Harness owns authoritative transitions while keeping the
long-term learning record readable in one Markdown file.

## Included

- Codex plugin manifest and MCP configuration
- IELTS Writing Quiz skill and all reference instructions
- Local SQLite-backed quiz session server
- Nine-method catalog and evidence-grounded selection guidance
- One-file Markdown learning memory with concise event sentences
- Multi-window revision checks, process locking, idempotency, and atomic writes
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

Learning-method history is stored separately at
`~/.codex/data/ielts-writing-quiz/learning-memory/LEARNING_MEMORY.md` unless
`IELTS_LEARNING_DATA_DIR` is set. Its top section is a rolling summary; its bottom
section contains one natural-language line for every event that changes the next
learning decision. The hidden Markdown comments contain only Harness revision and
idempotency guards.

The learning tools are:

- `learning_list_methods`
- `learning_get_memory`
- `learning_start_method`
- `learning_record_checkpoint`
- `learning_switch_method`
- `learning_close_method`

Method completion, same-prompt repair, Quiz performance, transfer evidence, and IELTS
band movement remain separate conclusions. Only a timed, assistance-free,
different-topic checkpoint can create provisional local skill evidence.

## Privacy boundary

Learner essays, drafts, attempts, Quiz databases, and learning-memory Markdown are
local runtime data. Do not commit them to source control.
