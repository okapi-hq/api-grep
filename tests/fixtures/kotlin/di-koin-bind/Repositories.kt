package com.example.radio.data

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

class StationsRepository(private val calls: Call.Factory) {
    fun stations() = calls.newCall(Request.Builder().url("https://api.radio-example.com/v1/stations").build()).execute()
}

class UploadsRepository(private val client: HttpClient) {
    suspend fun status() = client.get("status")
}

class ArchiveCalls : Call.Factory {
    private val client = OkHttpClient.Builder()
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Archive-Token", "demo").build()) }
        .build()

    override fun newCall(request: Request): Call = client.newCall(request)
}

class ArchiveRepository(private val calls: Call.Factory) {
    fun episodes() = calls.newCall(Request.Builder().url("https://archive.radio-example.com/v1/episodes").build()).execute()
}

class MirrorRepository(private val calls: Call.Factory) {
    fun mirrors() = calls.newCall(Request.Builder().url("https://mirror.radio-example.com/v1/list").build()).execute()
}
