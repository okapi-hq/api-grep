package com.example.drafts

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class Draft(val title: String = "", val body: String = "", val tags: String = "", val lang: String = "")

interface DraftStore {
    fun load(): Draft?
}

// A field reassigned from itself in many places: resolving it must not branch on every assignment at every level.
class DraftEditor(private val client: OkHttpClient, store: DraftStore) {
    private var draft: Draft = store.load() ?: error("no draft")

    fun title(v: String) { draft = draft.copy(title = v) }
    fun body(v: String) { draft = draft.copy(body = v) }
    fun tags(v: String) { draft = draft.copy(tags = v) }
    fun lang(v: String) { draft = draft.copy(lang = v) }
    fun clearTitle() { draft = draft.copy(title = "") }
    fun clearBody() { draft = draft.copy(body = "") }
    fun clearTags() { draft = draft.copy(tags = "") }
    fun clearLang() { draft = draft.copy(lang = "") }
    fun trimTitle() { draft = draft.copy(title = draft.title.trim()) }
    fun trimBody() { draft = draft.copy(body = draft.body.trim()) }
    fun trimTags() { draft = draft.copy(tags = draft.tags.trim()) }
    fun trimLang() { draft = draft.copy(lang = draft.lang.trim()) }

    fun publish() {
        val request = Request.Builder()
            .url("https://drafts.example.com/v1/drafts")
            .post(draft.body.toRequestBody("text/plain".toMediaType()))
            .build()
        client.newCall(request).execute()
    }
}
