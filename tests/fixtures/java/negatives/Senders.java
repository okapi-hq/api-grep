package com.example.links;

import io.vertx.core.Vertx;
import java.util.Map;
import java.util.concurrent.Executor;
import javax.ws.rs.client.Client;
import javax.ws.rs.client.ClientBuilder;
import org.apache.http.client.methods.HttpGet;

/** Calls named like the sends of HTTP clients, in files importing those clients, that send nothing. */
class Senders {
    private final Executor executor;
    private final Vertx vertx = Vertx.vertx();
    private final Client client = ClientBuilder.newClient();

    Senders(Executor executor) {
        this.executor = executor;
    }

    void later(Runnable task) {
        executor.execute(task);
    }

    void notifyWorkers(String message) {
        vertx.eventBus().send("workers", message);
    }

    String read(Map<String, String> cache, String key) {
        return cache.get(key) + client.getConfiguration().getProperties().get(key);
    }

    HttpGet draft(String url) {
        // built, never sent
        HttpGet get = new HttpGet(url);
        get.setHeader("Accept", "application/json");
        return get;
    }
}
