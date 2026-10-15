import logging

logger = logging.getLogger(__name__)

QUEUE = "https://sqs.us-east-1.amazonaws.com/your-account-id/jobs"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


def hint(token):
    print(f"Webhook: https://api.ledger-demo.io/v1/hooks/{token}")
    logger.warning("see https://api.ledger-demo.io/v1/limits")
