package com.example.sync.di

import com.example.sync.api.SyncApi
import dagger.Module
import dagger.Provides
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

// a Retrofit.Builder the graph provides and its users finish: the injected Retrofit is the one built from it (#46),
// not the project's other one
@Module
object NetworkModule {
    @Provides
    fun builder(): Retrofit.Builder = Retrofit.Builder().addConverterFactory(MoshiConverterFactory.create())

    @Provides
    fun retrofit(builder: Retrofit.Builder): Retrofit = builder.baseUrl("https://api.example-sync.com/").build()

    @Provides
    fun sync(retrofit: Retrofit): SyncApi = retrofit.create(SyncApi::class.java)
}
