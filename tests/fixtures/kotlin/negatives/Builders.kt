package com.example.links

import com.stripe.param.CustomerCreateParams
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.PutObjectRequest

/** SDK objects that are built but never sent, and project classes named like SDK ones. */
class Customer(val email: String) {
    fun create(): Customer = Customer(email)

    fun update(email: String) = Customer(email)
}

class Message private constructor(val text: String) {
    class Builder {
        private var text = ""
        fun text(value: String) = apply { text = value }
        fun build() = Message(text)
    }

    companion object {
        fun builder() = Builder()
    }
}

class Drafts {
    private val s3 = S3Client.builder().build()

    fun draft(email: String) = CustomerCreateParams.builder().setEmail(email).build()

    fun request(key: String): PutObjectRequest = PutObjectRequest.builder().bucket("drafts").key(key).build()

    fun local(email: String) = Customer(email).create().update(email)

    fun note(text: String) = Message.builder().text(text).build()

    fun close() = s3.close()
}
