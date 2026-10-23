from azure.identity.aio import ClientSecretCredential
from kiota_abstractions.base_request_configuration import RequestConfiguration
from msgraph import GraphServiceClient
from msgraph.generated.models.message import Message
from msgraph.generated.users.item.send_mail.send_mail_post_request_body import SendMailPostRequestBody
from msgraph.generated.users.users_request_builder import UsersRequestBuilder

credential = ClientSecretCredential("tenant-id", "client-id", "client-secret")
client = GraphServiceClient(credential, ["https://graph.microsoft.com/.default"])


async def inbox(user_id):
    return await client.users.by_user_id(user_id).messages.get()


async def notify(subject):
    body = SendMailPostRequestBody(message=Message(subject=subject))
    await client.me.send_mail.post(body)


async def active_users():
    query = UsersRequestBuilder.UsersRequestBuilderGetQueryParameters(select=["displayName", "mail"], top=25, filter="accountEnabled eq true")
    config = RequestConfiguration(query_parameters=query)
    return await client.users.get(request_configuration=config)


async def group_members(group_id):
    return await client.groups.by_group_id(group_id).members.graph_user.get()


async def download(site_id, item_id):
    return await client.sites.by_site_id(site_id).drive.items.by_drive_item_id(item_id).content.get()


async def avatar():
    return await client.me.photo.content.get()


async def user_count():
    return await client.users.count.get()


async def changes():
    return await client.users.delta.get()


async def archive(message_id):
    await client.me.messages.by_message_id(message_id).delete()


async def next_page(link):
    return await client.users.with_url(link).get()
