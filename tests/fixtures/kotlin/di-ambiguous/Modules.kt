package com.example.weather.di

import dagger.Module
import dagger.Provides
import io.ktor.client.HttpClient
import io.ktor.client.plugins.defaultRequest
import javax.inject.Named
import okhttp3.OkHttpClient

// two flavors each provide the client: which one a build uses is not in the code, so neither is attached
@Module
object StagingModule {
    @Provides
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Env", "staging").build()) }
        .build()
}

@Module
object ProductionModule {
    @Provides
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Env", "production").build()) }
        .build()
}

// two named clients: an injection point without a name gets neither
@Module
object KtorModule {
    @Provides
    @Named("radar")
    fun radar(): HttpClient = HttpClient { defaultRequest { url("https://radar.weather-example.com/") } }

    @Provides
    @Named("alerts")
    fun alerts(): HttpClient = HttpClient { defaultRequest { url("https://alerts.weather-example.com/") } }
}
