package com.example.lagoon

import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.client.Client
import io.modelcontextprotocol.kotlin.sdk.client.StdioClientTransport
import kotlinx.io.asSink
import kotlinx.io.asSource
import kotlinx.io.buffered

class LocalAgent {
    private val client = Client(Implementation(name = "lagoon-local", version = "1.0.0"))

    suspend fun run(process: Process) {
        val transport = StdioClientTransport(input = process.inputStream.asSource().buffered(), output = process.outputStream.asSink().buffered())
        client.connect(transport)
        client.listTools()
    }
}
