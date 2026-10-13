package com.example.shop;

import java.io.IOException;
import java.net.URI;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpRequest;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.WebClient;

class PartnerKeyInterceptor implements ClientHttpRequestInterceptor {
    private final String key;

    PartnerKeyInterceptor(String key) {
        this.key = key;
    }

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
        request.getHeaders().add("X-Partner", key);
        return execution.execute(request, body);
    }
}

class Partners {
    // interceptors given to the builder apply to every call of the template
    private final RestTemplate rest = new RestTemplateBuilder()
        .rootUri("https://partners.example-shop.com")
        .additionalInterceptors(new PartnerKeyInterceptor("shop-web"))
        .build();

    String partner(String id) {
        return rest.getForObject("/v1/partners/{id}", String.class, id);
    }

    // a request entity sent by exchange
    String register(Item item, String trace) {
        RequestEntity<Item> request = RequestEntity.post(URI.create("https://partners.example-shop.com/v1/partners"))
            .header("X-Trace", trace)
            .contentType(MediaType.APPLICATION_JSON)
            .body(item);
        return rest.exchange(request, String.class).getBody();
    }
}

class Ledger {
    // an interceptor added to a template after it is made
    private final RestTemplate rest;

    Ledger() {
        RestTemplate template = new RestTemplate();
        template.getInterceptors().add((request, body, execution) -> {
            request.getHeaders().set("X-Ledger-Client", "shop");
            return execution.execute(request, body);
        });
        this.rest = template;
    }

    String balance() {
        return rest.getForObject("https://ledger.example-shop.com/v1/balance", String.class);
    }
}

class Tokens {
    // default headers set in a lambda, and a filter adding one to every request
    private final WebClient client = WebClient.builder()
        .baseUrl("https://auth.example-shop.com")
        .defaultHeaders(h -> h.setBasicAuth("shop", "secret"))
        .filter(ExchangeFilterFunction.ofRequestProcessor(r -> reactor.core.publisher.Mono.just(ClientRequest.from(r).header("X-Shop-Region", "eu").build())))
        .build();

    String token(String scope) {
        return client.post()
            .uri("/oauth/token")
            .body(BodyInserters.fromFormData("grant_type", "client_credentials").with("scope", scope))
            .retrieve()
            .bodyToMono(String.class)
            .block();
    }
}
