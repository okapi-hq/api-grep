package com.example.billing;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "billing")
public class BillingProperties {
    private Gateway gateway = new Gateway();
    private String merchant = "demo-merchant";

    public Gateway getGateway() {
        return gateway;
    }

    public String getMerchant() {
        return merchant;
    }

    public static class Gateway {
        private String baseUrl = "https://gateway.billing-example.com";

        public String getBaseUrl() {
            return baseUrl;
        }
    }
}
