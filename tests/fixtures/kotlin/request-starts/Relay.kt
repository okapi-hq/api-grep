package com.example.relay

import kong.unirest.Unirest
import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpPost
import org.apache.http.client.methods.HttpRequestBase
import org.apache.http.impl.client.HttpClients
import org.asynchttpclient.Dsl

/** Requests started in a `when` or an `if`, and a request factory with two returns. */
class Relay(private val region: String?) {
    private val ahc = Dsl.asyncHttpClient()
    private val apache = HttpClients.createDefault()

    fun forward(verb: String, url: String): Any {
        val builder = when (verb) {
            "POST" -> ahc.preparePost(url)
            "DELETE" -> ahc.prepareDelete(url)
            else -> ahc.prepareGet(url)
        }
        builder.addHeader("X-Relay", "1")
        return builder.execute()
    }

    fun mirror(copy: Boolean, id: String) = (if (copy) Unirest.post("https://api.example-relay.com/v1/copies/$id") else Unirest.get("https://api.example-relay.com/v1/items/$id")).asString()

    fun ping(): Any = apache.execute(probe())

    // a region has its own host
    private fun probe(): HttpRequestBase {
        if (region != null) return HttpGet("https://$region.example-relay.com/ping")
        return HttpPost("https://api.example-relay.com/ping")
    }

    fun many(verb: String, url: String): Any {
        // more starts than are listed: one call, its method unknown
        val b = when (verb) {
            "POST" -> ahc.preparePost(url)
            "PUT" -> ahc.preparePut(url)
            "PATCH" -> ahc.preparePatch(url)
            "DELETE" -> ahc.prepareDelete(url)
            else -> ahc.prepareGet(url)
        }
        return b.execute()
    }
}
