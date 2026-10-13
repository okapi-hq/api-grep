package com.example.links

import io.grpc.CallOptions
import io.grpc.ManagedChannel
import io.grpc.MethodDescriptor
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

// endpoints this service serves, not requests it sends
@RestController
class LinksController {
    @GetMapping("/links/{id}")
    fun get(id: String): String = id

    @PostMapping("/links")
    fun create(@RequestBody url: String): String = url
}

fun Application.routes() {
    routing {
        get("/health") { call.respondText("ok") }
        post("/links") { call.respondText("created") }
    }
}

// a gRPC call is not an OkHttp call, even with a descriptor built by `newBuilder()`
class Lookup(private val channel: ManagedChannel) {
    private val method = MethodDescriptor.newBuilder<String, String>()
        .setType(MethodDescriptor.MethodType.UNARY)
        .setFullMethodName("links.Lookup/Get")
        .build()

    fun call() = channel.newCall(method, CallOptions.DEFAULT)
}

class Settings {
    private val defaults = HashMap<String, String>()

    fun send(key: String) = defaults.put(key, "x")

    fun get(key: String): String? = defaults.get(key)
}
