plugins {
    kotlin("jvm") version "2.0.21"
}

val awsKotlin = "1.5.40"

dependencies {
    implementation("aws.sdk.kotlin:s3:$awsKotlin")
    implementation("aws.sdk.kotlin:dynamodb:$awsKotlin")
    implementation("aws.sdk.kotlin:sqs:$awsKotlin")
    implementation("aws.sdk.kotlin:sns:$awsKotlin")
    implementation("aws.sdk.kotlin:bedrockruntime:$awsKotlin")
    implementation("software.amazon.awssdk:sns:2.33.0")
    implementation("software.amazon.awssdk:ses:2.33.0")
    implementation("software.amazon.awssdk:sesv2:2.33.0")
    implementation("software.amazon.awssdk:s3-transfer-manager:2.33.0")
}
