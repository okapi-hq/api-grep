package com.example.lagoon

import io.modelcontextprotocol.client.McpClient
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest

class JavaSdkClient(baseUrl: String) {
    private val client = McpClient.sync(HttpClientStreamableHttpTransport.builder(baseUrl).endpoint("/api/mcp").build()).build()

    fun refresh() {
        client.initialize()
        client.callTool(CallToolRequest("sync_rates", mapOf("currency" to "EUR")))
    }
}
