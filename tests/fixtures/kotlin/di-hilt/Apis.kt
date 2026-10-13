package com.example.shelf.api

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

class Review(val bookId: String, val stars: Int)

interface CatalogApi {
    @GET("books/{id}")
    suspend fun book(@Path("id") id: String): String
}

interface ReviewsApi {
    @POST("reviews")
    suspend fun post(@Body review: Review)
}
