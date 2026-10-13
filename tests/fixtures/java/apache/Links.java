package com.example.links;

import java.util.ArrayList;
import java.util.List;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.fluent.Form;
import org.apache.http.client.fluent.Request;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.methods.HttpUriRequest;
import org.apache.http.client.methods.RequestBuilder;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.message.BasicNameValuePair;

/** Apache HttpClient 4: request objects, RequestBuilder, URIBuilder, form entities and the fluent API. */
class Links {
    private static final String BASE = "https://api.example-links.com";
    private final CloseableHttpClient client = HttpClients.createDefault();

    String shorten(String url, String token) throws Exception {
        HttpPost post = new HttpPost(BASE + "/v1/links");
        post.setHeader("Authorization", "Bearer " + token);
        post.setEntity(new StringEntity("{\"url\":\"" + url + "\"}", ContentType.APPLICATION_JSON));
        try (CloseableHttpResponse response = client.execute(post)) {
            return response.getStatusLine().toString();
        }
    }

    String search(String query) throws Exception {
        URIBuilder builder = new URIBuilder(BASE + "/v1/search").addParameter("q", query).addParameter("limit", "20");
        HttpGet get = new HttpGet(builder.build());
        return client.execute(get, response -> "ok");
    }

    String token(String id, String secret) throws Exception {
        List<NameValuePair> form = new ArrayList<>();
        form.add(new BasicNameValuePair("grant_type", "client_credentials"));
        form.add(new BasicNameValuePair("client_id", id));
        form.add(new BasicNameValuePair("client_secret", secret));
        HttpPost post = new HttpPost("https://auth.example-links.com/oauth/token");
        post.setEntity(new UrlEncodedFormEntity(form, "UTF-8"));
        return client.execute(post).toString();
    }

    String archive(String id) throws Exception {
        HttpUriRequest request = RequestBuilder.delete(BASE + "/v1/links/" + id).addHeader("X-Reason", "expired").build();
        return send(request);
    }

    String rename(String id, String title) throws Exception {
        return send(RequestBuilder.post(BASE + "/v1/links/" + id + "/title").addParameter("title", title).build());
    }

    private String send(HttpUriRequest request) throws Exception {
        return client.execute(request).toString();
    }

    String event(String json) throws Exception {
        return Request.Post(BASE + "/v1/events").bodyString(json, ContentType.APPLICATION_JSON).execute().returnContent().asString();
    }

    String subscribe(String email) throws Exception {
        return Request.Post(BASE + "/v1/subscribers")
            .addHeader("X-Source", "site")
            .bodyForm(Form.form().add("email", email).add("list", "weekly").build())
            .execute()
            .returnContent()
            .asString();
    }
}
