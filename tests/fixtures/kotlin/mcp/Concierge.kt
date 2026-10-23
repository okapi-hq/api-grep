package com.example.lagoon

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.sse.SSE
import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.client.StreamableHttpClientTransport
import io.modelcontextprotocol.kotlin.sdk.client.mcpSse
import io.modelcontextprotocol.kotlin.sdk.types.GetPromptRequest
import io.modelcontextprotocol.kotlin.sdk.types.GetPromptRequestParams

class Concierge(private val http: HttpClient) {
    private val client = Client(clientInfo = Implementation(name = "lagoon-concierge", version = "1.0.0"))

    suspend fun start() {
        val transport = StreamableHttpClientTransport(client = http, url = "https://tools.lagoon.example.com/mcp")
        client.connect(transport)
    }

    suspend fun book(room: String) {
        client.listTools()
        client.callTool(name = "book_room", arguments = mapOf("room" to room, "nights" to 2))
        client.ping()
    }

    suspend fun weather() {
        val sse = HttpClient(CIO) { install(SSE) }.mcpSse("https://weather.lagoon.example.com/sse")
        sse.callTool("current_conditions", mapOf("spot" to "north"))
    }

    suspend fun welcome(guest: String) {
        client.getPrompt(GetPromptRequest(GetPromptRequestParams(name = "welcome_note", arguments = mapOf("guest" to guest))))
    }
}
