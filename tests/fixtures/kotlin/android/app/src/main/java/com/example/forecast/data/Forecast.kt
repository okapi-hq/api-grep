package com.example.forecast.data

import com.google.gson.annotations.SerializedName

data class Forecast(
    val latitude: Double,
    val longitude: Double,
    @SerializedName("hourly_units") val units: Map<String, String>? = null,
)

data class SavedPlace(@SerializedName("place_name") val name: String, val lat: Double, val lon: Double)
