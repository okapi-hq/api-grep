package com.example.catalog

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import org.springframework.web.reactive.function.client.WebClient

@ConfigurationProperties(prefix = "catalog")
data class CatalogProperties(val api: Api = Api(), val timeoutSeconds: Int = 10) {
    data class Api(val baseUrl: String = "https://api.catalog-example.com", val region: String = "eu")
}

// a class bound by the bean method that returns it, not by an annotation of its own
class InventorySettings {
    var baseUrl: String = "https://inventory-default.example.com"
}

// bound twice, under two prefixes: which one a client gets is not known
class MirrorSettings {
    var baseUrl: String = "https://mirror-default.example.com"
}

@Configuration
class CatalogClients {
    @Bean
    fun catalogClient(props: CatalogProperties): WebClient =
        WebClient.builder().baseUrl(props.api.baseUrl).defaultHeader("X-Region", props.api.region).build()

    @Bean
    @ConfigurationProperties(prefix = "inventory")
    fun inventorySettings() = InventorySettings()

    @Bean
    fun inventoryClient(settings: InventorySettings): RestClient = RestClient.builder().baseUrl(settings.baseUrl).build()

    @Bean
    @ConfigurationProperties(prefix = "mirror.primary")
    fun primaryMirror(): MirrorSettings = MirrorSettings()

    @Bean
    @ConfigurationProperties(prefix = "mirror.backup")
    fun backupMirror(): MirrorSettings = MirrorSettings()
}

@Service
class Products(private val catalogClient: WebClient, private val inventoryClient: RestClient, private val mirror: MirrorSettings) {
    private val rest = RestClient.create()

    fun list() = catalogClient.get().uri("/v3/products").retrieve().bodyToMono(String::class.java)

    fun stock(sku: String) = inventoryClient.get().uri("/v1/stock/{sku}", sku).retrieve().body(String::class.java)

    fun mirrored() = rest.get().uri("${mirror.baseUrl}/v3/products").retrieve().body(String::class.java)
}
