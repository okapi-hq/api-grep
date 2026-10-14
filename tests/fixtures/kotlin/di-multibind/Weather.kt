package com.example.weather.net

import javax.inject.Inject
import javax.inject.Named
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class ApiKeyInterceptor(private val key: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(chain.request().newBuilder().header("X-Api-Key", key).build())
}

class VersionInterceptor(private val version: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(chain.request().newBuilder().header("X-App-Version", version).build())
}

class ForecastRepository @Inject constructor(private val client: OkHttpClient) {
    fun today(city: String) = client.newCall(Request.Builder().url("https://api.weather-example.com/v1/today?city=$city").build()).execute()
}

class MapsRepository @Inject constructor(@Named("maps") private val client: OkHttpClient) {
    fun tile(z: Int) = client.newCall(Request.Builder().url("https://maps.weather-example.com/v1/tiles/$z").build()).execute()
}

class LegacyRepository @Inject constructor(@Named("legacy") private val client: OkHttpClient) {
    fun report() = client.newCall(Request.Builder().url("https://legacy.weather-example.com/report").build()).execute()
}
