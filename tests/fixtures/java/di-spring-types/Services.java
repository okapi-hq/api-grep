package com.example.invoices.service;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;

@Service
public class InvoiceService {
    private final RestTemplate invoices;
    private final RestTemplate reports;
    private final WebClient payments;

    public InvoiceService(@Qualifier("invoicesTemplate") RestTemplate invoices, @Qualifier("reportsTemplate") RestTemplate reports, WebClient payments) {
        this.invoices = invoices;
        this.reports = reports;
        this.payments = payments;
    }

    public String invoice(String id) {
        return invoices.getForObject("/v1/invoices/{id}", String.class, id);
    }

    public String monthly() {
        return reports.getForObject("/v1/reports/monthly", String.class);
    }

    public String status(String id) {
        return payments.get().uri("/v1/payments/{id}", id).retrieve().bodyToMono(String.class).block();
    }
}
