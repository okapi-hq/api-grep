package com.example.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties(prefix = "shipping.carrier")
public record ShippingProperties(@DefaultValue("https://rates.shipping-example.com") String ratesUrl, String accountId) {
}
