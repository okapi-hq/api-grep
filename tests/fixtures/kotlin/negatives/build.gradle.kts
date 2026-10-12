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

tasks.register("publishDocs") {
    doLast {
        uri("https://docs.example.org/upload").toURL().openStream().close()
    }
}
