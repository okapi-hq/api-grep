package com.example.sync.api

import retrofit2.Retrofit
import retrofit2.http.GET
import retrofit2.http.Query

interface SyncApi {
    @GET("status")
    suspend fun status(): String
}

interface ImagesApi {
    @GET("search")
    suspend fun search(@Query("q") query: String): String
}

object Images {
    val api: ImagesApi = Retrofit.Builder().baseUrl("https://api.example-images.com/").build().create(ImagesApi::class.java)
}
