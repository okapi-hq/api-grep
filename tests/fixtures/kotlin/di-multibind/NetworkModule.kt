package com.example.weather.di

import com.example.weather.net.ApiKeyInterceptor
import com.example.weather.net.VersionInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.ElementsIntoSet
import dagger.multibindings.IntoSet
import javax.inject.Named
import okhttp3.Interceptor
import okhttp3.OkHttpClient

@Module
@InstallIn(SingletonComponent::class)
object InterceptorModule {
    @Provides
    @IntoSet
    fun apiKey(): Interceptor = ApiKeyInterceptor("weather-demo-key")

    @Provides
    @ElementsIntoSet
    fun extras(): Set<Interceptor> = setOf(VersionInterceptor("4.2.0"))

    @Provides
    @IntoSet
    @Named("maps")
    fun mapsKey(): Interceptor = Interceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Maps-Key", "maps-demo-key").build()) }

    // a whole set and a contribution under the same name: which one the graph uses is not told
    @Provides
    @Named("legacy")
    fun legacy(): Set<Interceptor> = setOf(Interceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Legacy", "1").build()) })

    @Provides
    @IntoSet
    @Named("legacy")
    fun legacyExtra(): Interceptor = Interceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Legacy-Extra", "1").build()) }
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    fun client(interceptors: Set<@JvmSuppressWildcards Interceptor>): OkHttpClient = OkHttpClient.Builder()
        .apply { interceptors.forEach(::addInterceptor) }
        .build()

    @Provides
    @Named("maps")
    fun mapsClient(@Named("maps") interceptors: Set<@JvmSuppressWildcards Interceptor>): OkHttpClient {
        val builder = OkHttpClient.Builder()
        interceptors.forEach { builder.addInterceptor(it) }
        return builder.build()
    }

    @Provides
    @Named("legacy")
    fun legacyClient(@Named("legacy") interceptors: Set<@JvmSuppressWildcards Interceptor>): OkHttpClient = OkHttpClient.Builder()
        .apply { interceptors.forEach { addInterceptor(it) } }
        .build()
}
