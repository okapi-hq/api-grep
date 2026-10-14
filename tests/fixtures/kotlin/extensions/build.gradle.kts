plugins {
    kotlin("jvm") version "2.0.21"
}

dependencies {
    implementation("aws.sdk.kotlin:s3:1.5.40")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.ktor:ktor-client-cio:3.0.1")
}
