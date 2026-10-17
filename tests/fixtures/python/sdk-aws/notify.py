import boto3

session = boto3.Session(region_name="eu-west-1")
sqs = session.resource("sqs")
sns = boto3.client("sns")
mail = boto3.client("sesv2")
lambdas = boto3.client("lambda")


def enqueue(body):
    queue = sqs.get_queue_by_name(QueueName="parcel-events")
    queue.send_message(MessageBody=body)


def text(phone, body):
    return sns.publish(PhoneNumber=phone, Message=body)


def receipt(to):
    return mail.send_email(FromEmailAddress="depot@example.com", Destination={"ToAddresses": [to]}, Content={"Simple": {"Subject": {"Data": "Receipt"}, "Body": {"Text": {"Data": "Thanks"}}}})


def sender(name):
    return mail.get_email_identity(EmailIdentity=name)


def rebuild():
    # no registry for this service: no call
    return lambdas.invoke(FunctionName="rebuild-routes")
