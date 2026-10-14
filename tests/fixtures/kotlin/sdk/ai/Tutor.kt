package com.example.tutor

import com.aallam.openai.api.chat.ChatCompletionRequest
import com.aallam.openai.api.chat.ChatMessage
import com.aallam.openai.api.chat.ChatRole
import com.aallam.openai.api.embedding.EmbeddingRequest
import com.aallam.openai.api.model.ModelId
import com.aallam.openai.client.OpenAI
import com.aallam.openai.client.OpenAIConfig
import com.aallam.openai.client.OpenAIHost

class Tutor(apiKey: String) {
    private val openAI = OpenAI(apiKey)
    private val proxied = OpenAI(OpenAIConfig(token = apiKey, host = OpenAIHost(baseUrl = "https://llm-gateway.example.com/v1/")))

    suspend fun explain(topic: String) =
        openAI.chatCompletion(
            ChatCompletionRequest(
                model = ModelId("gpt-4o-mini"),
                messages = listOf(
                    ChatMessage(role = ChatRole.System, content = "You are a patient tutor."),
                    ChatMessage(role = ChatRole.User, content = "Explain $topic"),
                ),
                maxTokens = 400,
            )
        )

    suspend fun embed(text: String) = proxied.embeddings(EmbeddingRequest(model = ModelId("text-embedding-3-small"), input = listOf(text)))

    suspend fun catalog() = openAI.models()
}
