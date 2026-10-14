plugins {
    kotlin("jvm") version "2.0.21"
    id("org.springframework.boot") version "3.4.4"
}

val springAiVersion: String by project

dependencies {
    implementation(platform("org.springframework.ai:spring-ai-bom:$springAiVersion"))
    implementation("org.springframework.ai:spring-ai-starter-model-openai")
    implementation("org.springframework.ai:spring-ai-starter-model-ollama")
}
