import google_auth_oauthlib
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

LEGACY_CONFIG = {
    "installed": {
        "client_id": "000000000000-legacy.apps.googleusercontent.com",
        "client_secret": "not-a-real-secret",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://accounts.google.com/o/oauth2/token",
    }
}


def planner_login():
    flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES)
    return flow.run_local_server(port=0)


def legacy_login():
    flow = InstalledAppFlow.from_client_config(LEGACY_CONFIG, scopes=SCOPES)
    return flow.run_console()


def quick_login(client_id: str, client_secret: str):
    return google_auth_oauthlib.get_user_credentials(SCOPES, client_id, client_secret)
