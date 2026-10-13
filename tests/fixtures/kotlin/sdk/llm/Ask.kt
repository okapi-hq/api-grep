package com.example.assistant

import com.openai.client.okhttp.OpenAIOkHttpClient
import com.openai.models.chat.completions.ChatCompletionCreateParams

class Ask {
    private val client = OpenAIOkHttpClient.fromEnv()

    fun ask(question: String, model: String = "gpt-4o-mini") =
        client.chat().completions().create(ChatCompletionCreateParams.builder().model(model).addUserMessage(question).build())
}

fun main() {
    Ask().ask("Which plan fits?", "o3")
}
