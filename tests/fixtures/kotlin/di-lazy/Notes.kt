package com.example.notes.api

import com.example.notes.di.Authed
import dagger.Lazy
import javax.inject.Inject
import javax.inject.Provider
import okhttp3.OkHttpClient
import okhttp3.Request
import retrofit2.http.GET
import retrofit2.http.Path

interface NotesApi {
    @GET("notes/{id}")
    suspend fun note(@Path("id") id: String): String
}

class AttachmentsRepository @Inject constructor(@Authed private val client: Lazy<OkHttpClient>) {
    fun attachment(id: String) = client.get().newCall(Request.Builder().url("https://files.notes-example.com/v1/attachments/$id").build()).execute()
}

class SyncRepository @Inject constructor(@Authed private val clients: Provider<OkHttpClient>) {
    fun sync() = clients.get().newCall(Request.Builder().url("https://sync.notes-example.com/v1/sync").build()).execute()
}

// no qualifier, and two flavors provide the client: nothing is attached
class ExportRepository @Inject constructor(private val client: Lazy<OkHttpClient>) {
    fun export() = client.get().newCall(Request.Builder().url("https://export.notes-example.com/v1/export").build()).execute()
}
