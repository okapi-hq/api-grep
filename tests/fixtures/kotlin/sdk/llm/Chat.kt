package com.example.assistant

import com.openai.client.OpenAIClient
import com.openai.client.okhttp.OpenAIOkHttpClient
import com.openai.models.ChatModel
import com.openai.models.chat.completions.ChatCompletionCreateParams
import com.openai.models.embeddings.EmbeddingCreateParams
import com.openai.models.responses.ResponseCreateParams

class Chat {
    private val openai: OpenAIClient = OpenAIOkHttpClient.fromEnv()

    fun complete(question: String) =
        openai.chat().completions().create(
            ChatCompletionCreateParams.builder()
                .model(ChatModel.GPT_4_1_MINI)
                .addSystemMessage("Answer briefly.")
                .addUserMessage(question)
                .maxCompletionTokens(300)
                .build()
        )

    fun respond(input: String) = openai.async().responses().create(ResponseCreateParams.builder().model(ChatModel.GPT_4O).input(input).build())

    fun embed(text: String) = openai.embeddings().create(EmbeddingCreateParams.builder().model("text-embedding-3-small").input(text).build())

    fun file(id: String) = openai.files().retrieve(id)
}
