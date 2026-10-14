package com.example.comics

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import okhttp3.OkHttpClient
import okhttp3.Request
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import uy.kohesive.injekt.injectLazy

class ChapterSource {
    private val client: OkHttpClient by injectLazy()

    fun chapter(id: String) = client.newCall(Request.Builder().url("https://cdn.comics-example.com/chapters/$id").build()).execute()
}

class SeriesSource {
    private val api = Injekt.get<HttpClient>()

    suspend fun series(id: String) = api.get("series/$id")
}
