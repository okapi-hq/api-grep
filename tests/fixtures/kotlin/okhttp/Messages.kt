package com.example.wallet

import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request

class Messages(private val client: OkHttpClient) {
    fun send(to: String, text: String) {
        val form = FormBody.Builder()
            .add("to", to)
            .add("text", text)
            .build()
        val req = Request.Builder()
            .url("https://api.mailgun.net/v3/mg.example.com/messages")
            .post(form)
            .build()
        client.newCall(req).execute()
    }

    fun upload(bytes: ByteArray, callback: Callback) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("upload_preset", "avatars").build()
        client.newCall(Request.Builder().url("https://api.cloudinary.com/v1_1/demo/image/upload").post(body).build()).enqueue(callback)
    }

    fun search(query: String): String {
        val url = HttpUrl.Builder()
            .scheme("https")
            .host("api.unsplash.com")
            .addPathSegments("search/photos")
            .addQueryParameter("query", query)
            .build()
        return execute(Request.Builder().url(url).build())
    }

    fun remove(id: String) {
        val builder = Request.Builder().url("https://api.cloudinary.com/v1_1/demo/resources/image/upload/$id")
        builder.header("Accept", "application/json")
        execute(builder.delete().build())
    }

    private fun execute(request: Request): String = client.newCall(request).execute().body!!.string()
}
