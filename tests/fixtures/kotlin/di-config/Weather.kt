package com.example.weather

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Service
import org.springframework.web.client.RestTemplate
import org.springframework.web.reactive.function.client.WebClient

@ConfigurationProperties(prefix = "weather")
data class WeatherProperties(
    val baseUrl: String = "https://api.weather-example.com",
    val apiKey: String,
    val timeoutSeconds: Int = 5,
)

@Configuration
class WeatherClients {
    @Bean
    fun weatherClient(props: WeatherProperties): WebClient =
        WebClient.builder().baseUrl(props.baseUrl).defaultHeader("X-Api-Key", props.apiKey).build()
}

@Service
class Forecasts(private val weatherClient: WebClient) {
    fun today(city: String) = weatherClient.get().uri("/v1/forecast?city={city}", city).retrieve().bodyToMono(String::class.java)
}

@Service
class Alerts(private val props: WeatherProperties) {
    private val rest = RestTemplate()

    fun active(): String? = rest.getForObject("${props.baseUrl}/v1/alerts", String::class.java)
}

// a settings class Spring does not bind: its default is not the configuration
data class LocalSettings(val baseUrl: String = "https://local.weather-example.com")

@Service
class Stations(private val settings: LocalSettings) {
    private val rest = RestTemplate()

    fun nearby(): String? = rest.getForObject("${settings.baseUrl}/v1/stations", String::class.java)
}
