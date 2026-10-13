package com.example.covers

import okhttp3.OkHttpClient
import okhttp3.Request.Builder

// `Builder` imported from `okhttp3.Request`: the request builder under its short name.
class CoverFetcher(private val client: OkHttpClient) {
    fun fetch(bookId: String) {
        val request = Builder()
            .url("https://covers.example.com/v1/covers/$bookId")
            .header("Accept", "image/webp")
            .build()
        client.newCall(request).execute()
    }
}
