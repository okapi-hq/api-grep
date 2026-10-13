package com.example.notes.api

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.Path

class Note(val id: String, val text: String)

interface NotesApi {
    @GET("notes/{id}")
    suspend fun note(@Path("id") id: String): Note

    // a Content-Type in @Headers replaces the converter's
    @Headers("Content-Type: application/x-protobuf")
    @POST("notes/sync")
    suspend fun sync(@Body batch: Note)
}
