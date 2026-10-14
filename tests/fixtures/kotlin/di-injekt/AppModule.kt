package com.example.comics

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.defaultRequest
import okhttp3.OkHttpClient
import uy.kohesive.injekt.api.InjektModule
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.addSingleton
import uy.kohesive.injekt.api.addSingletonFactory

class AppModule : InjektModule {
    override fun InjektRegistrar.registerInjectables() {
        addSingletonFactory {
            OkHttpClient.Builder()
                .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", "comics-reader/2.1").build()) }
                .build()
        }
        addSingleton(HttpClient(OkHttp) { defaultRequest { url("https://api.comics-example.com/v3/") } })
    }
}
