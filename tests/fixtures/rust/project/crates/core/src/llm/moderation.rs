use async_openai::{types::CreateModerationRequestArgs, Client};

pub async fn moderate(text: &str) -> anyhow::Result<bool> {
    let request = CreateModerationRequestArgs::default().input(text).model("omni-moderation-latest").build()?;
    let response = Client::new().moderations().create(request).await?;
    Ok(response.results.iter().any(|r| r.flagged))
}
