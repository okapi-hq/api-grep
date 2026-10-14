package com.example.atlas

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

// headers set on every request, and some only for some URLs
class AtlasHeaders(private val agent: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val url = chain.request().url.toString()
        val builder = chain.request().newBuilder()
            .header("User-Agent", agent)
        if (url.contains("/tiles/")) {
            builder.header("Accept", "image/png")
        } else if (url.contains("/legends/")) {
            builder.header("Referer", "https://atlas.example.com/")
        }
        if (url.contains("/v2/")) {
            builder.header("X-Atlas-Mode", "v2")
        } else {
            builder.header("X-Atlas-Mode", "v1")
        }
        if (url.contains("/debug/")) builder.url(chain.request().url.newBuilder().addQueryParameter("trace", "1").build())
        return chain.proceed(builder.build())
    }
}

// a token added after an early return
class AtlasAuth(private val apiHost: String, private val token: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.url.host != apiHost) {
            return chain.proceed(request)
        }
        return chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

// a session read with `?: return`
class AtlasSession(private val store: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val session = store.session() ?: return chain.proceed(chain.request())
        return chain.proceed(chain.request().newBuilder().header("X-Atlas-Session", session).build())
    }
}

// a builder extension that sets the header in one branch, called in a branch
class AtlasLocale(private val allowed: List<String>, private val locale: () -> String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val next = if (allowed.any { request.url.host.endsWith(it) }) {
            request.newBuilder().headerIfNotEmpty("X-Atlas-Locale", locale()).build()
        } else {
            request
        }
        return chain.proceed(next)
    }

    private fun Request.Builder.headerIfNotEmpty(name: String, value: String): Request.Builder =
        if (value.isNotEmpty()) header(name, value) else this
}

interface TokenStore {
    fun session(): String?
    fun device(): String?
}

class AtlasClient(private val store: TokenStore) {
    private val http = OkHttpClient.Builder()
        .addInterceptor(AtlasHeaders("atlas-android"))
        .build()

    private val authed = OkHttpClient.Builder()
        .addInterceptor(AtlasAuth("atlas.example.com", "t0ken"))
        .addInterceptor(AtlasSession(store))
        .build()

    private val localized = OkHttpClient.Builder()
        .addInterceptor(AtlasLocale(listOf("atlas.example.com")) { "en-GB" })
        .addInterceptor { chain ->
            val builder = chain.request().newBuilder()
            store.device()?.let { builder.header("X-Device", it) }
            chain.proceed(builder.build())
        }
        .build()

    fun tiles(z: Int) = http.newCall(Request.Builder().url("https://atlas.example.com/tiles/$z").build()).execute()

    // the call sets the header itself: always sent
    fun legend(id: String) = http.newCall(
        Request.Builder().url("https://atlas.example.com/legends/$id").header("Referer", "https://atlas.example.com/").build(),
    ).execute()

    fun places() = authed.newCall(Request.Builder().url("https://atlas.example.com/places").build()).execute()

    fun labels() = localized.newCall(Request.Builder().url("https://atlas.example.com/labels").build()).execute()
}
