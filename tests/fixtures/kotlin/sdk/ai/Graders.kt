package com.example.tutor

import dev.langchain4j.model.anthropic.AnthropicChatModel
import dev.langchain4j.model.anthropic.AnthropicChatModelName
import dev.langchain4j.model.ollama.OllamaChatModel
import dev.langchain4j.model.openai.OpenAiChatModel
import dev.langchain4j.model.openai.OpenAiChatModelName

// LangChain4j model clients: built once, each sends its requests with these settings
object Graders {
    val strict = OpenAiChatModel.builder()
        .apiKey(System.getenv("OPENAI_API_KEY"))
        .modelName(OpenAiChatModelName.GPT_4_O_MINI)
        .temperature(0.0)
        .logRequests(true)
        .build()

    val lenient = AnthropicChatModel.builder()
        .apiKey(System.getenv("ANTHROPIC_API_KEY"))
        .modelName(AnthropicChatModelName.CLAUDE_3_5_HAIKU_20241022)
        .maxTokens(512)
        .build()

    val local = OllamaChatModel.builder().baseUrl("http://ollama.internal:11434").modelName("llama3.1").build()

    fun grade(answer: String) = strict.chat("Grade: $answer")
}
