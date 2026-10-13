package com.example.notes

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

class ClientInterceptor(private val name: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response =
        chain.proceed(chain.request().newBuilder().header("X-Notes-Client", name).build())
}

// a client factory: the interceptor reads the argument each caller gives
fun namedClient(name: String): OkHttpClient = OkHttpClient.Builder()
    .addInterceptor(ClientInterceptor(name))
    .build()

class Notes {
    private val client = namedClient("notes-mobile")

    // steps inside apply { } are steps of the builder
    fun create(json: String) = client.newCall(
        Request.Builder().apply {
            url("https://notes.example.com/v1/notes")
            header("Accept", "application/json")
            post(json.toRequestBody("application/json".toMediaType()))
        }.build(),
    ).execute()

    fun archive(id: String) {
        val builder = Request.Builder()
        builder.apply {
            url("https://notes.example.com/v1/notes/$id/archive")
            method("PATCH", "{}".toRequestBody())
        }
        client.newCall(builder.build()).execute()
    }

    // the client's builder steps in apply { } too
    private val traced = OkHttpClient.Builder().apply {
        addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("X-Trace", "on").build()) }
    }.build()

    fun trace() = traced.newCall(Request.Builder().url("https://notes.example.com/v1/trace").build()).execute()

    // a JSON body filled in apply { }
    fun tag(id: String, tag: String) {
        val json = JSONObject().apply {
            put("tag", tag)
            put("pinned", true)
        }
        client.newCall(Request.Builder().url("https://notes.example.com/v1/notes/$id/tags").post(json.toString().toRequestBody(JSON)).build()).execute()
    }
}

private val JSON = "application/json".toMediaType()
