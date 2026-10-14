package com.example.payments;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

@Configuration
class Clients {
    @Bean
    RestClient paymentsClient(PaymentsProperties props) {
        return RestClient.builder()
            .baseUrl(props.getBaseUrl())
            .defaultHeader(PaymentsProperties.HEADER, props.getMerchantId())
            .build();
    }
}

@Service
class Charges {
    private final RestClient paymentsClient;

    Charges(RestClient paymentsClient) {
        this.paymentsClient = paymentsClient;
    }

    String charge(String body) {
        return paymentsClient.post().uri("/v1/charges").body(body).retrieve().body(String.class);
    }
}

@Service
class Rates {
    private final ShippingProperties shipping;
    private final RestTemplate rest = new RestTemplate();

    Rates(ShippingProperties shipping) {
        this.shipping = shipping;
    }

    String quote(String zip) {
        return rest.getForObject(shipping.ratesUrl() + "/v2/rates?zip=" + zip, String.class);
    }
}
