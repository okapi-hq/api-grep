from urllib.request import urlretrieve


def download(name):
    return urlretrieve(f"https://cdn.example-weather.com/maps/{name}.png", name)
