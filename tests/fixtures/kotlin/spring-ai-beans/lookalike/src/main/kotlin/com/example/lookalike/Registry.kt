package com.example.lookalike

import org.springframework.ai.chat.client.ChatClient

// a project function named like the beans DSL's `ref`: not a Spring lookup
inline fun <reified T> ref(): T = Registry.find(T::class.java)

object Registry {
    fun <T> find(type: Class<T>): T = throw UnsupportedOperationException(type.name)
}

fun ask(question: String): String? = ref<ChatClient>().prompt(question).call().content()
