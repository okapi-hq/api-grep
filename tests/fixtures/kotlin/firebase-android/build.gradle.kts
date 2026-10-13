plugins {
    id("com.android.application")
}

// Android Firebase artifacts only: none of them is an SDK of providers.json, and firebase-admin is not declared
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-crashlytics")
    implementation("com.google.firebase:firebase-config")
    implementation("com.google.firebase:firebase-perf")
}
