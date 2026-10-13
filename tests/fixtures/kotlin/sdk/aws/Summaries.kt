package com.example.shop

import aws.sdk.kotlin.services.bedrockruntime.BedrockRuntimeClient
import aws.sdk.kotlin.services.bedrockruntime.model.ContentBlock
import aws.sdk.kotlin.services.bedrockruntime.model.ConversationRole
import aws.sdk.kotlin.services.bedrockruntime.model.ConverseRequest
import aws.sdk.kotlin.services.bedrockruntime.model.Message

class Summaries {
    suspend fun summarize(text: String) = BedrockRuntimeClient { region = "us-east-1" }.use { client ->
        val modelId = "anthropic.claude-3-haiku-20240307-v1:0"
        val request = ConverseRequest {
            this.modelId = modelId
            messages = listOf(Message { role = ConversationRole.User; content = listOf(ContentBlock.Text(text)) })
            inferenceConfig {
                maxTokens = 512
                temperature = 0.2F
            }
        }
        client.converse(request)
    }
}
