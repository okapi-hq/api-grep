plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.example.forecast"
    defaultConfig {
        applicationId = "com.example.forecast"
        buildConfigField("String", "FORECAST_URL", "\"https://api.open-meteo.com/\"")
    }
    buildTypes {
        debug {
            buildConfigField("String", "FORECAST_URL", "\"http://10.0.2.2:8080/\"")
        }
    }
    buildFeatures { buildConfig = true }
}

val okhttpVersion: String by project

dependencies {
    implementation(project(":core"))
    implementation(libs.bundles.network)
    implementation("com.squareup.okhttp3:okhttp:$okhttpVersion")
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.firestore)
    implementation(libs.sentry.android)
    implementation("com.stripe:stripe-android:20.53.0")
    // implementation("com.openai:openai-java:0.8.0")
    testImplementation(libs.junit)
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
