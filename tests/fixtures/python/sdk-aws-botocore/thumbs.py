import aioboto3


async def save_thumb(name: str, data: bytes):
    session = aioboto3.Session()
    async with session.client("s3") as s3:
        await s3.put_object(Bucket="ferndale-thumbs", Key=name, Body=data)
