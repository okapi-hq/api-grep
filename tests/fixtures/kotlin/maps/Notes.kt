package com.example.notes

import kong.unirest.Unirest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** Maps filled with `map["k"] = v`, as bodies, headers and query parameters. */
class Notes(private val client: OkHttpClient) {
    private val json = "application/json".toMediaType()

    fun create(title: String, draft: Boolean) {
        val body = HashMap<String, Any>()
        body["title"] = title
        if (draft) {
            body["status"] = "draft"
        }
        val request = Request.Builder()
            .url("https://api.example-notes.com/v1/notes")
            .post(JSONObject(body as Map<*, *>).toString().toRequestBody(json))
            .build()
        client.newCall(request).execute()
    }

    fun update(id: String, title: String, pinned: Boolean) {
        val fields = mutableMapOf<String, Any>("id" to id)
        fields["title"] = title
        if (pinned) fields["pinned"] = true else fields["pinned"] = false
        val request = Request.Builder()
            .url("https://api.example-notes.com/v1/notes/$id")
            .put(JSONObject(fields as Map<*, *>).toString().toRequestBody(json))
            .build()
        client.newCall(request).execute()
    }

    fun search(query: String, tag: String?) {
        val params = mutableMapOf<String, Any>()
        params["q"] = query
        if (tag != null) params["tag"] = tag
        val headers = mutableMapOf<String, String>()
        headers["X-Api-Key"] = System.getenv("NOTES_KEY") ?: ""
        Unirest.get("https://api.example-notes.com/v1/search").queryString(params).headers(headers).asJson()
    }
}
