package com.example.tracks.di

import com.example.tracks.data.PlaylistsRepository
import com.example.tracks.data.TracksRepository
import com.example.tracks.data.UploadsRepository
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import okhttp3.OkHttpClient
import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.module

val networkModule = module {
    single {
        HttpClient(CIO) {
            defaultRequest {
                url("https://api.tracks-example.com/v1/")
                header("X-Client", "android")
            }
        }
    }
    single(named("uploads")) {
        OkHttpClient.Builder()
            .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Upload-Key", "public-key").build()) }
            .build()
    }
    single { TracksRepository(get()) }
    singleOf(::PlaylistsRepository)
    single { UploadsRepository(get(named("uploads"))) }
}
