package com.example.wallet;

import java.io.IOException;
import okhttp3.Callback;
import okhttp3.FormBody;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.json.JSONObject;

public class Messages {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private final OkHttpClient client;

    public Messages(OkHttpClient client) {
        this.client = client;
    }

    public void send(String to, String text) throws IOException {
        RequestBody form = new FormBody.Builder()
            .add("to", to)
            .add("text", text)
            .build();
        Request req = new Request.Builder()
            .url("https://api.mailgun.net/v3/mg.example.com/messages")
            .post(form)
            .build();
        client.newCall(req).execute();
    }

    public void upload(byte[] bytes, Callback callback) {
        RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("upload_preset", "avatars").build();
        client.newCall(new Request.Builder().url("https://api.cloudinary.com/v1_1/demo/image/upload").post(body).build()).enqueue(callback);
    }

    public String search(String query) throws IOException {
        HttpUrl url = new HttpUrl.Builder()
            .scheme("https")
            .host("api.unsplash.com")
            .addPathSegments("search/photos")
            .addQueryParameter("query", query)
            .build();
        return execute(new Request.Builder().url(url).build());
    }

    public void balance(String address) throws IOException {
        JSONObject payload = new JSONObject();
        payload.put("method", "getBalance");
        payload.put("address", address);
        RequestBody body = RequestBody.create(payload.toString(), JSON);
        Request request = new Request.Builder()
            .url("https://rpc.example.com/v1/balances")
            .header("X-Api-Key", System.getenv("RPC_KEY"))
            .post(body)
            .build();
        client.newCall(request).execute();
    }

    private String execute(Request request) throws IOException {
        return client.newCall(request).execute().body().string();
    }
}
