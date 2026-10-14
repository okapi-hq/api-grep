package com.example.kennel

import org.springframework.ai.chat.client.ChatClient
import org.springframework.ai.chat.model.ChatModel
import org.springframework.ai.ollama.api.OllamaChatOptions
import org.springframework.ai.ollama.api.OllamaModel
import org.springframework.ai.chat.prompt.Prompt
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.support.beans

@SpringBootApplication
class KennelApplication

fun main(args: Array<String>) {
    runApplication<KennelApplication>(*args) {
        addInitializers(beans {
            bean {
                // two chat starters: `spring.ai.model.chat` is not set, the builder could be either
                ref<ChatClient.Builder>().build().prompt("Which dog fits a flat?").call().content()
            }
            bean {
                // the bean named `openAiChatModel`: OpenAI's, with its default model in 1.1.2
                val model = ref<ChatModel>("openAiChatModel")
                model.call("Name three calm breeds")
            }
            bean {
                val local = ref<ChatModel>("ollamaChatModel")
                local.call(Prompt("Describe a beagle", OllamaChatOptions.builder().model(OllamaModel.LLAMA3_2.id()).build()))
            }
        })
    }
}
