package com.example.parcels.data

import okhttp3.OkHttpClient
import okhttp3.Request

class TrackingRepository(private val client: OkHttpClient) {
    fun status(id: String) = client.newCall(Request.Builder().url("https://track.parcels-example.com/v1/parcels/$id").build()).execute()
}

class LabelsRepository(private val client: OkHttpClient) {
    fun label(id: String) = client.newCall(Request.Builder().url("https://labels.parcels-example.com/v1/labels/$id").build()).execute()
}

class CarriersRepository(private val client: OkHttpClient) {
    fun carriers() = client.newCall(Request.Builder().url("https://carriers.parcels-example.com/v1/carriers").build()).execute()
}
