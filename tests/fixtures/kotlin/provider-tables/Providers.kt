package demo

import okhttp3.OkHttpClient
import okhttp3.Request

data class Provider(val id: String, val baseUrl: String)

val PROVIDERS = listOf(
    Provider("groq", "https://api.groq.com/openai/v1"),
    Provider("mistral", "https://api.mistral.ai/v1"),
)

fun models(id: String): String? {
    val p = PROVIDERS.first { it.id == id }
    val request = Request.Builder().url("${p.baseUrl}/models").build()
    return OkHttpClient().newCall(request).execute().body?.string()
}
