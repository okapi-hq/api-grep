package com.example.warehouse;

import software.amazon.awssdk.services.sns.*;
import software.amazon.awssdk.services.sns.model.*;

// the client and request classes come from star imports
public class Alerts {
    private final SnsClient sns = SnsClient.create();

    public void lowStock(String topicArn, String sku) {
        sns.publish(PublishRequest.builder().topicArn(topicArn).subject("Low stock").message(sku).build());
    }
}
