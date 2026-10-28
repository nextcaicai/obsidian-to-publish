import importlib.util
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("session_title_candidate.py")
SPEC = importlib.util.spec_from_file_location("session_title_candidate", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SessionTitleCandidateTests(unittest.TestCase):
    def test_first_prompt_adds_one_time_sidebar_title_guidance_without_project_keywords(self):
        with tempfile.TemporaryDirectory() as state_dir:
            event = {"session_id": "session-1", "prompt": "修复 X 加粗内容上传"}
            stdout = StringIO()
            with patch.dict(
                os.environ,
                {"CODEX_TITLE_SUGGESTION_STATE_DIR": state_dir},
                clear=False,
            ), patch("sys.stdin", StringIO(json.dumps(event))), redirect_stdout(stdout):
                self.assertEqual(MODULE.main(), 0)

            output = json.loads(stdout.getvalue())["hookSpecificOutput"]
            self.assertEqual(output["hookEventName"], "UserPromptSubmit")
            self.assertIn("set_thread_title", output["additionalContext"])
            self.assertIn("模块名｜持续目标", output["additionalContext"])
            self.assertIn("后续追问不得再次改名", output["additionalContext"])
            self.assertNotIn("建议会话标题", output["additionalContext"])
            self.assertNotIn("Chrome Companion", output["additionalContext"])
            self.assertNotIn("X Articles", output["additionalContext"])

    def test_same_session_only_receives_the_guidance_once(self):
        with tempfile.TemporaryDirectory() as state_dir:
            event = {"session_id": "session-1", "prompt": "修复 X 加粗内容上传"}
            with patch.dict(
                os.environ,
                {"CODEX_TITLE_SUGGESTION_STATE_DIR": state_dir},
                clear=False,
            ), patch("sys.stdin", StringIO(json.dumps(event))), redirect_stdout(StringIO()):
                self.assertEqual(MODULE.main(), 0)

            stdout = StringIO()
            with patch.dict(
                os.environ,
                {"CODEX_TITLE_SUGGESTION_STATE_DIR": state_dir},
                clear=False,
            ), patch("sys.stdin", StringIO(json.dumps(event))), redirect_stdout(stdout):
                self.assertEqual(MODULE.main(), 0)
            self.assertEqual(stdout.getvalue(), "")

    def test_empty_prompt_does_not_add_guidance(self):
        with tempfile.TemporaryDirectory() as state_dir:
            event = {"session_id": "session-1", "prompt": " \n\t "}
            stdout = StringIO()
            with patch.dict(
                os.environ,
                {"CODEX_TITLE_SUGGESTION_STATE_DIR": state_dir},
                clear=False,
            ), patch("sys.stdin", StringIO(json.dumps(event))), redirect_stdout(stdout):
                self.assertEqual(MODULE.main(), 0)
            self.assertEqual(stdout.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
