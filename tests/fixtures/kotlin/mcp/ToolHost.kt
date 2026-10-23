package com.example.lagoon

import io.modelcontextprotocol.kotlin.sdk.Implementation
import io.modelcontextprotocol.kotlin.sdk.ServerCapabilities
import io.modelcontextprotocol.kotlin.sdk.server.Server
import io.modelcontextprotocol.kotlin.sdk.server.ServerOptions

fun toolHost(): Server {
    val server = Server(Implementation(name = "lagoon-tools", version = "1.0.0"), ServerOptions(capabilities = ServerCapabilities()))
    server.addTool(name = "echo", description = "Echoes its input") { request -> TODO() }
    return server
}
