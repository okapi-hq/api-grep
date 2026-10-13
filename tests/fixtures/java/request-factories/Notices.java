package com.example.notices;

import io.vertx.core.Vertx;
import io.vertx.ext.auth.authentication.TokenCredentials;
import io.vertx.ext.web.client.WebClient;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;
import org.asynchttpclient.AsyncHttpClient;
import org.asynchttpclient.BoundRequestBuilder;
import org.asynchttpclient.Dsl;

/** Unirest's global configuration, a JAX-RS filter, Vert.x credentials and a request started in a switch. */
class Notices {
    private final AsyncHttpClient ahc = Dsl.asyncHttpClient();
    private final Client jaxrs;
    private final WebClient web = WebClient.create(Vertx.vertx());

    Notices(String key, String token) {
        Unirest.config().defaultBaseUrl("https://api.example-notices.com").setDefaultHeader("X-Api-Key", key);
        this.jaxrs = ClientBuilder.newBuilder().register(new TokenFilter(token)).build();
    }

    HttpResponse<JsonNode> list() {
        return Unirest.get("/v1/notices").asJson();
    }

    String archive(String id) {
        return jaxrs.target("https://archive.example-notices.com").path("v1").path(id).request().delete(String.class);
    }

    void publish(String token) {
        web.postAbs("https://push.example-notices.com/v1/publish").authentication(new TokenCredentials(token)).send();
    }

    Object relay(String verb, String url) {
        BoundRequestBuilder builder = switch (verb) {
            case "PUT" -> ahc.preparePut(url);
            default -> ahc.prepareGet(url);
        };
        return builder.execute();
    }
}

/** Adds the token to every request of the client it is registered on. */
class TokenFilter implements ClientRequestFilter {
    private final String token;

    TokenFilter(String token) {
        this.token = token;
    }

    @Override
    public void filter(ClientRequestContext context) {
        context.getHeaders().add("Authorization", "Bearer " + token);
    }
}
