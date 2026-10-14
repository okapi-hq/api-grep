package com.example.notes.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient

// two flavors each provide the unqualified client: an injection point without a qualifier gets neither
@Module
@InstallIn(SingletonComponent::class)
object FreeModule {
    @Provides
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Flavor", "free").build()) }
        .build()
}

@Module
@InstallIn(SingletonComponent::class)
object PaidModule {
    @Provides
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Flavor", "paid").build()) }
        .build()
}
