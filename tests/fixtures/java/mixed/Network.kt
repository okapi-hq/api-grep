package com.example.notes

import com.example.notes.api.NotesApi
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object Endpoints {
    const val NOTES_URL = "https://api.example-notes.com/v1/"
    const val STATUS_URL = "https://status.example-notes.com/api/v2/status.json"
}

object Network {
    val notes: NotesApi = Retrofit.Builder()
        .baseUrl(Endpoints.NOTES_URL)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(NotesApi::class.java)
}

class Inbox {
    fun load() = Network.notes.list(Settings.DEFAULT_FOLDER).execute()
}
