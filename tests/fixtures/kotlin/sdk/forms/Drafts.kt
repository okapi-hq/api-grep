package com.example.drafts

import com.openai.client.okhttp.OpenAIOkHttpClient
import com.openai.models.ChatModel
import com.openai.models.chat.completions.ChatCompletionCreateParams
import com.openai.models.files.FileRetrieveParams

class Drafts {
    private val openai = OpenAIOkHttpClient.builder().baseUrl("https://llm-proxy.example.com/v1").build()

    // a builder filled in `apply { }`
    fun outline(topic: String) =
        openai.chat().completions().create(
            ChatCompletionCreateParams.builder().apply {
                model(ChatModel.GPT_4O_MINI)
                addUserMessage("Outline: $topic")
            }.build()
        )

    // a field set in a branch may not be sent
    fun polish(text: String, strict: Boolean) {
        val params = ChatCompletionCreateParams.builder().model("gpt-4.1").addUserMessage(text)
        if (strict) params.temperature(0.0)
        params.apply { maxCompletionTokens(800) }
        openai.chat().completions().create(params.build())
    }

    // the path id given inside the params object
    fun attachment(id: String) = openai.files().retrieve(FileRetrieveParams.builder().fileId(id).build())
}
