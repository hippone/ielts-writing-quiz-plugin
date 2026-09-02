# Generation And Evaluation

## Generate Each Item

Use `learningMove=apply`, `questionType=short_answer`, and `evaluationMode=guided_reflection`. Expected effort is one learner-owned micro-action in one to three minutes.

For every item:

1. Bind it to one blocker and one exact learner-evidence excerpt.
2. Move to a clearly fictional topic that does not reuse the source topic, actors, examples, claims, or sentences.
3. Make it self-contained. Task 1 supplies a tiny invented dataset with every needed value; Task 2 supplies every premise and both endpoints of any relationship.
4. Use one paragraph with all locale-matched labels in order:
   - Chinese: `虚构场景：…。已知信息：…。你的任务：…。`
   - English: `Hypothetical scenario: …. Given information: …. Your task: ….`
5. Ask for one reasoning step, edit decision, outline line, comparison decision, or original sentence—never a paragraph or full answer.
6. Vary the scenario substantially between items.

Difficulty changes the amount of support, not answer length:

- `easy`: one concrete decision with explicit cues;
- `medium`: one transferable reasoning step;
- `hard`: changed context with minimal cues but no outside knowledge.

Before saving an item, confirm it is answerable from the given information, targets exactly one move, differs from the source topic, needs no factual verification, and leaks no answer.

## Private Evaluation Check

Do not show this before the learner answers:

> Check whether the response completes the one requested writing move and makes the key relationship or language choice visible. Every step must use only the activity information, leave no necessary link for the reader to guess, and add no outside fact.

## Evaluate A Response

Judge only the requested writing move as `resolved`, `partial`, or `not_resolved`.

- `evidenceQuote` is one exact contiguous substring of the response, or empty only when the response is empty/off target.
- `observedMoves` contains zero to five learner-expressed paths or decisions. Each has `text` and one status: `reaches_target`, `stops_early`, `adjacent_outcome`, `unsupported`, or `off_target`.
- `missingLinks` names every necessary missing step referred to in the feedback. It is empty only for `resolved`.
- `nextAction` is `next` for `resolved`, otherwise `retry`.

Never refer to “two reasons” or another count without enumerating each one. Distinguish a path reaching the requested outcome from a neighboring outcome. Give no score and no replacement sentence.

## Graduated Support

Generate only the next unused level:

1. `direction`: point attention to the missing relationship without supplying it.
2. `thinking_frame`: provide questions or empty slots the learner must fill.
3. `parallel_example`: use a different fictional topic to demonstrate the move without solving the active item.

Keep support concise and non-copy-ready.
