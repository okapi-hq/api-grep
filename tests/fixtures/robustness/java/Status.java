package com.example.broken;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Status {
    // a self-referencing constant and a recursive factory must not loop
    static final String LOOP = LOOP + "/x";

    static String base() {
        return base();
    }

    public String status() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.github.com/status")).build();
        HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base() + LOOP)).build(), HttpResponse.BodyHandlers.ofString());
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString()).body();
    }
}
