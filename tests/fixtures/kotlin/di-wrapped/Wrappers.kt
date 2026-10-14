package com.example.radio.net

import okhttp3.Interceptor
import okhttp3.Interceptor.Chain
import okhttp3.OkHttpClient
import okhttp3.Response

sealed interface StationInterceptor {
    fun intercept(chain: Chain): Response
}

fun interface AppInterceptor : StationInterceptor

fun Interceptor.toAppInterceptor() = AppInterceptor { chain -> intercept(chain) }

fun interface WireInterceptor : StationInterceptor

fun Interceptor.toWireInterceptor() = WireInterceptor { chain -> intercept(chain) }

// each wrapper adds the interceptor it wraps
fun OkHttpClient.Builder.addStationInterceptors(interceptors: List<StationInterceptor>) = interceptors.fold(this) { builder, wrapped ->
    when (wrapped) {
        is AppInterceptor -> builder.addInterceptor(Interceptor { wrapped.intercept(it) })
        is WireInterceptor -> builder.addNetworkInterceptor(Interceptor { wrapped.intercept(it) })
    }
}
