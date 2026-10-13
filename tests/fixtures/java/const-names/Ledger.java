package com.example.ledger;

import static com.example.ledger.HeaderNames.TENANT;

import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import retrofit2.Call;
import retrofit2.Retrofit;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Headers;
import retrofit2.http.Query;

interface LedgerApi {
    String CLIENT = "ledger";

    @Headers({"Accept: " + HeaderNames.ACCEPT_JSON, "X-Client: " + CLIENT + "-android"})
    @GET("entries")
    Call<String> entries(@Header(HeaderNames.TRACE) String trace, @Query(HeaderNames.PAGE) int page);
}

@FeignClient(name = "balances", url = "https://balances.example.com")
interface BalancesClient {
    @GetMapping("/v1/balances")
    String balances(@RequestHeader(TENANT) String tenant, @RequestParam(HeaderNames.PAGE) int page);
}

public class Ledger {
    private final OkHttpClient http = new OkHttpClient();
    final LedgerApi api = new Retrofit.Builder().baseUrl("https://ledger.example.com/v2/").build().create(LedgerApi.class);

    void close(String id) throws IOException {
        Request request = new Request.Builder()
            .url("https://ledger.example.com/v2/entries/" + id + "/close")
            .header(HeaderNames.TRACE, id)
            .addHeader(TENANT, "main")
            .post(okhttp3.RequestBody.create(new byte[0]))
            .build();
        http.newCall(request).execute();
    }
}
