package com.example.invoices.http;

import java.util.List;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class ClientConfig {

    // every bean implementing the interface
    @Bean
    public RestTemplate invoicesTemplate(RestTemplateBuilder builder, List<ClientHttpRequestInterceptor> interceptors) {
        return builder.rootUri("https://api.invoices-example.com").additionalInterceptors(interceptors).build();
    }

    // the one bean implementing the interface
    @Bean
    public WebClient paymentsClient(ExchangeFilterFunction tenant) {
        return WebClient.builder().baseUrl("https://payments.invoices-example.com").filter(tenant).build();
    }

    // two beans implement the interface, none is primary or named like the parameter: neither is given
    @Bean
    public RestTemplate reportsTemplate(RestTemplateBuilder builder, ClientHttpRequestInterceptor interceptor) {
        return builder.rootUri("https://reports.invoices-example.com").additionalInterceptors(interceptor).build();
    }
}
