package com.example.alerts;

import io.vertx.core.MultiMap;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.HttpRequest;
import io.vertx.ext.web.client.WebClient;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;
import org.asynchttpclient.AsyncHttpClient;
import org.asynchttpclient.Dsl;
import org.asynchttpclient.RequestBuilder;

/** AsyncHttpClient, Unirest and the Vert.x WebClient. */
class Alerts {
    private final AsyncHttpClient ahc = Dsl.asyncHttpClient();
    private final WebClient web = WebClient.create(Vertx.vertx());

    Object batch(String json) {
        return ahc.preparePost("https://api.example-alerts.com/v1/batches")
            .setHeader("Content-Type", "application/json")
            .addQueryParam("dry_run", "false")
            .setBody(json)
            .execute();
    }

    Object login(String user) {
        return ahc.preparePost("https://auth.example-alerts.com/token").addFormParam("username", user).addFormParam("grant_type", "password").execute();
    }

    Object silence(String id) {
        return ahc.executeRequest(new RequestBuilder("DELETE").setUrl("https://api.example-alerts.com/v1/silences/" + id).build());
    }

    HttpResponse<JsonNode> archive(String id, String key) {
        return Unirest.put("https://api.example-alerts.com/v1/alerts/{id}")
            .routeParam("id", id)
            .header("X-Api-Key", key)
            .queryString("force", true)
            .body(new JsonObject().put("archived", true))
            .asJson();
    }

    String subscribe(String email) {
        return Unirest.post("https://api.example-alerts.com/v1/subscribers").field("email", email).field("list", "weekly").asString().getBody();
    }

    void ping(String token) {
        web.post(443, "api.example-alerts.com", "/v1/events")
            .putHeader("X-Source", "worker")
            .bearerTokenAuthentication(token)
            .sendJsonObject(new JsonObject().put("type", "ping").put("count", 1));
    }

    void health() {
        HttpRequest<io.vertx.core.buffer.Buffer> request = web.getAbs("https://api.example-alerts.com/v1/health");
        request.addQueryParam("deep", "true");
        request.send();
    }

    void register(String name) {
        MultiMap form = MultiMap.caseInsensitiveMultiMap();
        form.add("name", name);
        web.post("api.example-alerts.com", "/v1/workers").sendForm(form);
    }

    Object forward(String verb, String url) {
        // a request started in several branches: its method is not known
        final org.asynchttpclient.BoundRequestBuilder builder;
        switch (verb) {
            case "POST":
                builder = ahc.preparePost(url);
                break;
            default:
                builder = ahc.prepareGet(url);
        }
        return builder.execute();
    }

    void search(String query) {
        // the default host, port and TLS of the client's options
        WebClient api = WebClient.create(Vertx.vertx(), new io.vertx.ext.web.client.WebClientOptions().setSsl(true).setDefaultHost("search.example-alerts.com").setDefaultPort(443));
        api.post("/v1/query").sendJson(new JsonObject().put("q", query));
    }
}
