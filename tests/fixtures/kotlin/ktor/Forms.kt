package com.example.catalog

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BasicAuthCredentials
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.basic
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitForm
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.http.parameters
import io.ktor.http.takeFrom
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

class Accounts(private val tokens: TokenSource) {
    private val client = HttpClient(OkHttp) {
        install(Auth) {
            bearer {
                loadTokens { BearerTokens(tokens.access(), tokens.refresh()) }
            }
        }
        defaultRequest {
            url.takeFrom("https://accounts.example-forms.com/api/")
        }
    }

    suspend fun login(user: String, password: String) = client.submitForm(
        url = "https://accounts.example-forms.com/oauth/token",
        formParameters = parameters {
            append("grant_type", "password")
            append("username", user)
            append("password", password)
        },
    )

    suspend fun rename(name: String) = client.post("profile") {
        setBody(FormDataContent(Parameters.build { append("display_name", name) }))
    }

    suspend fun avatar(bytes: ByteArray, caption: String) = client.post("profile/avatar") {
        setBody(MultiPartFormDataContent(formData {
            append("caption", caption)
            append("image", bytes)
        }))
    }

    suspend fun settings(theme: String) = client.post("settings") {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject {
            put("theme", theme)
            putJsonObject("notifications") { put("email", true) }
        })
    }
}

class TokenSource {
    fun access(): String = ""
    fun refresh(): String = ""
}

class Reports(user: String, password: String) {
    private val client = HttpClient {
        install(Auth) {
            basic { credentials { BasicAuthCredentials(username = user, password = password) } }
        }
    }

    suspend fun daily() = client.post("https://reports.example-forms.com/v1/daily")
}
