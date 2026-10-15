use openai_api_rs::v1::api::OpenAIClient;
use openai_api_rs::v1::chat_completion::{self, ChatCompletionRequest};
use openai_api_rs::v1::common::GPT4_O_MINI;

pub async fn classify(ticket: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = OpenAIClient::builder()
        .with_endpoint("https://api.together.xyz/v1")
        .with_api_key(std::env::var("TOGETHER_API_KEY")?)
        .build()?;
    let mut req = ChatCompletionRequest::new(
        GPT4_O_MINI.to_string(),
        vec![chat_completion::ChatCompletionMessage {
            role: chat_completion::MessageRole::user,
            content: chat_completion::Content::Text(ticket.to_string()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        }],
    );
    req.temperature = Some(0.0);
    client.chat_completion(req).await?;
    Ok(())
}
