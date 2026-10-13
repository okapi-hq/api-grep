package com.example.shop

import aws.sdk.kotlin.services.dynamodb.DynamoDbClient
import aws.sdk.kotlin.services.dynamodb.model.AttributeValue
import aws.sdk.kotlin.services.dynamodb.model.GetItemRequest
import aws.sdk.kotlin.services.dynamodb.model.PutItemRequest
import aws.sdk.kotlin.services.s3.S3Client
import aws.sdk.kotlin.services.s3.model.PutObjectRequest
import aws.sdk.kotlin.services.sns.SnsClient
import aws.sdk.kotlin.services.sqs.SqsClient
import aws.smithy.kotlin.runtime.content.ByteStream
import aws.smithy.kotlin.runtime.net.url.Url

const val ORDERS_TABLE = "shop-orders"

class Orders {
    private val sqs = SqsClient { region = "eu-west-3" }
    private val storage = S3Client {
        region = "eu-west-3"
        endpointUrl = Url.parse(System.getenv("S3_ENDPOINT") ?: "http://localhost:4566")
    }

    suspend fun save(id: String, total: String) {
        val request = PutItemRequest {
            tableName = ORDERS_TABLE
            item = mapOf("id" to AttributeValue.S(id), "total" to AttributeValue.N(total))
        }
        DynamoDbClient.fromEnvironment { region = "eu-west-3" }.use { ddb ->
            ddb.putItem(request)
        }
    }

    suspend fun find(id: String) = DynamoDbClient { region = "eu-west-3" }.use { ddb ->
        ddb.getItem(GetItemRequest { tableName = ORDERS_TABLE; key = mapOf("id" to AttributeValue.S(id)) })
    }

    suspend fun enqueue(url: String, text: String) {
        sqs.sendMessage {
            queueUrl = url
            messageBody = text
            delaySeconds = 5
        }
    }

    suspend fun archive(key: String, text: String) {
        storage.putObject(PutObjectRequest { bucket = "shop-archive"; this.key = key; body = ByteStream.fromString(text) })
    }

    suspend fun announce(arn: String, text: String) = SnsClient.fromEnvironment().use { sns ->
        sns.publish { topicArn = arn; message = text }
    }
}
