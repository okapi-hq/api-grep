plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.trips"
    defaultConfig {
        applicationId = "com.example.trips"
        buildConfigField("String", "TRIPS_URL", "\"https://api.example-trips.com/v1/\"")
    }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.posthog:posthog:3.8.0")
    implementation("io.sentry:sentry-android:7.14.0")
    testImplementation("junit:junit:4.13.2")
}
