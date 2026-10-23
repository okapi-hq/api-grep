import os

from google.cloud import aiplatform

churn = aiplatform.Endpoint("projects/lumen-press/locations/us-east1/endpoints/4417")


def score(rows):
    return churn.predict(instances=rows)


def rank(rows):
    return aiplatform.Endpoint("9921").predict(instances=rows, parameters={"top_k": 3})


def rank_from_env(rows):
    return aiplatform.Endpoint(os.environ["RANKER_ENDPOINT"]).predict(instances=rows)
