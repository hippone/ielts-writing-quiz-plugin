# Codex Cards

Use cards only when the host supports inline interactive HTML. They render already-committed public state and never generate or judge content.

## Rendering Completion Gate

Apply this gate after every successful `quiz_create_session`, `quiz_get_session`, `quiz_get_latest_session`, or `quiz_commit_transition` that must be shown to the learner.

- Use the visualization directory writable in the current turn. Never reuse a directory from an earlier turn merely because a previous card exists.
- Save the exact successful MCP `structuredContent` as JSON, then render `quiz-card.html` in that same current directory.
- Verify that both files exist, the HTML is non-empty, and its first meaningful element is the quiz fragment root.
- Put the exact content reference below on its own line in the same turn's final response, using the current absolute path:

```text
visualize{"path":"/absolute/current-visualization-directory/quiz-card.html","title":"IELTS Writing Quiz"}
```

- Do not use a Markdown link, an `open_in_codex` file tab, or a claim that the card was generated as a substitute for the content reference.
- Rendering is not complete when only the HTML file exists. Do not finish the turn without the content reference.
- If file generation or verification fails, fix it before responding. If the host exposes no writable inline-visualization directory, use the Markdown fallback and state plainly that an interactive card could not be rendered in that host.

1. Save the exact successful MCP `structuredContent` as JSON in the current visualization directory.
2. Run:

```bash
python3 scripts/render_quiz_state.py /absolute/path/session.json /absolute/path/quiz-card.html
```

Resolve `scripts/` relative to this skill directory. Return the HTML through the required `visualize` content reference; opening the file in a tab is not inline rendering.

Question and hint cards collect a short answer. Feedback cards expose one legal continuation. Complete cards have no action. Every button sends a `quiz_action.v1` message with a new event ID; the next assistant turn must load and commit through MCP before rendering again.

The HTML has no API key, private checklist, hidden answer, database path, or older attempt history. Outside Codex it displays a copyable action message instead of pretending the action was saved.
