package com.example.forecast.data

import retrofit2.http.GET
import retrofit2.http.Query

interface ForecastApi {
    @GET("v1/forecast")
    suspend fun forecast(
        @Query("latitude") latitude: Double,
        @Query("longitude") longitude: Double,
        @Query("hourly") hourly: String = "temperature_2m",
    ): Forecast
}
