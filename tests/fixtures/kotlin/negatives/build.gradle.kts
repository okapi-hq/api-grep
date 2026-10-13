plugins {
    id("com.android.application")
}

repositories {
    google()
    mavenCentral()
    maven("https://jitpack.io")
    maven { url = uri("https://maven.example.org/releases") }
}

android {
    defaultConfig {
        buildConfigField("String", "HELP_URL", "\"https://help.example.org/app\"")
    }
}

dependencies {
    implementation("com.stripe:stripe-java:29.5.0")
    implementation("software.amazon.awssdk:s3:2.33.0")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}

tasks.register("publishDocs") {
    doLast {
        uri("https://docs.example.org/upload").toURL().openStream().close()
    }
}
