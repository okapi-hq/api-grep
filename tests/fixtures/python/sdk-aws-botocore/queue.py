import botocore.session
from botocore.exceptions import ClientError


def enqueue(body: str):
    sqs = botocore.session.get_session().create_client("sqs", region_name="us-east-2")
    try:
        sqs.send_message(QueueUrl="https://sqs.us-east-2.amazonaws.com/000000000000/ferndale", MessageBody=body)
    except ClientError:
        pass


def alert(subject: str, text: str):
    ses = botocore.session.Session().create_client("ses", region_name="us-east-2")
    ses.send_email(
        Source="alerts@ferndale.dev",
        Destination={"ToAddresses": ["ops@ferndale.dev"]},
        Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": text}}},
    )
