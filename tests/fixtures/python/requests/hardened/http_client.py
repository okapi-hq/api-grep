import requests_hardened

HTTPConfig = requests_hardened.Config(default_timeout=(2, 10), never_redirect=False)
HTTPClient = requests_hardened.Manager(HTTPConfig)
