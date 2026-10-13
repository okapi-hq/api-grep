package com.example.notes.api;

import java.util.List;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.Query;

// a Retrofit interface declared in Java, created and called from Kotlin
public interface NotesApi {
    @GET("notes")
    Call<List<Note>> list(@Query("folder") String folder);

    @POST("notes")
    Call<Note> create(@Body Note note);

    record Note(String title, String body) {}
}
