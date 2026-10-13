package com.example.notes.di

import com.example.notes.api.NotesApi
import dagger.Module
import dagger.Provides
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

// the project's only Retrofit.Builder: the Retrofit injected below is this one
@Module
object NetworkModule {
    @Provides
    fun retrofit(client: OkHttpClient): Retrofit = Retrofit.Builder()
        // a comment between the steps of the chain
        .baseUrl("https://api.example-notes.com/v1/")
        .client(client) /* the client comes from the graph */
        .addConverterFactory(MoshiConverterFactory.create())
        .build()

    @Provides
    fun notes(retrofit: Retrofit): NotesApi = retrofit.create(NotesApi::class.java)
}
