from contextlib import AsyncExitStack

from aiobotocore.session import AioSession, get_session


async def store_scan(scan_id: str, data: bytes):
    session = get_session()
    async with session.create_client("s3", region_name="eu-central-1") as s3:
        await s3.put_object(Bucket="ferndale-scans", Key=scan_id, Body=data)
        return await s3.get_object(Bucket="ferndale-scans", Key=scan_id)


async def record_scan(scan_id: str):
    async with AsyncExitStack() as stack:
        db = await stack.enter_async_context(AioSession().create_client("dynamodb", region_name="eu-central-1"))
        await db.put_item(TableName="ferndale-scans", Item={"id": {"S": scan_id}})


async def local_bucket(data: bytes):
    session = get_session()
    async with session.create_client("s3", endpoint_url="http://localhost:9000") as s3:
        await s3.put_object(Bucket="dev", Key="scan.bin", Body=data)
