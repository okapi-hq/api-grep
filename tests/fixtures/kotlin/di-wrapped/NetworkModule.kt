package com.example.radio.di

import com.example.radio.net.StationInterceptor
import com.example.radio.net.addStationInterceptors
import com.example.radio.net.toAppInterceptor
import com.example.radio.net.toWireInterceptor
import dagger.Module
import dagger.Provides
import javax.inject.Named
import javax.inject.Qualifier
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor

@Qualifier
annotation class Catalog

@Qualifier
annotation class Uploads

@Qualifier
annotation class Account

interface Session {
    fun token(): String?
}

class RegionInterceptor(private val region: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain) = chain.proceed(chain.request().newBuilder().header("X-Radio-Region", region).addIfPresent(LOCALE_HEADER, "fr").build())

    // a step of the request builder written as an extension
    private fun Request.Builder.addIfPresent(name: String, value: String): Request.Builder = if (value.isNotEmpty()) header(name, value) else this

    companion object {
        const val LOCALE_HEADER = "X-Radio-Locale"
    }
}

@Module
object NetworkModule {
    private val agentInterceptor = Interceptor { chain ->
        val request = chain.request().newBuilder()
        request.header("User-Agent", "RadioApp/2.1")
        chain.proceed(request.build())
    }

    private val debug = false

    @Provides
    @Named("region")
    fun provideRegionInterceptor(): Interceptor = RegionInterceptor("eu-west")

    @Provides
    @Catalog
    fun provideCatalogInterceptors(@Named("region") region: Interceptor): List<StationInterceptor> {
        return buildList {
            add(agentInterceptor.toAppInterceptor())
            add(region.toWireInterceptor())
            if (debug) {
                add(HttpLoggingInterceptor().toAppInterceptor())
            }
        }
    }

    @Provides
    @Uploads
    fun provideUploadInterceptors(): List<StationInterceptor> {
        val list = mutableListOf<StationInterceptor>()
        list.add(agentInterceptor.toAppInterceptor())
        return list
    }

    @Provides
    @Named("token")
    fun provideTokenInterceptor(session: Session): Interceptor {
        fun withToken(original: Request, token: String?): Request {
            val builder = original.newBuilder()
            if (token != null) {
                builder.addHeader("Authorization", "Bearer $token")
            }
            return builder.build()
        }

        return Interceptor { chain ->
            val response = chain.proceed(withToken(chain.request(), session.token()))
            // headers of the response are not the request's
            response.newBuilder().header("X-Served-By", "radio").build()
        }
    }

    @Provides
    @Account
    fun provideAccountInterceptors(@Named("token") token: Interceptor): List<StationInterceptor> = buildList {
        add(agentInterceptor.toAppInterceptor())
        add(token.toAppInterceptor())
    }

    @Provides
    @Account
    fun provideAccountClient(@Account interceptors: List<@JvmSuppressWildcards StationInterceptor>): OkHttpClient =
        OkHttpClient.Builder().addStationInterceptors(interceptors).build()

    @Provides
    @Catalog
    fun provideCatalogClient(@Catalog interceptors: List<@JvmSuppressWildcards StationInterceptor>): OkHttpClient =
        OkHttpClient.Builder().addStationInterceptors(interceptors).build()

    @Provides
    @Uploads
    fun provideUploadClient(@Uploads interceptors: List<@JvmSuppressWildcards StationInterceptor>): OkHttpClient =
        OkHttpClient.Builder().addStationInterceptors(interceptors).build()
}
