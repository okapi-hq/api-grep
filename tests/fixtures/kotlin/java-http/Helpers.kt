package com.example.alerts

import java.net.HttpURLConnection
import java.net.URL

// the connection is configured and written by helpers it is passed to
class Pager {
    fun page(message: String) {
        val conn = URL("https://pager.example-alerts.com/v1/pages").openConnection() as HttpURLConnection
        prepare(conn)
        send(conn, "{\"message\":\"$message\"}")
        conn.responseCode
    }

    private fun prepare(connection: HttpURLConnection) {
        connection.requestMethod = "PUT"
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true
    }

    private fun send(connection: HttpURLConnection, json: String) {
        connection.outputStream.use { it.write(json.toByteArray()) }
    }
}
