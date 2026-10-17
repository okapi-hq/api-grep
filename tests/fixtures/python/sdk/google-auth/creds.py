import google.auth
from google.auth.transport.requests import Request
from google.oauth2 import id_token, service_account
from google.oauth2.credentials import Credentials

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def user_token(path: str) -> str:
    creds = Credentials.from_authorized_user_file(path, SCOPES)
    if not creds.valid:
        creds.refresh(Request())
    return creds.token


def robot_token(path: str) -> str:
    creds = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
    creds.refresh(Request())
    return creds.token


def who(token: str, client_id: str) -> str:
    return id_token.verify_oauth2_token(token, Request(), client_id)["email"]


def ambient() -> str:
    # a metadata server or a key file, decided at run time: not listed
    creds, _ = google.auth.default()
    creds.refresh(Request())
    return creds.token
