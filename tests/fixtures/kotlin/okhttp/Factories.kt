package com.example.shelf

import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

private val NO_HEADERS = Headers.Builder().build()

fun getRequest(url: String, headers: Headers = NO_HEADERS): Request {
    return getRequest(url.toHttpUrl(), headers)
}

fun getRequest(url: HttpUrl, headers: Headers = NO_HEADERS): Request {
    return Request.Builder()
        .url(url)
        .headers(headers)
        .build()
}

fun postRequest(url: String, body: RequestBody): Request {
    return Request.Builder()
        .url(url)
        .post(body)
        .build()
}

class Shelf(private val client: OkHttpClient) {
    fun books(shelfId: String) {
        client.newCall(getRequest("https://books.example.com/v1/shelves/$shelfId/books")).execute()
    }

    fun add(shelfId: String, title: String) {
        val body = JSONObject().put("title", title).toString().toRequestBody("application/json".toMediaType())
        client.newCall(postRequest(url = "https://books.example.com/v1/shelves/$shelfId/books", body = body)).execute()
    }

    fun check(links: List<Link>) {
        for (link in links) {
            val target = link.href?.toHttpUrlOrNull() ?: continue
            val request = Request.Builder().url(target).head().build()
            client.newCall(request).execute()
        }
    }

    fun login(form: LoginForm) {
        val request = Request.Builder()
            .url("https://books.example.com/oauth/token")
            .post(form.toFormBody())
            .build()
        client.newCall(request).execute()
    }
}

class Link(val href: String?)

class LoginForm(private val user: String, private val password: String) {
    fun toFormBody(): FormBody {
        val builder = FormBody.Builder()
        builder.add("grant_type", "password")
        builder.add("username", user)
        builder.add("password", password)
        return builder.build()
    }
}

// A request body class of the project: it writes its own bytes, its constructor arguments are not the body's fields.
class ProgressBody(private val bytes: ByteArray, private val onProgress: (Long) -> Unit) : RequestBody() {
    override fun contentType() = null
    override fun writeTo(sink: okio.BufferedSink) {
        sink.write(bytes)
        onProgress(bytes.size.toLong())
    }
}

class Covers(private val client: OkHttpClient) {
    fun upload(bookId: String, image: ByteArray) {
        val request = Request.Builder()
            .url("https://books.example.com/v1/books/$bookId/cover")
            .put(ProgressBody(image) {})
            .build()
        client.newCall(request).execute()
    }
}
