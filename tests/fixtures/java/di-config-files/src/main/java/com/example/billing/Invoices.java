package com.example.billing;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Configuration
class BillingClients {
    @Bean
    RestClient gatewayClient(BillingProperties props) {
        return RestClient.builder()
            .baseUrl(props.getGateway().getBaseUrl())
            .defaultHeader("X-Merchant", props.getMerchant())
            .build();
    }

    @Bean
    @ConfigurationProperties(prefix = "ledger")
    LedgerSettings ledgerSettings() {
        return new LedgerSettings();
    }
}

class LedgerSettings {
    private String url = "https://ledger-default.billing-example.com";

    public String getUrl() {
        return url;
    }
}

@Service
class Invoices {
    private final RestClient gatewayClient;
    private final LedgerSettings ledger;
    private final RestClient rest = RestClient.create();

    Invoices(RestClient gatewayClient, LedgerSettings ledger) {
        this.gatewayClient = gatewayClient;
        this.ledger = ledger;
    }

    String invoice(String id) {
        return gatewayClient.get().uri("/v2/invoices/{id}", id).retrieve().body(String.class);
    }

    String entries() {
        return rest.get().uri(ledger.getUrl() + "/v1/entries").retrieve().body(String.class);
    }
}
