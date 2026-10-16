from googleapiclient.discovery import build


def calendar_service(creds):
    return build("calendar", "v3", credentials=creds)


def book(creds, start: str, end: str):
    service = build("calendar", "v3", credentials=creds)
    event = {"summary": "Demo", "start": {"dateTime": start}, "end": {"dateTime": end}}
    return service.events().insert(calendarId="primary", body=event).execute()


def upcoming(creds, now: str):
    service = build("calendar", "v3", credentials=creds)
    request = service.events().list(calendarId="primary", timeMin=now, maxResults=10)
    return request.execute().get("items", [])


def search(api_key: str, cx: str, q: str):
    return build("customsearch", "v1", developerKey=api_key).cse().list(q=q, cx=cx).execute()


def promote(http, package: str, edit_id: str, track: dict):
    publisher = build("androidpublisher", "v3", http=http)
    publisher.edits().tracks().update(packageName=package, editId=edit_id, track="production", body=track).execute()
    return publisher.edits().commit(packageName=package, editId=edit_id).execute()


# a service the code does not name is no listed API
def other(creds):
    return build("bigquery", "v2", credentials=creds).datasets().list(projectId="p").execute()
