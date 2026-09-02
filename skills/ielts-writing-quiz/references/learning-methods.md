# Nine Learning Methods

Choose one primary method from exact learner evidence. A recommendation says
"this fits the current problem"; it does not claim that the method is best or
that it will raise an IELTS band.

| Method ID | Use when | Sessions | Required learner evidence |
|---|---|---:|---|
| `argument-ladder` | Task 2 has a claim but its explanation jumps or stops early | 3 | A learner-authored reason, mechanism, result chain and a different-topic paragraph |
| `model-to-transfer` | The learner understands models but cannot use their functions on a new prompt | 3 | Pre-source attempt, function map, up to three learner rules, closed-source response |
| `feedback-rewrite-transfer` | The same evidence-grounded feedback recurs across drafts | 3 | Original, learner rewrite, feedback decision and different-topic transfer |
| `error-led-language-control` | One owned grammar, spelling or collocation family repeatedly recurs | 5 | Learner examples, one active rule and later recurrence observations |
| `timed-completion` | The primary barrier is finishing under exam timing | 3 | Server-observed timed draft, pacing facts and one next-run variable |
| `task1-feature-selection` | Academic Task 1 reports details but misses supported main features | 4 | Learner observations, 2–3 overview features and two justified detail groups |
| `short-horizon-scaffold` | The exam is close and the learner cannot complete a relevant whole response | 3 | Paragraph functions only, faded support and an unaided unfamiliar prompt |
| `ai-assisted-self-review` | The learner needs a second view and can accept or reject AI questions | 3 | Frozen draft, first self-review, issue decisions, learner rewrite and rationale |
| `keyword-first-start` | The learner understands the task but freezes before writing | 3 | 8–12 learner keywords, relationship chain, 3–5 sentences, later independent paragraph |

## Selection Order

1. Freeze one exact learner quote and name one current weakness in plain language.
2. Filter by Task 1 or Task 2 compatibility and missing prerequisites.
3. Prefer the method whose required learner artifact directly exercises that weakness.
4. Use learner constraints only to break a genuine tie: exam horizon, available time,
   repeated-error history, preference for examples or checklists, and ability to
   complete a paragraph or essay.
5. Present one recommendation, its evidence, its expected artifact, and at most two
   compatible alternatives. Never start all nine.

For common Task 2 development skills such as a logic jump, missing consequence,
general example, missing explanation chain, underdeveloped main idea, or insufficient
support, prefer `argument-ladder`. Use `feedback-rewrite-transfer` when the strongest
fact is a committed evidence-grounded blocker that has already survived feedback or
rewrite. Do not infer a method from a criterion label alone.

## Continue Or Switch

Observe after every meaningful artifact, but recommend switching only at a checkpoint.
Use `learning_review_direction` to inspect the current run before making that recommendation.

- Continue after one `not_met`; reduce the unit or unlock only the next help rung.
- Continue when the target move improves on a different prompt without creating a
  more serious blocker.
- Recommend task reduction when a whole essay repeatedly prevents the method's
  minimum artifact; reduce to one paragraph or one Task 1 overview.
- Recommend switching when the required trial count is complete and the same target
  remains `not_met` on an unfamiliar prompt, when another blocker becomes clearly
  dominant, or when the learner's real time constraint changes the eligible method.
- A switch is only a recommendation until the learner explicitly confirms it.
- Preserve the previous method and evidence as abandoned history. Never convert a
  switch into completion, mastery, or an IELTS score claim.
- Keep the practice unit progressive: one observable move first, then sentence group,
  paragraph or overview, and only then a whole response when the method requires it.

## Evidence Boundary

- Method session `met`: the required method action was observed.
- Same-prompt rewrite `met`: this essay's target move was repaired.
- Quiz `met`: a short observation supports the target but creates no mastery.
- Timed, L0, different-topic transfer `met`: provisional evidence only.
- A later timed, L0, different-topic transfer after provisional evidence: stable local
  evidence, still not proof of an IELTS band increase.
