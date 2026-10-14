package com.example.radio.di

import com.example.radio.net.StationInterceptor
import com.example.radio.net.addStationInterceptors
import com.example.radio.net.toAppInterceptor
import dagger.Module
import dagger.Provides
import javax.inject.Inject
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request

// two unqualified lists of interceptors: the client below could get either, so neither is attached
@Module
object PrimaryMirrorModule {
    @Provides
    fun provideMirrorInterceptors(): List<StationInterceptor> = buildList {
        add(Interceptor { it.proceed(it.request().newBuilder().header("X-Mirror", "primary").build()) }.toAppInterceptor())
    }
}

@Module
object BackupMirrorModule {
    @Provides
    fun provideMirrorInterceptors(): List<StationInterceptor> = buildList {
        add(Interceptor { it.proceed(it.request().newBuilder().header("X-Mirror", "backup").build()) }.toAppInterceptor())
    }

    @Provides
    fun provideMirrorClient(interceptors: List<@JvmSuppressWildcards StationInterceptor>): OkHttpClient =
        OkHttpClient.Builder().addStationInterceptors(interceptors).build()
}

class MirrorRepository @Inject constructor(private val client: OkHttpClient) {
    fun mirrors() = client.newCall(Request.Builder().url("https://mirrors.radio-example.com/v2/mirrors").build()).execute()
}
