package com.example.volumes;

import static jakarta.ws.rs.HttpMethod.DELETE;
import static jakarta.ws.rs.HttpMethod.GET;
import static jakarta.ws.rs.HttpMethod.POST;

import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.Entity;
import jakarta.ws.rs.client.Invocation;
import jakarta.ws.rs.client.WebTarget;

/** Overloaded wrappers: each call runs the one its arguments fit. */
class Volumes {
    private final Client client = ClientBuilder.newClient();
    private final WebTarget base = client.target("https://api.example-volumes.com/v1");

    String inspect(String name) {
        final WebTarget resource = base.path("volumes").path(name);
        return request(GET, String.class, resource, resource.request());
    }

    void remove(String name) {
        final WebTarget resource = base.path("volumes").path(name);
        request(DELETE, resource, resource.request());
    }

    String create(Volume volume) {
        final WebTarget resource = base.path("volumes").path("create");
        return request(POST, String.class, resource, resource.request(), Entity.json(volume));
    }

    String label(String name) {
        return tag(name, "archived");
    }

    String count(String name) {
        return tag(name, 3);
    }

    private <T> T request(String method, Class<T> type, WebTarget resource, Invocation.Builder request) {
        return request.method(method, type);
    }

    private void request(String method, WebTarget resource, Invocation.Builder request) {
        request.method(method, String.class);
    }

    private <T> T request(String method, Class<T> type, WebTarget resource, Invocation.Builder request, Entity<?> entity) {
        return request.method(method, entity, type);
    }

    // same count, told apart by the literal's type
    private String tag(String name, String label) {
        return base.path("volumes").path(name).path("labels").path(label).request().put(Entity.text(label), String.class);
    }

    private String tag(String name, int times) {
        return base.path("volumes").path(name).path("hits").request().get(String.class);
    }
}

class Volume {
    String name;
    String driver;
}
