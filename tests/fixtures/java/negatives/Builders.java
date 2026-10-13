package com.example.links;

import com.stripe.param.CustomerCreateParams;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

/** SDK objects that are built but never sent, and project classes named like SDK ones. */
class Customer {
    private final String email;

    Customer(String email) {
        this.email = email;
    }

    Customer create() {
        return new Customer(email);
    }

    Customer update(String email) {
        return new Customer(email);
    }
}

class Message {
    private final String text;

    private Message(String text) {
        this.text = text;
    }

    static Builder builder() {
        return new Builder();
    }

    static class Builder {
        private String text = "";

        Builder text(String value) {
            this.text = value;
            return this;
        }

        Message build() {
            return new Message(text);
        }
    }
}

class Drafts {
    private final S3Client s3 = S3Client.builder().build();

    CustomerCreateParams draft(String email) {
        return CustomerCreateParams.builder().setEmail(email).build();
    }

    PutObjectRequest request(String key) {
        return PutObjectRequest.builder().bucket("drafts").key(key).build();
    }

    Customer local(String email) {
        return new Customer(email).create().update(email);
    }

    Message note(String text) {
        return Message.builder().text(text).build();
    }

    void close() {
        s3.close();
    }
}
