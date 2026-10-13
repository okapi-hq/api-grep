package com.example.payloads;

import java.io.File;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

/** Overloads that differ only by the payload's type: a call with a payload of unknown type is kept. */
class Payloads {
    private final OkHttpClient client = new OkHttpClient();

    Object forward(Message message) throws Exception {
        return send(message.verb(), message.url(), message.payload());
    }

    Object send(String verb, String url, String payload) throws Exception {
        return call(verb, url, RequestBody.create(payload, MediaType.get("application/json")));
    }

    Object send(String verb, String url, byte[] payload) throws Exception {
        return call(verb, url, RequestBody.create(payload, MediaType.get("application/octet-stream")));
    }

    Object send(String verb, String url, File payload) throws Exception {
        return call(verb, url, RequestBody.create(payload, MediaType.get("application/octet-stream")));
    }

    private Object call(String verb, String url, RequestBody body) throws Exception {
        return client.newCall(new Request.Builder().url(url).method(verb, body).header("X-Client", "payloads").build()).execute();
    }
}

interface Message {
    String verb();

    String url();

    Object payload();
}
