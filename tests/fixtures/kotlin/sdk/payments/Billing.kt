package com.example.shop

import com.stripe.Stripe
import com.stripe.StripeClient
import com.stripe.model.Customer
import com.stripe.model.PaymentIntent
import com.stripe.model.checkout.Session
import com.stripe.param.CustomerCreateParams
import com.stripe.param.PaymentIntentCreateParams
import com.stripe.param.checkout.SessionCreateParams

class Billing(private val successUrl: String) {
    init {
        Stripe.apiKey = System.getenv("STRIPE_KEY")
    }

    fun register(email: String): Customer = Customer.create(CustomerCreateParams.builder().setEmail(email).build())

    fun rename(id: String, name: String) {
        val customer = Customer.retrieve(id)
        customer.update(mapOf("name" to name))
    }

    fun charge(customer: Customer, cents: Long) {
        val params = PaymentIntentCreateParams.builder()
        params.setAmount(cents)
        params.setCurrency("eur")
        params.setCustomer(customer.id)
        params.putMetadata("source", "app")
        check(!params.equals(null))
        PaymentIntent.create(params.build())
    }

    fun checkout(price: String): Session =
        Session.create(
            SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                .setSuccessUrl(successUrl)
                .addLineItem(SessionCreateParams.LineItem.builder().setPrice(price).setQuantity(1L).build())
                .build()
        )
}

class Refunds(private val stripe: StripeClient = StripeClient(System.getenv("STRIPE_KEY"))) {
    fun cancel(intent: String) = stripe.paymentIntents().cancel(intent)

    fun customers() = stripe.v1().customers().list()
}
