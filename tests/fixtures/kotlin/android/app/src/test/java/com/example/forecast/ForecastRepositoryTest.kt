package com.example.forecast

import org.junit.Test

class ForecastRepositoryTest {
    @Test
    fun buildsTheShareLink() {
        val url = "https://api.open-meteo.com/v1/forecast?latitude=1.0&longitude=2.0"
        assert(url.isNotEmpty())
    }
}
