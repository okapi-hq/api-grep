package com.example.radio.data

import com.example.radio.di.Account
import com.example.radio.di.Catalog
import com.example.radio.di.Uploads
import javax.inject.Inject
import okhttp3.OkHttpClient
import okhttp3.Request

class StationsRepository @Inject constructor(@Catalog private val client: OkHttpClient) {
    fun stations(country: String) = client.newCall(Request.Builder().url("https://catalog.radio-example.com/v2/stations?country=$country").build()).execute()
}

class RecordingsRepository @Inject constructor(@Uploads private val client: OkHttpClient) {
    fun recordings() = client.newCall(Request.Builder().url("https://uploads.radio-example.com/v2/recordings").build()).execute()
}

class FavoritesRepository @Inject constructor(@Account private val client: OkHttpClient) {
    fun favorites() = client.newCall(Request.Builder().url("https://account.radio-example.com/v2/favorites").build()).execute()
}
