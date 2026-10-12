package com.example.shop

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpEntity
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.util.UriComponentsBuilder

data class Item(val id: String, val name: String)

class Catalog(private val restTemplate: RestTemplate, private val restClient: RestClient) {
    fun item(id: String): Item? = restTemplate.getForObject("https://api.example-shop.com/v1/items/{id}", Item::class.java, id)

    fun create(item: Item, token: String): String? {
        val headers = HttpHeaders()
        headers.setBearerAuth(token)
        headers.contentType = MediaType.APPLICATION_JSON
        return restTemplate.exchange("https://api.example-shop.com/v1/items", HttpMethod.POST, HttpEntity(item, headers), String::class.java).body
    }

    fun refund(charge: String) {
        val form = LinkedMultiValueMap<String, String>()
        form.add("charge", charge)
        restTemplate.postForObject("https://api.stripe.com/v1/refunds", form, String::class.java)
    }

    fun search(term: String): String? {
        val url = UriComponentsBuilder.fromHttpUrl("https://api.example-shop.com")
            .path("/v1/search")
            .queryParam("q", term)
            .toUriString()
        return restTemplate.getForObject(url, String::class.java)
    }

    fun page() = restClient.get().uri("https://api.example-shop.com/v1/items?limit={limit}", 20).retrieve().body(String::class.java)
}

class Charges(builder: WebClient.Builder, @Value("\${stripe.key}") private val key: String) {
    private val client = builder
        .baseUrl("https://api.stripe.com")
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer $key")
        .build()

    fun list() = client.get().uri("/v1/charges").retrieve().bodyToMono(String::class.java)

    fun capture(id: String, amount: Int) = client.post()
        .uri { it.path("/v1/charges/{id}/capture").queryParam("expand", "balance_transaction").build(id) }
        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
        .bodyValue(mapOf("amount" to amount))
        .retrieve()
}

class Status {
    private val client = WebClient.create("https://api.example-shop.com")

    fun ping() = client.get().uri("/v1/status").headers { it.setBasicAuth("ops", "secret") }.retrieve()
}
