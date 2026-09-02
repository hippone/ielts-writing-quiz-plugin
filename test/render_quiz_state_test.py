import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "skills" / "ielts-writing-quiz" / "scripts" / "render_quiz_state.py"
SPEC = importlib.util.spec_from_file_location("render_quiz_state", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def state(kind="question"):
    feedback = None
    if kind == "feedback":
        feedback = {
            "outcome": "partial",
            "evidenceQuote": "更多人到馆",
            "observedMoves": [
                {"text": "更多居民能够到馆", "status": "stops_early"},
                {"text": "馆内阅读时间增加", "status": "adjacent_outcome"},
            ],
            "missingLinks": ["两条路径都没有到达课程报名增加。"],
            "nextAction": "retry",
        }
    return {
        "schemaVersion": "quiz_session.v1",
        "sessionId": "qs_test",
        "revision": 3,
        "state": kind,
        "locale": "zh",
        "taskType": "task2",
        "progress": {"current": 1, "total": 3},
        "currentItem": None if kind == "complete" else {
            "id": "q1",
            "difficulty": "medium",
            "blocker": "补全推理",
            "evidenceQuote": "延长开放时间",
            "question": "虚构场景：中心延长开放。已知信息：到访人数增加。你的任务：补出报名增加前的一步推理。",
            "assistLevel": 1 if kind == "hint" else 0,
            "support": {"level": 1, "kind": "direction", "text": "关注到访后的行为。"} if kind == "hint" else None,
            "draftResponse": "我的草稿",
            "feedback": feedback,
            "attemptCount": 1 if feedback else 0,
        },
    }


class RenderQuizStateTest(unittest.TestCase):
    def test_renders_inline_question_action_without_private_fields(self):
        output = MODULE.render(state("question"))
        self.assertNotIn("<!doctype", output.lower())
        self.assertIn("sendFollowUpMessage", output)
        self.assertIn("navigator.clipboard", output)
        self.assertIn("document.execCommand", output)
        self.assertIn('data-action="submit_answer"', output)
        self.assertIn('data-action="request_hint"', output)
        self.assertNotIn("privateChecklist", output)

    def test_renders_hint_with_preserved_draft(self):
        output = MODULE.render(state("hint"))
        self.assertIn("关注到访后的行为。", output)
        self.assertIn("我的草稿", output)

    def test_renders_enumerated_feedback_and_only_retry(self):
        output = MODULE.render(state("feedback"))
        self.assertIn("更多居民能够到馆", output)
        self.assertIn("馆内阅读时间增加", output)
        self.assertIn('data-action="retry"', output)
        self.assertNotIn('data-action="next"', output)

    def test_complete_has_no_action(self):
        output = MODULE.render(state("complete"))
        self.assertIn("本组练习已完成", output)
        self.assertNotIn("data-action=", output)


if __name__ == "__main__":
    unittest.main()
