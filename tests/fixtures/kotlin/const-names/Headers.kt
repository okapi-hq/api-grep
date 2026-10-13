package com.example.shelf

// header and query names kept as constants, as apps often do
class CacheControl {
    companion object {
        const val SAVE = "X-Save-Data"
        const val PAGE = "page"
    }
}

object HeaderNames {
    const val TRACE = "X-Trace-Id"
    const val TENANT = "X-Tenant"
}

const val ACCEPT_JSON = "application/json"
private const val CLIENT_NAME = "shelf"
