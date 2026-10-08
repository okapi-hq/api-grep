from notion_client import Client

notion = Client(auth="secret")


def page(page_id: str):
    return notion.pages.retrieve(page_id=page_id)
