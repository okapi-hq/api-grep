package com.example.forecast.data

import com.google.firebase.firestore.FirebaseFirestore

class ForecastRepository(
    private val api: ForecastApi = Network.forecastApi,
    private val store: FirebaseFirestore,
) {
    companion object { const val PLACES = "places" }

    suspend fun today(lat: Double, lon: Double): Forecast = api.forecast(lat, lon)

    fun shareLink(lat: Double, lon: Double): String = "${Network.baseUrl}v1/forecast?latitude=$lat&longitude=$lon"

    fun save(place: SavedPlace) {
        store.collection(PLACES).add(place)
    }
}
