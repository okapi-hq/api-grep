package com.example.uploads;

import org.asynchttpclient.AsyncHttpClient;
import org.asynchttpclient.BoundRequestBuilder;
import org.asynchttpclient.Dsl;

/** A request started per verb, its body set after the switch for the verbs that take one. */
class Uploads {
    private final AsyncHttpClient ahc = Dsl.asyncHttpClient();

    Object send(String verb, String url, String payload) {
        final BoundRequestBuilder builder;
        switch (verb) {
            case "GET":
                builder = ahc.prepareGet(url);
                break;
            case "POST":
                builder = ahc.preparePost(url);
                break;
            default:
                throw new IllegalArgumentException(verb);
        }
        if (!"GET".equals(verb)) {
            builder.setBody(payload);
        }
        builder.addHeader("X-Trace", "1");
        return builder.execute();
    }
}
