package com.example.links;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleRequestBuilder;
import org.apache.hc.client5.http.classic.methods.HttpPut;
import org.apache.hc.client5.http.entity.mime.MultipartEntityBuilder;
import org.apache.hc.client5.http.impl.async.CloseableHttpAsyncClient;
import org.apache.hc.client5.http.impl.async.HttpAsyncClients;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.StringEntity;
import org.apache.hc.core5.http.io.support.ClassicRequestBuilder;

/** Apache HttpClient 5: classic request objects and builders, the async client, multipart entities. */
class Reports {
    private final CloseableHttpClient http;
    private final CloseableHttpAsyncClient async = HttpAsyncClients.createDefault();

    Reports() {
        this.http = HttpClients.custom().build();
    }

    String publish(String id, String json) throws Exception {
        HttpPut put = new HttpPut("https://api.example-reports.com/v2/reports/" + id);
        put.addHeader("X-Api-Key", System.getenv("REPORTS_KEY"));
        put.setEntity(new StringEntity(json, ContentType.APPLICATION_JSON));
        return http.execute(put, response -> String.valueOf(response.getCode()));
    }

    void upload(java.io.File file) throws Exception {
        http.execute(ClassicRequestBuilder.post("https://api.example-reports.com/v2/uploads")
            .setEntity(MultipartEntityBuilder.create().addTextBody("kind", "pdf").addBinaryBody("file", file).build())
            .build(), response -> null);
    }

    void ping(String json) {
        SimpleHttpRequest request = SimpleRequestBuilder.post("https://api.example-reports.com/v2/ping")
            .setBody(json, ContentType.APPLICATION_JSON)
            .build();
        async.execute(request, null);
    }
}
