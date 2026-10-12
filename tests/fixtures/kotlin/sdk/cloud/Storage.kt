package com.example.archive

import java.net.URI
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request
import software.amazon.awssdk.services.s3.model.PutObjectRequest

const val BUCKET = "report-archive"

class Storage {
    private val s3 = S3Client.builder().region(Region.EU_WEST_1).build()
    private val local: S3Client = S3Client.builder()
        .endpointOverride(URI.create(System.getenv("S3_ENDPOINT") ?: "http://localhost:9000"))
        .build()

    fun upload(key: String, bytes: ByteArray) {
        s3.putObject(PutObjectRequest.builder().bucket(BUCKET).key(key).contentType("application/pdf").build(), RequestBody.fromBytes(bytes))
    }

    fun download(key: String) = s3.getObjectAsBytes { it.bucket(BUCKET).key(key) }

    fun list(prefix: String) {
        val request = ListObjectsV2Request.builder().bucket(BUCKET)
        request.prefix(prefix)
        local.listObjectsV2(request.build())
    }

    fun buckets() = S3Client.create().listBuckets()
}
