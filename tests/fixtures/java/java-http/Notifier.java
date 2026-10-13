package com.example.alerts;

import java.io.DataOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

public class Notifier {
    private final HttpClient http;
    private final String token;

    public Notifier(HttpClient http, String token) {
        this.http = http;
        this.token = token;
    }

    public void create(String json) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.example-alerts.com/v1/items?limit=20"))
            .header("Authorization", "Bearer " + token)
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        http.send(req, HttpResponse.BodyHandlers.ofString());
    }

    public String incidents() throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create("https://api.pagerduty.com/incidents"))
            .headers("Accept", "application/json", "Authorization", "Token token=" + token)
            .GET()
            .build();
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString()).body();
    }

    public void resolve(String id, String body) {
        HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.pagerduty.com/incidents/" + id))
            .method("PUT", HttpRequest.BodyPublishers.ofString(body))
            .build();
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding());
    }
}

class Legacy {
    static int post(String payload) throws IOException {
        URL url = new URL("https://events.pagerduty.com/v2/enqueue");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload.getBytes(StandardCharsets.UTF_8));
        }
        return conn.getResponseCode();
    }

    static int ping(String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL("https://api.example-alerts.com/v1/ping").openConnection();
        conn.setDoOutput(true);
        DataOutputStream out = new DataOutputStream(conn.getOutputStream());
        out.writeBytes(body);
        out.flush();
        return conn.getResponseCode();
    }

    static int status() throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL("https://api.example-alerts.com/v1/status").openConnection();
        return conn.getResponseCode();
    }

    String readBundled() throws IOException {
        // a resource read through a URL connection is not a request
        return new String(getClass().getResource("/defaults.json").openConnection().getInputStream().readAllBytes());
    }
}
