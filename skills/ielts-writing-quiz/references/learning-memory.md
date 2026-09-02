# Markdown Learning Memory

The learning Harness stores durable learner state in one local Markdown file:
`LEARNING_MEMORY.md`. It contains a rolling summary followed by one natural-language
line for every event that changes a future learning decision. It does not store Quiz
clicks, navigation, passive views, or routine conversation.

## Read Before Write

Before starting, recording, switching, or closing a method:

1. Call `learning_get_memory`.
2. Use its exact `revision` as `expectedRevision`.
3. Use a fresh stable `eventId` for the intended action.
4. Prepare only one mutation.
5. If the tool returns `STALE_REVISION` or `WRITE_CONFLICT`, reload memory and show the
   latest state. Never replay the old judgment against the new revision.

The Harness uses an atomic file replacement, a short-lived process lock, event
idempotency, and a hidden revision comment. The visible file remains ordinary
Markdown. Do not edit the hidden `learning-harness` or event comments by hand.

## Start

Use `learning_list_methods` when compatibility is not already known. The active model
does the evidence-grounded recommendation; the tool validates catalog identity, task
compatibility, and the one-active-method rule. Call `learning_start_method` only after
there is one exact baseline quote, one current weakness, and one plain-language reason.

## Record Sparingly

Call `learning_record_checkpoint` only when at least one future decision changes:

- a numbered method session receives a grounded result;
- a learner-owned same-prompt rewrite is checked;
- a Quiz adds useful evidence about the active weakness;
- a different-topic transfer is checked;
- a delayed transfer rechecks provisional evidence.

Use `met`, `partially_met`, `not_met`, or `inconclusive`. Record the highest assistance
actually used as `L0`–`L3`. Quote or precisely describe the learner evidence and give
exactly one next action. For `method_session`, provide the real session number without
skipping an ordinal.

The Harness refuses provisional status unless a different-topic check is both timed
and L0. It refuses stable status unless an earlier provisional result exists and the
delayed check is also timed and L0.

## Switch And Close

When evidence suggests switching, explain the evidence and ask for confirmation. Do
not call `learning_switch_method` with `learnerConfirmed=true` unless the learner has
actually confirmed. Switching preserves the old event lines and starts a new run at
session zero.

Use `learning_close_method` when the learner stops or completes a method without
starting another one. State the honest conclusion and next action. Closing never
promotes the skill status.

## What To Show

Keep the learner-facing update compact:

- current weakness;
- current method and progress;
- latest evidence;
- what remains unproven;
- exactly one next action.

Never expose hidden event identifiers, revisions, internal method IDs, or assistance
codes unless troubleshooting requires them.
