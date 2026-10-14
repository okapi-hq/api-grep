package com.example.notes

import org.springframework.ai.chat.client.ChatClient

class Notes(private val client: ChatClient) {
    fun tidy(text: String): String? = client.prompt(text).call().content()
}

// a class of the project with the same method names
class Phone {
    fun prompt(text: String) = this
    fun call() = "ringing"
}

fun dial(p: Phone) = p.prompt("hello").call()
