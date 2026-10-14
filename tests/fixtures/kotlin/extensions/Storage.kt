package com.example.gallery.storage

import aws.sdk.kotlin.services.s3.S3Client
import aws.sdk.kotlin.services.s3.model.DeleteObjectRequest
import aws.sdk.kotlin.services.s3.model.HeadBucketRequest
import aws.sdk.kotlin.services.s3.model.PutObjectRequest
import aws.smithy.kotlin.runtime.content.ByteStream

suspend fun S3Client.delete(bucketName: String, key: String) {
    this.deleteObject(DeleteObjectRequest { bucket = bucketName; this.key = key })
}

suspend fun S3Client.exists(bucketName: String) = try {
    headBucket(HeadBucketRequest { bucket = bucketName })
    true
} catch (e: Exception) {
    false
}

// a call of another extension of the same type, on the implicit receiver
suspend fun S3Client.replace(bucketName: String, key: String, text: String) {
    delete(bucketName, key)
    putObject(PutObjectRequest { bucket = bucketName; this.key = key; body = ByteStream.fromString(text) })
}
