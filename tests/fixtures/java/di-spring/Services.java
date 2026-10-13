package com.example.orders.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;

// one constructor: injected; the @Primary RestTemplate
@Service
class CatalogService {
    private final RestTemplate restTemplate;

    CatalogService(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    String item(String id) {
        return restTemplate.getForObject("/v1/items/{id}", String.class, id);
    }
}

// a qualifier names the bean
@Service
class ShippingService {
    private final RestTemplate rest;

    ShippingService(@Qualifier("shippingRestTemplate") RestTemplate rest) {
        this.rest = rest;
    }

    String quote(String zip) {
        return rest.getForObject("/v1/quotes?zip={zip}", String.class, zip);
    }
}

// field injection: the bean named like the field
@Service
class BillingService {
    @Autowired
    private WebClient billingWebClient;

    String invoices() {
        return billingWebClient.get().uri("/v1/invoices").retrieve().bodyToMono(String.class).block();
    }
}

// two WebClient beans, neither primary nor named like the field: no guess
@Service
class AuditService {
    @Autowired
    private WebClient client;

    String events() {
        return client.get().uri("/v1/events").retrieve().bodyToMono(String.class).block();
    }
}
