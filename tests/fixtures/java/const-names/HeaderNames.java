package com.example.ledger;

// header and query names kept as constants, as apps often do
public final class HeaderNames {
    public static final String TRACE = "X-Trace-Id";
    public static final String TENANT = "X-Tenant";
    public static final String PAGE = "page";
    public static final String ACCEPT_JSON = "application/json";

    private HeaderNames() {}
}
