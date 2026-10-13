plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.example.catalog"
    defaultConfig {
        buildConfigField("String", "CATALOG_URL", "\"https://api.example-catalog.com/v2/\"")
    }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
