package com.example.tutor

import org.springframework.ai.anthropic.AnthropicChatOptions
import org.springframework.ai.chat.client.ChatClient
import org.springframework.ai.chat.model.ChatModel
import org.springframework.ai.chat.prompt.Prompt
import org.springframework.stereotype.Service
import reactor.core.publisher.Flux

@Service
class TutorService(builder: ChatClient.Builder, private val model: ChatModel) {
    private val client = builder.defaultSystem("You are a patient math tutor.").build()

    fun explain(topic: String): String? = client.prompt().user { it.text("Explain {topic}").param("topic", topic) }.call().content()

    fun hints(topic: String): Flux<String> = client.prompt(topic).stream().content()

    fun grade(answer: String): String? =
        model.call(Prompt(answer, AnthropicChatOptions.builder().model("claude-haiku-4-5").build())).result.output.text

    // a client of another kind, built on the same builder
    fun strict(question: String): String? =
        client.mutate().defaultSystem("Answer with one number.").build().prompt(question).call().content()
}
