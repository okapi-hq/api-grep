package com.example.orders

import feign.Feign
import feign.Headers
import feign.Param
import feign.RequestLine
import org.springframework.cloud.openfeign.FeignClient
import org.springframework.cloud.openfeign.SpringQueryMap
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.RequestParam

data class Order(val sku: String, val quantity: Int)
data class Filter(val status: String?, val page: Int?)

@FeignClient(name = "orders", url = "\${orders.url:https://api.example-orders.com}", path = "/v2")
interface OrdersClient {
    @GetMapping("/orders/{id}")
    fun get(@PathVariable("id") id: String): Order

    @PostMapping("/orders")
    fun create(@RequestBody order: Order, @RequestParam("dryRun") dryRun: Boolean, @RequestHeader("Idempotency-Key") key: String): Order

    @RequestMapping(method = [RequestMethod.DELETE], value = ["/orders/{id}"])
    fun cancel(@PathVariable id: String)

    @GetMapping("/orders")
    fun search(@SpringQueryMap filter: Filter): List<Order>
}

@Headers("Accept: application/json")
interface Repos {
    @RequestLine("GET /repos/{owner}/{repo}/issues?state={state}")
    fun issues(@Param("owner") owner: String, @Param("repo") repo: String, @Param("state") state: String): String

    @RequestLine("POST /repos/{owner}/{repo}/issues")
    @Headers("Content-Type: application/json")
    fun open(@Param("owner") owner: String, @Param("repo") repo: String, body: String): String
}

object Github {
    val repos: Repos = Feign.builder().target(Repos::class.java, "https://api.github.com")
}
