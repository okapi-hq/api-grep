package com.example.registry

import okhttp3.Credentials
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request

class Registry(private val user: String, private val password: String) {
    private val http = OkHttpClient()

    // basic auth written as a header value
    fun tags(image: String) {
        val request = Request.Builder()
            .url("https://registry.example.com/v2/$image/tags/list")
            .header("Authorization", Credentials.basic(user, password))
            .build()
        http.newCall(request).execute()
    }

    // kept in a variable, sent by an interceptor
    private val authed = OkHttpClient.Builder()
        .addInterceptor(Interceptor { chain ->
            val credentials = Credentials.basic(user, password)
            chain.proceed(chain.request().newBuilder().header("Authorization", credentials).build())
        })
        .build()

    fun catalog() = authed.newCall(Request.Builder().url("https://registry.example.com/v2/_catalog").build()).execute()
}
