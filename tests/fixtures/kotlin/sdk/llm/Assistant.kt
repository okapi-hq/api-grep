package com.example.assistant

import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.Model

class Assistant(private val client: AnthropicClient = AnthropicOkHttpClient.fromEnv()) {
    fun ask(prompt: String): String {
        val params = MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_5)
            .maxTokens(1024)
            .addUserMessage(prompt)
            .build()
        return client.messages().create(params).toString()
    }

    fun summarize(text: String, short: Boolean) {
        val builder = MessageCreateParams.builder()
        builder.model("claude-haiku-4-5")
        builder.maxTokens(if (short) 256L else 2048L)
        builder.system("Summarize the text.")
        builder.addUserMessage(text)
        client.messages().create(builder.build())
    }

    fun count(text: String) = client.messages().countTokens(
        com.anthropic.models.messages.MessageCountTokensParams.builder().model(Model.CLAUDE_OPUS_4_1).addUserMessage(text).build()
    )
}

object Proxy {
    private val proxied = AnthropicOkHttpClient.builder()
        .apiKey(System.getenv("GATEWAY_KEY"))
        .baseUrl("https://llm-gateway.example.com")
        .build()

    fun models() = proxied.models().list()
}
