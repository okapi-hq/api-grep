package com.example.wallet

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class Balances(private val client: OkHttpClient, private val apiKey: String) {
    fun balance(address: String): String {
        val url = "https://rpc.example.com/".toHttpUrl().newBuilder()
            .addQueryParameter("api-key", apiKey)
            .build()
        val req = Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .post(JSONObject().put("method", "getBalance").put("params", JSONArray().put(address)).toString()
                .toRequestBody("application/json".toMediaType()))
            .build()
        return client.newCall(req).execute().body!!.string()
    }
}
