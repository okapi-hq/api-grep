use async_openai::{
    config::OpenAIConfig,
    types::{ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs, CreateEmbeddingRequest, CreateImageRequestArgs},
    Client,
};

pub async fn answer(question: &str) -> anyhow::Result<()> {
    let client = Client::new();
    let request = CreateChatCompletionRequestArgs::default()
        .model("gpt-4o-mini")
        .max_tokens(512u32)
        .messages([
            ChatCompletionRequestSystemMessageArgs::default().content("You answer support tickets.").build()?.into(),
            ChatCompletionRequestUserMessageArgs::default().content(question).build()?.into(),
        ])
        .build()?;
    let response = client.chat().create(request).await?;
    println!("{:?}", response.choices.first());
    Ok(())
}

pub async fn embed(texts: Vec<String>) -> anyhow::Result<()> {
    let client = Client::new();
    let request = CreateEmbeddingRequest { model: "text-embedding-3-small".to_string(), input: texts.into(), ..Default::default() };
    client.embeddings().create(request).await?;
    Ok(())
}

pub async fn illustrate(prompt: &str) -> anyhow::Result<()> {
    let request = CreateImageRequestArgs::default().prompt(prompt).model("dall-e-3").n(1).build()?;
    Client::new().images().create(request).await?;
    Ok(())
}

/// An OpenAI-compatible provider: the base URL replaces `/v1`.
pub async fn route(question: &str) -> anyhow::Result<()> {
    let base = std::env::var("OPENROUTER_BASE_URL").unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string());
    let config = OpenAIConfig::new().with_api_base(base).with_api_key(std::env::var("OPENROUTER_API_KEY")?);
    let client = Client::with_config(config);
    let request = CreateChatCompletionRequestArgs::default()
        .model("anthropic/claude-sonnet-4.5")
        .messages([ChatCompletionRequestUserMessageArgs::default().content(question).build()?.into()])
        .build()?;
    client.chat().create(request).await?;
    Ok(())
}

pub struct Summarizer {
    client: Client<OpenAIConfig>,
}

impl Summarizer {
    pub fn new() -> Self {
        Self { client: Client::with_config(OpenAIConfig::new().with_api_base("https://api.deepseek.com/v1")) }
    }

    pub async fn summarize(&self, text: &str) -> anyhow::Result<()> {
        let request = CreateChatCompletionRequestArgs::default()
            .model("deepseek-chat")
            .messages([ChatCompletionRequestUserMessageArgs::default().content(text).build()?.into()])
            .build()?;
        self.client.chat().create(request).await?;
        Ok(())
    }
}
