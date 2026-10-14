package com.example.gallery

import aws.sdk.kotlin.services.s3.S3Client
import aws.smithy.kotlin.runtime.net.url.Url
import com.example.gallery.storage.delete
import com.example.gallery.storage.exists

class Gallery {
    private val s3 = S3Client {
        region = "eu-west-3"
        endpointUrl = Url.parse("https://storage.gallery-example.com")
    }

    suspend fun remove(photo: String) = s3.delete("gallery-photos", "originals/$photo")

    suspend fun ready() = s3.exists("gallery-photos")
}
