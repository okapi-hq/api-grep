package com.example.lessons

import com.google.firebase.Firebase
import com.google.firebase.storage.storage
import com.openai.client.OpenAIClient
import com.openai.models.ChatModel
import com.openai.models.chat.completions.ChatCompletionCreateParams
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Phone
import io.github.jan.supabase.postgrest.from

class Lessons(private val openai: OpenAIClient, private val supabase: SupabaseClient) {
    // the settings every lesson request starts from
    private fun defaults() = ChatCompletionCreateParams.builder().model(ChatModel.GPT_4O_MINI).maxCompletionTokens(600)

    private fun level(params: ChatCompletionCreateParams.Builder, beginner: Boolean) {
        params.addSystemMessage("You teach chemistry.")
        if (beginner) params.temperature(0.3)
    }

    fun explain(topic: String) = openai.chat().completions().create(defaults().addUserMessage(topic).build())

    fun quiz(topic: String, beginner: Boolean) {
        val params = defaults()
        level(params, beginner)
        params.addUserMessage("Quiz me on $topic")
        openai.chat().completions().create(params.build())
    }

    suspend fun finish(id: Long, score: Int) = supabase.from("lessons").update({
        set("done", true)
        set("score", score)
    }) {
        filter { eq("id", id) }
    }

    suspend fun join(number: String, code: String) = supabase.auth.signUpWith(Phone) {
        phone = number
        password = code
    }

    suspend fun cover(id: Long) = Firebase.storage.reference.child("covers/$id.png").downloadUrl

    // a local value of the same name is no request
    fun local(links: Map<String, String>) = links.size
}
