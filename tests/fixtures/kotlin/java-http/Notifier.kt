package com.example.alerts

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

class Notifier(private val http: HttpClient, private val token: String) {
    fun create(json: String) {
        val req = HttpRequest.newBuilder(URI.create("https://api.example-alerts.com/v1/items?limit=20"))
            .header("Authorization", "Bearer " + token)
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build()
        http.send(req, HttpResponse.BodyHandlers.ofString())
    }

    fun incidents(): String {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("https://api.pagerduty.com/incidents"))
            .headers("Accept", "application/json", "Authorization", "Token token=$token")
            .GET()
            .build()
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString()).body()
    }

    fun resolve(id: String, body: String) {
        val req = HttpRequest.newBuilder(URI.create("https://api.pagerduty.com/incidents/$id"))
            .method("PUT", HttpRequest.BodyPublishers.ofString(body))
            .build()
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding())
    }
}

object Legacy {
    fun post(payload: String): Int {
        val conn = URL("https://events.pagerduty.com/v2/enqueue").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.outputStream.use { it.write(payload.toByteArray()) }
        return conn.responseCode
    }

    fun status(): Int {
        val conn = URL("https://api.example-alerts.com/v1/status").openConnection() as HttpURLConnection
        return conn.responseCode
    }

    fun readBundled(): String {
        // a resource read through a URL connection is not a request
        val conn = javaClass.getResource("/defaults.json")!!.openConnection()
        return conn.getInputStream().bufferedReader().readText()
    }
}
