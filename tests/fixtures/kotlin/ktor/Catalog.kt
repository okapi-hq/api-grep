package com.example.catalog

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.URLProtocol
import io.ktor.http.contentType

data class NewItem(val name: String, val price: Int?)

class Items(private val http: HttpClient, private val token: String) {
    suspend fun list() {
        val res = http.get("https://api.example-catalog.com/v1/items") {
            parameter("limit", 20)
            header("Authorization", "Bearer $token")
        }
    }

    suspend fun create(name: String) = http.post("https://api.example-catalog.com/v1/items") { setBody(NewItem(name, null)) }

    suspend fun categories() = http.get {
        url {
            protocol = URLProtocol.HTTPS
            host = "api.example-catalog.com"
            path("v1", "categories")
            parameters.append("page_size", "50")
        }
    }
}

class Notion(private val token: String) {
    private val client = HttpClient(CIO) {
        defaultRequest {
            url("https://api.notion.com/v1/")
            header("Notion-Version", "2022-06-28")
        }
    }

    suspend fun page(id: String) = client.get("pages/$id") { bearerAuth(token) }

    suspend fun search(query: String) = client.post {
        url("search")
        contentType(ContentType.Application.Json)
        setBody(mapOf("query" to query))
    }

    suspend fun archive(id: String) = client.request("blocks/$id") {
        method = HttpMethod.Delete
        bearerAuth(token)
    }
}

class Feeds(private val http: HttpClient) {
    suspend fun latest() = http.get(urlString = "https://feeds.example.com/v2/latest.json")
}
