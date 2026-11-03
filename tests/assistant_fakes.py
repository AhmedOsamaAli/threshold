"""A model for the assistant's tests: an OpenAI-compatible endpoint that answers from a script, one step per request that
carries tools, and records what it was sent. Requests without tools (the campaign drafts) get the empty JSON the rules turn
into words, as in tests.account_fakes, and do not use up the script. When the script runs out the model is "down" (HTTP
500), so a test can also check what the assistant does without one."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx

from app.llm import LLM


@dataclass
class Step:
    text: str | None = None
    calls: list[tuple[str, dict]] = field(default_factory=list)


def say(text: str) -> Step:
    """The model answers in words."""
    return Step(text=text)


def call(*calls: tuple[str, dict]) -> Step:
    """The model calls these tools (together, as models do) and waits for their results."""
    return Step(calls=list(calls))


def use(name: str, **arguments) -> tuple[str, dict]:
    return name, arguments


def completion(message: dict, reason: str = "stop") -> httpx.Response:
    return httpx.Response(200, json={
        "id": "x", "object": "chat.completion", "created": 0, "model": "test-model",
        "choices": [{"index": 0, "finish_reason": reason, "message": message}],
    })


class ScriptedModel:
    def __init__(self, *steps: Step) -> None:
        self.steps = list(steps)
        self.requests: list[dict] = []  # the conversations it was asked to continue, with their tools
        self.drafts = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if not body.get("tools"):
            self.drafts += 1
            return completion({"role": "assistant", "content": "{}"})
        self.requests.append(body)
        if not self.steps:
            return httpx.Response(500, json={"error": {"message": "the model is down", "type": "server_error"}})
        step = self.steps.pop(0)
        if step.text is not None:
            return completion({"role": "assistant", "content": step.text})
        calls = [{"id": f"call_{len(self.requests)}_{n}", "type": "function",
                  "function": {"name": name, "arguments": json.dumps(arguments)}} for n, (name, arguments) in enumerate(step.calls)]
        return completion({"role": "assistant", "content": None, "tool_calls": calls}, "tool_calls")

    def llm(self) -> LLM:
        return LLM("test-key", "https://llm.test/v1/", "test-model",
                   http_client=httpx.AsyncClient(transport=httpx.MockTransport(self)))

    def sent(self) -> str:
        """Everything the model was ever sent, as one text, to check what it never saw."""
        return json.dumps(self.requests)

    def tool_results(self) -> list[dict]:
        """The results of tools that were handed back to the model, in order."""
        found = []
        for body in self.requests:
            for message in body["messages"]:
                if message["role"] == "tool":
                    found.append(json.loads(message["content"]))
        return found
