package com.example.orders.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class ClientConfig {

    @Bean
    @Primary
    public RestTemplate catalogRestTemplate(RestTemplateBuilder builder) {
        return builder.rootUri("https://catalog.orders-example.com").build();
    }

    @Bean
    public RestTemplate shippingRestTemplate(RestTemplateBuilder builder) {
        return builder.rootUri("https://shipping.orders-example.com").build();
    }

    @Bean
    public WebClient billingWebClient(@Value("${billing.url:https://billing.orders-example.com}") String baseUrl) {
        return WebClient.builder().baseUrl(baseUrl).defaultHeader("X-Tenant", "orders").build();
    }

    @Bean
    public WebClient ledgerWebClient() {
        return WebClient.create("https://ledger.orders-example.com");
    }
}
