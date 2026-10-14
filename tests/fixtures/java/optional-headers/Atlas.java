package com.example.atlas;

import java.io.IOException;
import java.util.Optional;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.apache.http.HttpRequestInterceptor;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestTemplate;

// headers set on every request, and some only for some URLs or after an early return
class AtlasHeaders implements Interceptor {
    private final String token;
    private final Optional<String> device;

    AtlasHeaders(String token, Optional<String> device) {
        this.token = token;
        this.device = device;
    }

    @Override
    public Response intercept(Interceptor.Chain chain) throws IOException {
        Request request = chain.request();
        Request.Builder builder = request.newBuilder().header("User-Agent", "atlas-java");
        if (request.url().encodedPath().startsWith("/tiles/")) {
            builder.header("Accept", "image/png");
        }
        if (request.url().encodedPath().startsWith("/v2/")) {
            builder.header("X-Atlas-Mode", "v2");
        } else {
            builder.header("X-Atlas-Mode", "v1");
        }
        device.ifPresent(d -> builder.header("X-Device", d));
        if (!request.url().host().equals("atlas.example.com")) return chain.proceed(builder.build());
        return chain.proceed(builder.header("Authorization", "Bearer " + token).build());
    }
}

// a Spring interceptor that adds a header for some requests only
class RegionInterceptor implements ClientHttpRequestInterceptor {
    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
        request.getHeaders().add("X-Atlas-Client", "web");
        if (request.getURI().getPath().startsWith("/eu/")) {
            request.getHeaders().add("X-Atlas-Region", "eu");
        }
        return execution.execute(request, body);
    }
}

class AtlasClient {
    private final OkHttpClient http;

    AtlasClient(String token, Optional<String> device) {
        this.http = new OkHttpClient.Builder().addInterceptor(new AtlasHeaders(token, device)).build();
    }

    Response tiles(int z) throws IOException {
        return http.newCall(new Request.Builder().url("https://atlas.example.com/tiles/" + z).build()).execute();
    }

    private final RestTemplate rest = new RestTemplateBuilder()
        .rootUri("https://atlas.example.com")
        .additionalInterceptors(new RegionInterceptor())
        .build();

    String place(String id) {
        return rest.getForObject("/v1/places/{id}", String.class, id);
    }

    // an Apache interceptor that adds a header when a value is set
    private final CloseableHttpClient legacy = HttpClients.custom()
        .addInterceptorFirst((HttpRequestInterceptor) (request, context) -> {
            if (context.getAttribute("trace") != null) request.addHeader("X-Trace", "on");
        })
        .build();

    void health() throws IOException {
        legacy.execute(new HttpGet("https://atlas.example.com/health"));
    }
}
