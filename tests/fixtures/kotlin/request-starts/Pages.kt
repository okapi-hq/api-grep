package com.example.pages

import okhttp3.OkHttpClient
import okhttp3.Request

/** Overloaded wrappers in Kotlin: by count, by name, and an ambiguous call left unknown. */
class Pages(private val client: OkHttpClient) {
    fun first() = fetch("/v1/pages")

    fun drop() = fetch("/v1/pages", 2)

    fun named() = fetch(path = "/v1/archive", page = 3)

    fun unclear(value: Any) = send(value)

    private fun fetch(path: String) = client.newCall(Request.Builder().url("https://api.example-pages.com$path").build()).execute()

    private fun fetch(path: String, page: Int) = client.newCall(Request.Builder().url("https://api.example-pages.com$path?page=$page").delete().build()).execute()

    private fun send(text: String) = client.newCall(Request.Builder().url("https://api.example-pages.com/v1/notes/$text").build()).execute()

    private fun send(id: Long) = client.newCall(Request.Builder().url("https://api.example-pages.com/v1/notes/$id").delete().build()).execute()
}
