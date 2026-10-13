package com.example.tracks.data

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

// built by `single { TracksRepository(get()) }`: the client is the module's
class TracksRepository(private val client: HttpClient) {
    suspend fun tracks() = client.get("tracks")
}

// built by `singleOf(::PlaylistsRepository)`
class PlaylistsRepository(private val client: HttpClient) {
    suspend fun create(name: String) = client.post("playlists") { setBody(name) }
}

// built with the named client
class UploadsRepository(private val client: OkHttpClient) {
    fun status() = client.newCall(Request.Builder().url("https://uploads.tracks-example.com/v1/status").build()).execute()
}

// a component that looks its client up
class SettingsLoader : KoinComponent {
    private val client: HttpClient by inject()

    suspend fun load() = client.get("settings")
}
