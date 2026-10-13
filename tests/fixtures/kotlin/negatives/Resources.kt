package com.example.links

import javax.ws.rs.GET
import javax.ws.rs.POST
import javax.ws.rs.Path
import javax.ws.rs.PathParam

// a JAX-RS resource serves these endpoints: the same verb annotations as Retrofit, from another package
@Path("/links")
class LinksResource {
    @GET
    @Path("{id}")
    fun get(@PathParam("id") id: String): String = id

    @POST
    fun create(body: String): String = body
}

// an interface that is never given to a Retrofit `create(...)` and imports no Retrofit annotation
interface Shortener {
    @GET
    fun shorten(url: String): String
}
