package com.example.orders;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;
import lombok.Builder;
import lombok.Singular;
import org.springframework.web.client.RestTemplate;

/** `@Singular` adders and copies made with `toBuilder()`. */
@Builder(toBuilder = true)
class CartRequest {
    @JsonProperty("cart_id")
    private String cartId;
    @Singular
    private List<String> items;
    @Singular("label")
    private Map<String, String> labels;
    private String currency;
}

class Carts {
    private final RestTemplate rest = new RestTemplate();

    void fill(String id, String sku) {
        CartRequest body = CartRequest.builder().cartId(id).item(sku).item("gift-wrap").label("channel", "web").build();
        rest.postForObject("https://api.example-shop.com/v1/carts", body, String.class);
    }

    void convert(String id) {
        CartRequest base = CartRequest.builder().cartId(id).currency("USD").build();
        CartRequest copy = base.toBuilder().currency("EUR").build();
        rest.postForObject("https://api.example-shop.com/v1/carts/convert", copy, String.class);
    }
}
