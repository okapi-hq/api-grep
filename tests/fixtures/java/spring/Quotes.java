package com.example.shop;

import java.util.HashMap;
import java.util.Map;
import org.springframework.web.client.RestTemplate;

class Quotes {
    private final RestTemplate restTemplate = new RestTemplate();

    // a HashMap made with an initial capacity, then filled
    String quote(String sku) {
        Map<String, Object> body = new HashMap<>(8);
        body.put("sku", sku);
        return restTemplate.postForObject("https://api.example-shop.com/v1/quotes", body, String.class);
    }

    // a key removed on some paths is not a required one
    String reserve(String sku, boolean gift) {
        Map<String, Object> body = new HashMap<>();
        body.put("sku", sku);
        body.put("wrapping", "paper");
        if (!gift) {
            body.remove("wrapping");
        }
        return restTemplate.postForObject("https://api.example-shop.com/v1/reservations", body, String.class);
    }
}
