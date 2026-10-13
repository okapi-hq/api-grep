package com.example.catalog;

import static jakarta.ws.rs.HttpMethod.DELETE;
import static jakarta.ws.rs.HttpMethod.GET;

import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.Invocation;
import jakarta.ws.rs.client.WebTarget;

/** A JAX-RS target built by a factory with two returns, and methods given as static-imported constants. */
class Catalog {
    private final Client client = ClientBuilder.newClient();
    private final String version;

    Catalog(String version) {
        this.version = version;
    }

    String list() {
        final WebTarget resource = resource().path("items");
        return request(GET, String.class, resource.request());
    }

    void remove(String id) {
        final WebTarget resource = resource().path("items").path(id);
        request(DELETE, String.class, resource.request());
    }

    String stats() {
        return resource().path("stats").request().get(String.class);
    }

    // with a version, the path starts with it
    private WebTarget resource() {
        final WebTarget target = client.target("https://api.example-catalog.com");
        if (version != null) {
            return target.path(version);
        }
        return target;
    }

    private <T> T request(String method, Class<T> type, Invocation.Builder request) {
        return request.method(method, type);
    }
}
