from openai import OpenAI

from helpers import summarize


def nightly_digest(notes):
    llm = OpenAI()
    return summarize(llm, notes)


def weekly_report(notes):
    return summarize(OpenAI(timeout=30), notes)
