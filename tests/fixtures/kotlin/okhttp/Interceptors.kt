package com.example.wallet

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class TokenInterceptor(private val token: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(request)
    }
}

object Weather {
    private val key = System.getenv("WEATHER_KEY")

    // every request of this client goes through the interceptor
    private val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val url = chain.request().url.newBuilder().addQueryParameter("apikey", key).build()
            chain.proceed(chain.request().newBuilder().url(url).build())
        }
        .build()

    fun forecast(city: String): String {
        val req = Request.Builder().url("https://api.open-meteo.com/v1/forecast?city=$city").build()
        return client.newCall(req).execute().body!!.string()
    }
}

class Repos(token: String) {
    private val http = OkHttpClient.Builder().addInterceptor(TokenInterceptor(token)).build()

    fun mine() = http.newCall(Request.Builder().url("https://api.github.com/user/repos").get().build()).execute()

    fun star(owner: String, repo: String) {
        val base = http.newBuilder().addNetworkInterceptor(object : Interceptor {
            override fun intercept(chain: Interceptor.Chain): Response =
                chain.proceed(chain.request().newBuilder().addHeader("X-GitHub-Api-Version", "2022-11-28").build())
        }).build()
        base.newCall(Request.Builder().url("https://api.github.com/user/starred/$owner/$repo").put(ByteArray(0).toRequestBody()).build()).execute()
    }
}
