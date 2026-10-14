package com.example.gallery.catalog

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.get
import io.ktor.client.request.head
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

fun OkHttpClient.fetchPage(page: Int): Response =
    newCall(Request.Builder().url("https://api.catalog-example.com/v1/items?page=$page").build()).execute()

fun OkHttpClient.fetchItem(id: String): Response =
    this.newCall(Request.Builder().url("https://api.catalog-example.com/v1/items/$id").header("Accept", "application/json").build()).execute()

suspend fun HttpClient.health(path: String): HttpResponse = get("https://status.catalog-example.com/$path")

suspend fun HttpClient.search(term: String): HttpResponse = get("https://search.catalog-example.com/v1/search") {
    parameter("q", term)
}

// the same name on another type: a Ktor client never runs the OkHttp one
fun OkHttpClient.health(path: String): Response = newCall(Request.Builder().url("https://status.catalog-example.com/legacy/$path").build()).execute()

class Cache {
    fun get(key: String): String? = null
}

// `with(cache)`: the lambda's receiver is the cache, so `get(...)` is not the client's
suspend fun HttpClient.cached(cache: Cache): String? = with(cache) { get("https://status.catalog-example.com/v1/cached") }

// a lambda without a receiver of its own: the extension's receiver is still the implicit one
suspend fun HttpClient.probe(url: String): HttpResponse = withContext(Dispatchers.IO) { head(url) }

class CatalogRepository {
    private val okHttp = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Catalog-Key", "demo-key").build()) }
        .build()
    private val ktor = HttpClient(CIO)

    fun second() = okHttp.fetchPage(2)

    fun item(id: String) = okHttp.fetchItem(id)

    suspend fun up() = ktor.health("v1/health")

    suspend fun find(term: String) = ktor.search(term)
}
