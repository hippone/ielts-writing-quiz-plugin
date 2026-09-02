# Persistent Session Protocol

The MCP server owns one `quiz_session.v1` record. The active Codex model owns generation and semantic judgment.

## Public State

Every successful tool call returns:

```json
{
  "schemaVersion": "quiz_session.v1",
  "sessionId": "qs_uuid",
  "revision": 1,
  "state": "question",
  "locale": "zh",
  "taskType": "task2",
  "progress": { "current": 1, "total": 3 },
  "currentItem": {
    "id": "q1",
    "difficulty": "medium",
    "blocker": "plain-language target",
    "evidenceQuote": "exact learner evidence",
    "question": "虚构场景：…。已知信息：…。你的任务：…。",
    "assistLevel": 0,
    "support": null,
    "draftResponse": "",
    "feedback": null,
    "attemptCount": 0
  }
}
```

Only the current item is projected. Older attempts remain local and are not embedded in cards.

## Card Action

Cards send `quiz_action.v1` through `sendFollowUpMessage`:

```json
{
  "version": "quiz_action.v1",
  "action": "submit_answer",
  "sessionId": "qs_uuid",
  "expectedRevision": 1,
  "itemId": "q1",
  "eventId": "browser-generated-uuid",
  "learnerResponse": "..."
}
```

The message starts a new Codex turn; it does not call MCP directly.

## Legal Transitions

| Current | Action | Required model output | Next |
|---|---|---|---|
| `question` or `hint` | `request_hint` | next `support` level | `hint` |
| `question` or `hint` | `submit_answer` | `evaluation` | `feedback` |
| `feedback` unresolved | `retry` | none | `question` or retained `hint` |
| `feedback` resolved | `next` | none | next `question` or `complete` |

The skill compares the card revision before semantic work, and the MCP server independently rejects mismatched items, stale revisions, reused support levels, invented or missing evidence for non-empty responses, inconsistent next actions, and illegal transitions. `eventId` makes an exact repeated commit idempotent; reusing it with any different request field is rejected.

## Local Retention

Sessions include learner drafts, exact evidence, and attempts. They remain only in the user's local Codex data directory until the learner deletes that session with `quiz_delete_session`. The store restricts its directory and SQLite files to the current OS user.
