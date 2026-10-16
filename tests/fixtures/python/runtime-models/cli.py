import argparse

from openai import OpenAI

client = OpenAI()


def parse_args():
    parser = argparse.ArgumentParser(description="grade answers")
    models = parser.add_argument_group("models")
    models.add_argument("--judge-model", default="gpt-4.1")
    parser.add_argument("--grader", dest="grader_model", default="o4-mini")
    parser.add_argument("--rounds", type=int, default=3)
    return parser.parse_args()


def main():
    args = parse_args()
    client.chat.completions.create(model=args.judge_model, messages=[])
    client.chat.completions.create(model=args.grader_model, messages=[])
