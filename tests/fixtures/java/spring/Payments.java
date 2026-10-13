package com.example.shop;

import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.UriComponentsBuilder;

record Item(String id, String name) {}

@Service
class Catalog {
    private static final String BASE = "https://api.example-shop.com";
    private final RestTemplate restTemplate;
    private final RestClient restClient;

    Catalog(RestTemplate restTemplate, RestClient restClient) {
        this.restTemplate = restTemplate;
        this.restClient = restClient;
    }

    Item item(String id) {
        return restTemplate.getForObject(BASE + "/v1/items/{id}", Item.class, id);
    }

    String create(Item item, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return restTemplate.exchange(BASE + "/v1/items", HttpMethod.POST, new HttpEntity<>(item, headers), String.class).getBody();
    }

    void refund(String charge) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("charge", charge);
        restTemplate.postForObject("https://api.stripe.com/v1/refunds", form, String.class);
    }

    String search(String term) {
        String url = UriComponentsBuilder.fromHttpUrl(BASE)
            .path("/v1/search")
            .queryParam("q", term)
            .toUriString();
        return restTemplate.getForObject(url, String.class);
    }

    String rate(String sku) {
        Map<String, Object> body = new HashMap<>();
        body.put("sku", sku);
        body.put("currency", "EUR");
        return restTemplate.postForObject(BASE + "/v1/rates", body, String.class);
    }

    String page() {
        return restClient.get().uri(BASE + "/v1/items?limit={limit}", 20).retrieve().body(String.class);
    }
}

class Charges {
    private final WebClient client;

    Charges(WebClient.Builder builder, @Value("${stripe.key}") String key) {
        this.client = builder
            .baseUrl("https://api.stripe.com")
            .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + key)
            .build();
    }

    Object list() {
        return client.get().uri("/v1/charges").retrieve().bodyToMono(String.class);
    }

    Object capture(String id, int amount) {
        return client.post()
            .uri(b -> b.path("/v1/charges/{id}/capture").queryParam("expand", "balance_transaction").build(id))
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue(Map.of("amount", amount))
            .retrieve();
    }
}

class Status {
    private final WebClient client = WebClient.create("https://api.example-shop.com");

    Object ping() {
        return client.get().uri("/v1/status").headers(h -> h.setBasicAuth("ops", "secret")).retrieve();
    }
}

// a server endpoint: not an outbound call
@RestController
class ItemsController {
    @GetMapping("/items/{id}")
    Item get(@PathVariable String id) {
        return new Item(id, "x");
    }
}
