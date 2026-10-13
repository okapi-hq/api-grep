package com.example.inventory;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/** A JAX-RS resource this service serves: its methods are endpoints, not requests it sends. */
@Path("/stock")
public class StockResource {
    private final Map<String, Integer> counts;
    private final Client client;

    StockResource(Map<String, Integer> counts, Client client) {
        this.counts = counts;
        this.client = client;
    }

    @GET
    @Path("/{sku}")
    public Response get(@PathParam("sku") String sku) {
        return Response.ok(counts.get(sku)).build();
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    public Response post(Item item) {
        counts.put(item.sku, item.quantity);
        return Response.status(201).entity(item).build();
    }

    String setting(String key) {
        return String.valueOf(client.getConfiguration().getProperties().get(key));
    }
}
