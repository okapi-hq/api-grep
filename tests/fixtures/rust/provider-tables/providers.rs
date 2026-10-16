use async_openai::{config::OpenAIConfig, types::CreateChatCompletionRequestArgs, Client};
use serde_json::json;

pub enum Upstream {
    Mistral,
    Groq,
    Cerebras,
}

impl Upstream {
    pub fn base_url(&self) -> &str {
        match self {
            Self::Mistral => "https://api.mistral.ai/v1",
            Self::Groq => "https://api.groq.com/openai/v1",
            Self::Cerebras => "https://api.cerebras.ai/v1",
        }
    }
}

pub async fn forward(provider: &Upstream, body: serde_json::Value) -> reqwest::Result<reqwest::Response> {
    let client = reqwest::Client::new();
    client.post(format!("{}/chat/completions", provider.base_url())).json(&body).send().await
}

pub async fn complete(provider: Upstream, prompt: &str) -> anyhow::Result<()> {
    let config = OpenAIConfig::new().with_api_base(provider.base_url());
    let client = Client::with_config(config);
    let request = CreateChatCompletionRequestArgs::default().model("any-model").messages(vec![]).build()?;
    client.chat().create(request).await?;
    let _ = json!({ "prompt": prompt });
    Ok(())
}
