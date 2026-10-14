package com.example.ledger.service;

import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
class Ledger {
    private final OkHttpClient ledgerClient;
    private final OkHttpClient reportsClient;
    private final OkHttpClient auditClient;
    private final OkHttpClient exportsClient;

    Ledger(@Qualifier("ledgerClient") OkHttpClient ledgerClient, @Qualifier("reportsClient") OkHttpClient reportsClient,
           @Qualifier("auditClient") OkHttpClient auditClient, @Qualifier("exportsClient") OkHttpClient exportsClient) {
        this.ledgerClient = ledgerClient;
        this.reportsClient = reportsClient;
        this.auditClient = auditClient;
        this.exportsClient = exportsClient;
    }

    Response entries() throws IOException {
        return ledgerClient.newCall(new Request.Builder().url("https://api.ledger-example.com/v1/entries").build()).execute();
    }

    Response reports() throws IOException {
        return reportsClient.newCall(new Request.Builder().url("https://reports.ledger-example.com/v1/reports").build()).execute();
    }

    Response audit() throws IOException {
        return auditClient.newCall(new Request.Builder().url("https://audit.ledger-example.com/v1/events").build()).execute();
    }

    Response exports() throws IOException {
        return exportsClient.newCall(new Request.Builder().url("https://exports.ledger-example.com/v1/exports").build()).execute();
    }
}
