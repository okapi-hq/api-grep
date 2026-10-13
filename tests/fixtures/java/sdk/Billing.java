package com.example.assistant;

import com.stripe.Stripe;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.PaymentIntent;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.PaymentIntentCreateParams;
import java.util.HashMap;
import java.util.Map;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

public class Billing {
    private static final String BUCKET = "example-invoices";
    private final S3Client s3 = S3Client.create();

    static {
        Stripe.apiKey = System.getenv("STRIPE_KEY");
    }

    public Customer register(String email) throws StripeException {
        return Customer.create(CustomerCreateParams.builder().setEmail(email).build());
    }

    public PaymentIntent charge(String customer, long cents) throws StripeException {
        PaymentIntentCreateParams.Builder params = PaymentIntentCreateParams.builder();
        params.setAmount(cents);
        params.setCurrency("eur");
        params.setCustomer(customer);
        return PaymentIntent.create(params.build());
    }

    public Customer rename(String id, String name) throws StripeException {
        Map<String, Object> changes = new HashMap<>();
        changes.put("name", name);
        return Customer.retrieve(id).update(changes);
    }

    public void archive(String invoiceId, byte[] pdf) {
        s3.putObject(PutObjectRequest.builder().bucket(BUCKET).key("invoices/" + invoiceId + ".pdf").build(), RequestBody.fromBytes(pdf));
    }
}
