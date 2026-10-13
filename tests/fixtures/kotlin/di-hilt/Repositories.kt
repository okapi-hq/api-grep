package com.example.shelf.net

import javax.inject.Inject
import javax.inject.Named
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

class TokenStore @Inject constructor() {
    fun token(): String = "stored"
}

class AuthInterceptor @Inject constructor(private val tokens: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer ${tokens.token()}")
            .build()
        return chain.proceed(request)
    }
}

// the client is injected by its type: the provided one, with its interceptor
class CoversRepository @Inject constructor(private val client: OkHttpClient) {
    fun cover(id: String) = client.newCall(Request.Builder().url("https://covers.shelf-example.com/v1/covers/$id").build()).execute()
}

// a named client
class UploadsRepository @Inject constructor(@Named("uploads") private val client: OkHttpClient) {
    fun upload(json: String) = client.newCall(
        Request.Builder()
            .url("https://uploads.shelf-example.com/v1/files")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build(),
    ).execute()
}

// a field the container sets
class StatsWorker {
    @Inject
    lateinit var client: OkHttpClient

    fun ping() = client.newCall(Request.Builder().url("https://stats.shelf-example.com/v1/ping").build()).execute()
}
