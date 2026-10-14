plugins {
    kotlin("jvm") version "2.0.21"
}

dependencies {
    implementation("com.aallam.openai:openai-client:4.0.1")
    implementation("dev.langchain4j:langchain4j-open-ai:1.0.1")
    implementation("dev.langchain4j:langchain4j-anthropic:1.0.1")
    implementation("dev.langchain4j:langchain4j-ollama:1.0.1")
}
