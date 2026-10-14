package com.example.notes.di

import com.example.notes.api.NotesApi
import dagger.Lazy
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import javax.inject.Singleton
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class Authed

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    @Authed
    fun authedClient(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer notes-token").build()) }
        .build()

    @Provides
    fun retrofitBuilder(): Retrofit.Builder = Retrofit.Builder().addConverterFactory(GsonConverterFactory.create())

    // the client is created on the first call: Retrofit gets it through a call factory
    @Provides
    @Singleton
    fun retrofit(builder: Retrofit.Builder, @Authed client: Lazy<OkHttpClient>): Retrofit =
        builder.baseUrl("https://api.notes-example.com/v1/").callFactory { request -> client.get().newCall(request) }.build()

    @Provides
    fun notesApi(retrofit: Retrofit): NotesApi = retrofit.create(NotesApi::class.java)
}
