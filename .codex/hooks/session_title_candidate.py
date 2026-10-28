#!/usr/bin/env python3
"""Ask Codex to set one stable searchable title for a new session.

The hook deliberately does not classify user work with keyword rules. Instead,
it asks the active Codex model, which has the full task context, to set a
title after completing the first substantive task. It never reads the
transcript or mutates local Codex storage. It stores only a hash of the session
ID in a temporary directory, so later turns are not instructed to retitle.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


STATE_DIRECTORY_NAME = "codex-session-title-once-v2"
MAX_STATE_AGE_SECONDS = 30 * 24 * 60 * 60
TITLE_GUIDANCE = """这是一个新会话的首次请求。请先正常完成用户的首个实质任务；在发送最终答复前，调用当前可用的 set_thread_title 会话改名工具，修改当前会话的真实侧边栏标题。

命名规则：
1. 根据本轮完整语义判断，不要靠关键词拼接。
2. 模块名使用用户可理解的产品功能、业务领域或代码模块名。
3. 第二部分写持续目标，而不是当前步骤；它应覆盖后续的排查、修复、测试和提交，便于将来搜索。
4. 不要使用“实现”“处理需求”“优化”“问题”等空泛词；优先保留具体对象、行为、错误现象或决策。
5. 标题总长度不超过 24 个中文字符；格式固定为“模块名｜持续目标”。
6. 本会话后续追问不得再次改名，即使任务进入排查、修复、测试或提交阶段。
7. 不要在最终答复中展示标题建议或解释这条命名要求。若当前运行环境没有改名工具，正常完成任务即可。"""


def state_directory() -> Path:
    configured = os.environ.get("CODEX_TITLE_SUGGESTION_STATE_DIR")
    if configured:
        return Path(configured)
    return Path(tempfile.gettempdir()) / STATE_DIRECTORY_NAME


def marker_path(session_id: str) -> Path:
    digest = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return state_directory() / digest


def remove_expired_markers(directory: Path, now: float) -> None:
    for marker in directory.iterdir():
        if not marker.is_file():
            continue
        try:
            if now - marker.stat().st_mtime > MAX_STATE_AGE_SECONDS:
                marker.unlink()
        except OSError:
            continue


def claim_first_suggestion(session_id: str) -> bool:
    directory = state_directory()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    remove_expired_markers(directory, time.time())
    marker = marker_path(session_id)
    try:
        marker.touch(exist_ok=False)
        return True
    except FileExistsError:
        return False


def read_event() -> dict[str, Any] | None:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return None
    return event if isinstance(event, dict) else None


def main() -> int:
    event = read_event()
    if not event:
        return 0

    session_id = event.get("session_id")
    prompt = event.get("prompt")
    if not isinstance(session_id, str) or not isinstance(prompt, str):
        return 0

    if not prompt.strip() or not claim_first_suggestion(session_id):
        return 0

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": TITLE_GUIDANCE,
                }
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # A convenience hook must never interrupt the user's real task.
        raise SystemExit(0)
