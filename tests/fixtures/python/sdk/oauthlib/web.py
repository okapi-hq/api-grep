import os

from google_auth_oauthlib.flow import Flow

SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]


def start(redirect_uri: str) -> str:
    flow = Flow.from_client_secrets_file(os.environ["QUILLMARK_SECRETS"], scopes=SCOPES, redirect_uri=redirect_uri)
    # only builds the URL the browser opens: no request
    url, _state = flow.authorization_url(access_type="offline", prompt="consent")
    return url


def finish(redirect_uri: str, code: str):
    flow = Flow.from_client_secrets_file(os.environ["QUILLMARK_SECRETS"], scopes=SCOPES, redirect_uri=redirect_uri)
    flow.fetch_token(code=code)
    return flow.credentials
