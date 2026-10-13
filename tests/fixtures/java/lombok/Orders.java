package com.example.orders;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import lombok.Builder;
import lombok.Data;
import lombok.Getter;
import lombok.experimental.SuperBuilder;
import org.springframework.web.client.RestTemplate;

/** Classes whose builders and getters Lombok writes at build time. */
@Builder
class OrderRequest {
    @JsonProperty("customer_id")
    private String customerId;
    private int quantity;
    private String note;
}

@SuperBuilder
class Event {
    private String source;
}

@SuperBuilder
class ShippedEvent extends Event {
    @JsonProperty("tracking_code")
    private String trackingCode;
}

@Getter
class ShopSettings {
    private String baseUrl = "https://api.example-shop.com";
    private String token;
}

@Data
class Refund {
    private String orderId;
    private List<String> lines;
}

class Orders {
    private final RestTemplate rest = new RestTemplate();
    private final ShopSettings settings = new ShopSettings();

    void place(String customer) {
        OrderRequest body = OrderRequest.builder().customerId(customer).quantity(2).build();
        rest.postForObject(settings.getBaseUrl() + "/v1/orders", body, String.class);
    }

    void shipped(String code) {
        rest.postForObject("https://api.example-shop.com/v1/events", ShippedEvent.builder().source("warehouse").trackingCode(code).build(), String.class);
    }

    void refund(String orderId) {
        Refund refund = new Refund();
        refund.setOrderId(orderId);
        rest.postForObject(settings.getBaseUrl() + "/v1/refunds", refund, String.class);
    }
}
