package com.example.inventory;

import jakarta.ws.rs.HttpMethod;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.Entity;
import jakarta.ws.rs.client.Invocation;
import jakarta.ws.rs.client.WebTarget;
import jakarta.ws.rs.core.Form;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/** The JAX-RS client: targets, paths, query parameters, headers and entities. */
class Inventory {
    private static final String BASE = "https://api.example-stock.com";
    private final Client client = ClientBuilder.newClient();
    private final WebTarget items = client.target(BASE).path("v1").path("items");

    Response add(Item item, String token) {
        return items.queryParam("notify", true)
            .request(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + token)
            .post(Entity.json(item));
    }

    String count(String sku) {
        Response response = items.path("{sku}/count").resolveTemplate("sku", sku).request().get();
        // reading the response is not another request
        return response.getHeaders().get("X-Count").toString();
    }

    Response login(String user, String password) {
        Form form = new Form().param("username", user).param("password", password);
        return client.target("https://auth.example-stock.com/token").request().post(Entity.form(form));
    }

    Response restock(String sku, int quantity) {
        Invocation.Builder builder = items.path(sku).request(MediaType.APPLICATION_JSON_TYPE);
        builder.header("X-Warehouse", "north");
        return builder.method("PATCH", Entity.entity(new Restock(quantity), MediaType.APPLICATION_JSON));
    }

    void forget(String sku) {
        items.path(sku).request().async().delete();
    }

    Item fetch(String sku) {
        return send(HttpMethod.GET, Item.class, items.path(sku).request(MediaType.APPLICATION_JSON_TYPE));
    }

    // a request its callers build; the second argument is the response type, not an entity
    private <T> T send(String method, Class<T> type, Invocation.Builder request) {
        return request.method(method, type);
    }
}

class Item {
    String sku;
    int quantity;
}

class Restock {
    int quantity;

    Restock(int quantity) {
        this.quantity = quantity;
    }
}
