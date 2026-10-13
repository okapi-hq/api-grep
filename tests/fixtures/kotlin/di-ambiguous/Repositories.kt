package com.example.weather.data

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import javax.inject.Inject
import javax.inject.Named
import okhttp3.OkHttpClient
import okhttp3.Request

class ForecastRepository @Inject constructor(private val client: OkHttpClient) {
    fun forecast(city: String) = client.newCall(Request.Builder().url("https://api.weather-example.com/v1/forecast?city=$city").build()).execute()
}

class RadarRepository @Inject constructor(private val client: HttpClient) {
    suspend fun tiles() = client.get("v2/tiles")
}

class AlertsRepository @Inject constructor(@Named("alerts") private val client: HttpClient) {
    suspend fun active() = client.get("v1/active")
}

// a class also built by hand with another client: its constructor's client is not the container's
class HistoryRepository(private val client: OkHttpClient) {
    fun history(city: String) = client.newCall(Request.Builder().url("https://history.weather-example.com/v1/$city").build()).execute()
}

object Manual {
    val history = HistoryRepository(OkHttpClient())
}
