use helpdesk_core::{llm, Groq};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let groq = Groq::new(std::env::var("GROQ_API_KEY")?);
    let answer = groq.ask("How do I reset my password?").await?;
    if !llm::moderate(&answer).await? {
        helpdesk_core::page_oncall("answer flagged").await?;
    }
    Ok(())
}
