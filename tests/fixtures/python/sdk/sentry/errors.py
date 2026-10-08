import sentry_sdk
from sentry_sdk import capture_message

sentry_sdk.init(dsn="https://public@o0.ingest.sentry.io/0", traces_sample_rate=0.1)


def report(err: Exception):
    sentry_sdk.capture_exception(err)


def warn(msg: str):
    capture_message(msg, level="warning")


def track(err: Exception):
    report(err)
