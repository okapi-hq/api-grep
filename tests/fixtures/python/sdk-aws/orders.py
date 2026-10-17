import boto3

dynamodb = boto3.resource("dynamodb", region_name="eu-west-1")
parcels = dynamodb.Table("parcels")
ddb = boto3.client("dynamodb")


def save(parcel):
    parcels.put_item(Item=parcel)
    with parcels.batch_writer() as batch:
        batch.put_item(Item=parcel)
    return ddb.get_item(TableName="parcels", Key={"id": {"S": parcel["id"]}})


def pending(courier):
    return parcels.query(KeyConditionExpression="courier = :c", ExpressionAttributeValues={":c": courier})


class Mailer:
    def __init__(self):
        self._client = None

    def _get_client(self):
        if self._client is None:
            self._client = boto3.client("ses", region_name="eu-west-1")
        return self._client

    def send(self, to):
        client = self._get_client()
        return client.send_email(
            Source="depot@example.com",
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": "Your parcel"}, "Body": {"Text": {"Data": "On its way"}}},
        )
