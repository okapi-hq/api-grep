package com.example.assistant

import com.google.genai.Client
import software.amazon.awssdk.core.SdkBytes
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient
import software.amazon.awssdk.services.bedrockruntime.model.ConverseRequest
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest
import software.amazon.awssdk.services.bedrockruntime.model.Message

private const val GEMINI = "gemini-2.0-flash"

class Models(private val gemini: Client = Client()) {
    private val bedrock = BedrockRuntimeClient.builder().region(Region.US_EAST_1).build()

    fun draft(topic: String) = gemini.models.generateContent(GEMINI, "Write about $topic", null)

    fun draftLater(topic: String) = gemini.async.models.generateContent("gemini-2.5-pro", topic, null)

    fun converse(message: Message) =
        bedrock.converse(ConverseRequest.builder().modelId("anthropic.claude-3-5-haiku-20241022-v1:0").messages(message).build())

    fun converseQuick(message: Message) = bedrock.converse { it.modelId(System.getenv("BEDROCK_MODEL")).messages(message) }

    fun invoke(json: String) {
        val request = InvokeModelRequest.builder()
            .modelId("amazon.titan-text-express-v1")
            .body(SdkBytes.fromUtf8String(json))
            .build()
        bedrock.invokeModel(request)
    }
}
