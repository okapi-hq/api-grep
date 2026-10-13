package com.example.uploads

import org.asynchttpclient.Dsl

/** A request started in a `when`, its body set after it: not the GET's. */
class Uploads {
    private val ahc = Dsl.asyncHttpClient()

    fun send(verb: String, url: String, payload: String): Any {
        val builder = when (verb) {
            "PUT" -> ahc.preparePut(url).addHeader("X-Mode", "replace")
            else -> ahc.prepareGet(url)
        }
        if (verb != "GET") builder.setBody(payload)
        return builder.execute()
    }
}
