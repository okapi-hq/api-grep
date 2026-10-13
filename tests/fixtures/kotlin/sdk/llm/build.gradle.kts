plugins {
    kotlin("jvm") version "2.0.21"
}

dependencies {
    implementation("com.anthropic:anthropic-java:2.9.0")
    implementation("com.openai:openai-java:4.6.0")
    implementation("com.google.genai:google-genai:1.20.0")
    implementation("software.amazon.awssdk:bedrockruntime:2.33.0")
}
