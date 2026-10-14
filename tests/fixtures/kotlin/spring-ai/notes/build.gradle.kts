plugins {
    kotlin("jvm") version "2.0.21"
}

// Spring AI's core only: no model starter tells which provider a ChatClient talks to
dependencies {
    implementation("org.springframework.ai:spring-ai-client-chat:1.0.1")
}
