package com.example.forecast.payments

import android.content.Context
import com.stripe.android.PaymentConfiguration

class Checkout(private val context: Context) {
    fun setUp(publishableKey: String) {
        PaymentConfiguration.init(context, publishableKey)
    }
}
