package com.example.weather

import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*

// Wildcard imports, as Ktor's project generator writes them: `HttpClient` comes from `io.ktor.client.*`.
class Forecasts {
    private val client = HttpClient()

    suspend fun today(city: String): String = client.get("https://forecast.example.com/v1/today") {
        parameter("city", city)
    }.bodyAsText()
}
