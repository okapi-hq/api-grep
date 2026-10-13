package com.example.shop

import java.net.URI
import org.springframework.http.HttpMethod
import org.springframework.http.RequestEntity
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.web.client.RestTemplate
import org.springframework.web.reactive.function.client.WebClient

class Inventory(private val token: String) {
    private val rest = RestTemplate().apply {
        interceptors.add(ClientHttpRequestInterceptor { request, body, execution ->
            request.headers.set("X-Warehouse", "north")
            execution.execute(request, body)
        })
    }

    fun stock(sku: String): String? = rest.getForObject("https://inventory.example-shop.com/v1/stock/{sku}", String::class.java, sku)

    fun reserve(sku: String): String? {
        val request = RequestEntity.method(HttpMethod.PUT, URI.create("https://inventory.example-shop.com/v1/reservations/$sku"))
            .header("X-Request-Source", "kotlin")
            .build()
        return rest.exchange(request, String::class.java).body
    }

    private val events = WebClient.builder()
        .baseUrl("https://events.example-shop.com")
        .defaultHeaders { it.setBearerAuth(token) }
        .build()

    fun recent() = events.get().uri("/v1/recent").retrieve()
}
