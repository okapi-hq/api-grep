from dataclasses import dataclass, field, replace

import httpx

WEATHER = "https://api.example-weather.com"


@dataclass
class Upstream:
    base: str
    path: str
    method: str = "GET"
    headers: dict = field(default_factory=dict)


def call_upstream(call: Upstream):
    return httpx.request(call.method, call.base + call.path, headers=call.headers)


def with_trace(call: Upstream, trace_id: str):
    return call_upstream(replace(call, headers={"x-trace-id": trace_id}))


def forecast():
    return call_upstream(Upstream(base=WEATHER, path="/v1/forecast"))


def save_plan(trace_id: str):
    return with_trace(Upstream(WEATHER, "/v1/plans", "POST"), trace_id)
