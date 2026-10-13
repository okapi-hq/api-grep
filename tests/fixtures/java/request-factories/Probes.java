package com.example.probes;

import java.net.HttpURLConnection;
import java.net.URL;

/** A method set in a branch is not known; a convenience overload delegating to the full one is followed. */
class Probes {
    HttpURLConnection check() throws Exception {
        return open("https://api.example-probes.com/v1/health");
    }

    HttpURLConnection open(String url) throws Exception {
        return open(url, true);
    }

    HttpURLConnection open(String url, boolean head) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestProperty("Accept", "application/json");
        if (head) {
            conn.setRequestMethod("HEAD");
        }
        return conn;
    }
}
