package com.example.radio.di

import com.example.radio.data.ArchiveCalls
import com.example.radio.data.ArchiveRepository
import com.example.radio.data.StationsRepository
import com.example.radio.data.MirrorRepository
import com.example.radio.data.UploadsRepository
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.defaultRequest
import okhttp3.Call
import okhttp3.OkHttpClient
import org.koin.core.module.dsl.bind
import org.koin.core.module.dsl.singleOf
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module

class Uploads
class Mirror

val networkModule = module {
    // the client is looked up by an interface it implements
    single {
        OkHttpClient.Builder()
            .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Radio-Key", "public-demo").build()) }
            .build()
    } bind Call.Factory::class

    // a type qualifier
    single(named<Uploads>()) {
        HttpClient(CIO) { defaultRequest { url("https://uploads.radio-example.com/v2/") } }
    }

    single { StationsRepository(get()) }
    single { UploadsRepository(get(named<Uploads>())) }

    // bound, and named, in the definition's options
    singleOf(::ArchiveCalls) {
        named("archive")
        bind<Call.Factory>()
    }
    single { ArchiveRepository(get(named("archive"))) }
}

// two definitions bound to one type under one qualifier: a lookup of it gets neither
val mirrorModule = module {
    single(named<Mirror>()) { OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Mirror", "a").build()) }.build() }.bind<Call.Factory>()
    single(named<Mirror>()) { OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Mirror", "b").build()) }.build() }.bind<Call.Factory>()
    single { MirrorRepository(get(named<Mirror>())) }
}
