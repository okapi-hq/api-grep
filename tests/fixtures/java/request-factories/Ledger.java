package com.example.ledger;

import java.util.List;
import org.apache.http.HttpHost;
import org.apache.http.HttpRequestInterceptor;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.methods.HttpUriRequest;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.message.BasicHeader;

/** Apache HttpClient: a request factory with two returns, a target host given apart, client-wide headers. */
class Ledger {
    private final CloseableHttpClient client;

    Ledger(String key, String tenant) {
        this.client = HttpClients.custom()
            .setDefaultHeaders(List.of(new BasicHeader("X-Api-Key", key)))
            .addInterceptorFirst((HttpRequestInterceptor) (request, context) -> request.addHeader("X-Tenant", tenant))
            .build();
    }

    Object entries(boolean write) throws Exception {
        return client.execute(request(write, "https://api.example-ledger.com/v2/entries"));
    }

    Object balances() throws Exception {
        return client.execute(new HttpHost("api.example-ledger.com", 443, "https"), new HttpGet("/v2/balances"));
    }

    Object health() throws Exception {
        return client.execute(HttpHost.create("https://status.example-ledger.com:8443"), new HttpGet("/health"));
    }

    // a write is a POST, a read a GET
    private HttpUriRequest request(boolean write, String url) {
        if (write) {
            return new HttpPost(url);
        }
        return new HttpGet(url);
    }
}
