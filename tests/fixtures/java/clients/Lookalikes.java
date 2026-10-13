package com.example.alerts;

import io.vertx.core.Vertx;
import java.util.Map;
import java.util.concurrent.Executor;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;

/** Calls named like the clients' sends that send nothing. */
class Lookalikes {
    private final Executor executor;
    private final Vertx vertx = Vertx.vertx();

    Lookalikes(Executor executor) {
        this.executor = executor;
    }

    void later(Runnable task) {
        executor.execute(task);
    }

    void notifyWorkers(String message) {
        vertx.eventBus().send("workers", message);
    }

    String read(Map<String, String> cache, String key) {
        return cache.get(key);
    }

    String status() {
        HttpResponse<JsonNode> response = Unirest.get("https://api.example-alerts.com/v1/status").asJson();
        // the response's body, read as a string: not another request
        return response.getBody().toString() + Unirest.config().getDefaultBaseUrl();
    }
}
