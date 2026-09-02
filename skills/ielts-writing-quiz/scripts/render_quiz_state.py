#!/usr/bin/env python3
import argparse
import html
import json
from pathlib import Path


VALID_STATES = {"question", "hint", "feedback", "complete"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(data):
    require(data.get("schemaVersion") == "quiz_session.v1", "schemaVersion must be quiz_session.v1")
    require(data.get("state") in VALID_STATES, "unsupported state")
    require(isinstance(data.get("sessionId"), str) and data["sessionId"], "sessionId is required")
    require(isinstance(data.get("revision"), int) and data["revision"] > 0, "revision must be positive")
    progress = data.get("progress")
    require(isinstance(progress, dict), "progress is required")
    require(isinstance(progress.get("current"), int) and isinstance(progress.get("total"), int), "progress is invalid")
    if data["state"] != "complete":
        item = data.get("currentItem")
        require(isinstance(item, dict), "currentItem is required")
        for field in ("id", "difficulty", "blocker", "evidenceQuote", "question"):
            require(isinstance(item.get(field), str), f"currentItem.{field} is required")


def esc(value):
    return html.escape(str(value), quote=True)


def feedback_markup(feedback, locale):
    labels = {
        "zh": {"resolved": "已完成本题动作", "partial": "部分完成", "not_resolved": "还没有完成"},
        "en": {"resolved": "Target move completed", "partial": "Partly completed", "not_resolved": "Not completed yet"},
    }[locale]
    outcome = feedback.get("outcome", "not_resolved")
    moves = "".join(
        f'<li><span>{esc(move.get("text", ""))}</span><small>{esc(move.get("status", ""))}</small></li>'
        for move in feedback.get("observedMoves", [])
    ) or f'<li class="text-muted">{"没有识别到与目标相关的完整路径。" if locale == "zh" else "No target-relevant move was identified."}</li>'
    missing = "".join(f"<li>{esc(link)}</li>" for link in feedback.get("missingLinks", []))
    evidence = feedback.get("evidenceQuote", "")
    return f"""
      <section class="quiz-section">
        <div class="quiz-eyebrow text-small">{esc(labels.get(outcome, outcome))}</div>
        {f'<blockquote>“{esc(evidence)}”</blockquote>' if evidence else ''}
      </section>
      <section class="quiz-section">
        <h2>{'你已经写出的路径' if locale == 'zh' else 'Moves you expressed'}</h2>
        <ol class="quiz-moves">{moves}</ol>
      </section>
      {f'<section class="quiz-section"><h2>{"还缺的连接" if locale == "zh" else "Missing links"}</h2><ul class="quiz-missing">{missing}</ul></section>' if missing else ''}
    """


def render(data):
    validate(data)
    locale = data.get("locale") if data.get("locale") in {"zh", "en"} else "zh"
    state = data["state"]
    progress = data["progress"]
    item = data.get("currentItem") or {}
    context = {
        "version": "quiz_action.v1",
        "sessionId": data["sessionId"],
        "expectedRevision": data["revision"],
        "itemId": item.get("id"),
    }
    json_context = json.dumps(context, ensure_ascii=False).replace("</", "<\\/")

    if state == "complete":
        body = f"""
          <section class="quiz-complete">
            <h1>{'本组练习已完成' if locale == 'zh' else 'Quiz complete'}</h1>
            <p>{'你完成了所有指定写作动作。本卡不提供分数。' if locale == 'zh' else 'You completed every targeted writing move. This card does not assign a score.'}</p>
          </section>
        """
    elif state == "feedback":
        feedback = item.get("feedback") or {}
        action = "next" if feedback.get("outcome") == "resolved" else "retry"
        action_label = ("下一题" if action == "next" else "再试一次") if locale == "zh" else ("Next question" if action == "next" else "Try again")
        body = feedback_markup(feedback, locale) + f"""
          <div class="quiz-actions"><button type="button" data-action="{action}" class="btn btn-primary">{action_label}</button></div>
          <p id="status" class="quiz-status text-small" aria-live="polite"></p>
        """
    else:
        support = item.get("support") if state == "hint" else None
        support_html = ""
        if support:
            support_html = f"""
              <section class="quiz-section quiz-support">
                <div class="quiz-eyebrow text-small">{'提示' if locale == 'zh' else 'Support'} · {esc(support.get('level', ''))}/3</div>
                <p>{esc(support.get('text', ''))}</p>
              </section>
            """
        can_hint = int(item.get("assistLevel", 0)) < 3
        hint_button = f'<button type="button" data-action="request_hint" class="btn">{"给我一个提示" if locale == "zh" else "Give me a hint"}</button>' if can_hint else ""
        body = f"""
          <section class="quiz-section">
            <div class="quiz-eyebrow text-small">{'针对的问题' if locale == 'zh' else 'Target move'}</div>
            <p>{esc(item.get('blocker', ''))}</p>
            <blockquote>“{esc(item.get('evidenceQuote', ''))}”</blockquote>
          </section>
          <section class="quiz-section"><h1 class="quiz-question">{esc(item.get('question', ''))}</h1></section>
          {support_html}
          <label class="form-label" for="answer">{'你的回答' if locale == 'zh' else 'Your response'}</label>
          <textarea class="form-control" id="answer" maxlength="6000" placeholder="{'写出本题要求的一步即可' if locale == 'zh' else 'Write only the requested move'}">{esc(item.get('draftResponse', ''))}</textarea>
          <div class="quiz-actions">{hint_button}<button type="button" data-action="submit_answer" class="btn btn-primary">{'提交回答' if locale == 'zh' else 'Submit'}</button></div>
          <p id="status" class="quiz-status text-small" aria-live="polite"></p>
        """

    return f"""<div id="ielts-quiz-session" class="card">
<style>
#ielts-quiz-session .quiz-top {{ display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:18px; }}
#ielts-quiz-session .quiz-brand {{ font-weight:500; letter-spacing:.04em; }}
#ielts-quiz-session .quiz-section {{ margin:16px 0; }}
#ielts-quiz-session .quiz-eyebrow {{ margin-bottom:8px; font-weight:500; color:var(--blue); }}
#ielts-quiz-session .quiz-question {{ margin:0; font-weight:500; }}
#ielts-quiz-session blockquote {{ margin:10px 0 0; padding-left:12px; border-left:3px solid var(--border); color:var(--muted-foreground); }}
#ielts-quiz-session .quiz-support {{ padding:12px 0; border-block:1px solid var(--border); }}
#ielts-quiz-session .quiz-moves, #ielts-quiz-session .quiz-missing {{ margin:0; padding-left:22px; }}
#ielts-quiz-session li {{ margin:8px 0; }}
#ielts-quiz-session .quiz-moves small {{ display:block; color:var(--muted-foreground); }}
#ielts-quiz-session .quiz-actions {{ display:flex; justify-content:flex-end; gap:10px; margin-top:14px; flex-wrap:wrap; }}
#ielts-quiz-session .quiz-status {{ min-height:1.3em; margin-top:9px; text-align:right; color:var(--muted-foreground); }}
#ielts-quiz-session .quiz-complete {{ text-align:center; padding:24px 8px; }}
@media (max-width:520px) {{ #ielts-quiz-session .quiz-actions {{ flex-direction:column-reverse; }} #ielts-quiz-session .quiz-actions .btn {{ width:100%; }} }}
</style>
<header class="quiz-top"><span class="quiz-brand">IELTS WRITING QUIZ</span><span class="text-muted tabular-nums">{progress['current']} / {progress['total']}</span></header>
  {body}
</div>
<script>
const context = {json_context};
const quizRoot = document.getElementById("ielts-quiz-session");
const statusNode = quizRoot.querySelector("#status");
const buttons = [...quizRoot.querySelectorAll("button[data-action]")];
function eventId() {{
  return globalThis.crypto?.randomUUID?.() || `evt_${{Date.now()}}_${{Math.random().toString(16).slice(2)}}`;
}}
function buildAction(action) {{
  const payload = {{ ...context, action, eventId: eventId() }};
  const answer = quizRoot.querySelector("#answer");
  if (answer && action === "submit_answer") payload.learnerResponse = answer.value.trim();
  if (answer && action === "request_hint") payload.draftResponse = answer.value;
  return payload;
}}
async function send(action) {{
  const payload = buildAction(action);
  if (action === "submit_answer" && !payload.learnerResponse) {{
    statusNode.textContent = {json.dumps('请先写下你的回答。' if locale == 'zh' else 'Write your response first.', ensure_ascii=False)};
    return;
  }}
  const prompt = `$ielts-writing-quiz\n\n<quiz_action>\n${{JSON.stringify(payload)}}\n</quiz_action>`;
  if (!window.openai || typeof window.openai.sendFollowUpMessage !== "function") {{
    try {{
      if (navigator.clipboard?.writeText) {{
        await navigator.clipboard.writeText(prompt);
      }} else {{
        const copyNode = document.createElement("textarea");
        copyNode.value = prompt;
        copyNode.setAttribute("readonly", "");
        copyNode.style.position = "fixed";
        copyNode.style.opacity = "0";
        document.body.appendChild(copyNode);
        copyNode.select();
        if (!document.execCommand("copy")) throw new Error("copy unavailable");
        copyNode.remove();
      }}
      statusNode.textContent = {json.dumps('操作消息已复制，请粘贴到对话中发送。' if locale == 'zh' else 'Action copied. Paste it into chat to continue.', ensure_ascii=False)};
    }} catch (error) {{
      statusNode.textContent = prompt;
    }}
    return;
  }}
  buttons.forEach(button => button.disabled = true);
  statusNode.textContent = {json.dumps('正在发送…' if locale == 'zh' else 'Sending…', ensure_ascii=False)};
  try {{
    await window.openai.sendFollowUpMessage({{ prompt, title: {json.dumps('继续 IELTS Writing Quiz' if locale == 'zh' else 'Continue IELTS Writing Quiz', ensure_ascii=False)} }});
    statusNode.textContent = {json.dumps('已发送，请查看下一条回复。' if locale == 'zh' else 'Sent. See the next response.', ensure_ascii=False)};
  }} catch (error) {{
    buttons.forEach(button => button.disabled = false);
    statusNode.textContent = {json.dumps('发送失败，请重试。' if locale == 'zh' else 'Could not send. Try again.', ensure_ascii=False)};
  }}
}}
buttons.forEach(button => button.addEventListener("click", () => send(button.dataset.action)));
</script>
"""


def main():
    parser = argparse.ArgumentParser(description="Render a persisted IELTS quiz state as an interactive Codex card")
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_html", type=Path)
    args = parser.parse_args()
    data = json.loads(args.input_json.read_text(encoding="utf-8"))
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    args.output_html.write_text(render(data), encoding="utf-8")


if __name__ == "__main__":
    main()
