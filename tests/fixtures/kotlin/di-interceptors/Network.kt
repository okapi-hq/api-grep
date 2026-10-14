package com.example.parcels.di

import com.example.parcels.data.CarriersRepository
import com.example.parcels.data.LabelsRepository
import com.example.parcels.data.TrackingRepository
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module

class ParcelKeyInterceptor(private val key: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain) = chain.proceed(chain.request().newBuilder().header("X-Parcel-Key", key).build())
}

class LocaleInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain) = chain.proceed(chain.request().newBuilder().header("Accept-Language", "en-GB").build())
}

// adds every interceptor of a list to the builder
fun OkHttpClient.Builder.addInterceptors(interceptors: List<Interceptor>) = interceptors.fold(this) { builder, interceptor -> builder.addInterceptor(interceptor) }

val networkModule = module {
    single { ParcelKeyInterceptor("parcels-demo") } bind Interceptor::class
    single { LocaleInterceptor() } bind Interceptor::class

    // every Interceptor definition, through a project extension of the builder
    single(named("tracking")) { OkHttpClient.Builder().addInterceptors(getAll<Interceptor>()).build() }

    // the same list added in a loop
    single(named("labels")) {
        val builder = OkHttpClient.Builder()
        for (interceptor in getAll<Interceptor>()) builder.addInterceptor(interceptor)
        builder.build()
    }

    // two clients without a qualifier: a lookup without one gets neither
    single { OkHttpClient.Builder().addInterceptors(getAll<Interceptor>()).build() }
    single { OkHttpClient.Builder().build() }
    single { CarriersRepository(get()) }

    single { TrackingRepository(get(named("tracking"))) }
    single { LabelsRepository(get(named("labels"))) }
}
