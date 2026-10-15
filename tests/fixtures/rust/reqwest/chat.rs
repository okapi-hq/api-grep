use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client as Http;
use serde::Serialize;
use serde_json::json;

const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
static GROQ_BASE: Lazy<String> = Lazy::new(|| std::env::var("GROQ_BASE_URL").unwrap_or_else(|_| "https://api.groq.com/openai/v1".into()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRequest {
    #[serde(rename = "contents")]
    parts: Vec<String>,
    max_output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip)]
    cache_key: String,
}

pub struct Assistant {
    http: Http,
    key: String,
}

impl Assistant {
    const VERSION: &'static str = "2023-06-01";

    pub fn new(key: String) -> Self {
        Self { http: Http::new(), key }
    }

    pub async fn claude(&self, prompt: &str) -> anyhow::Result<String> {
        let res = self
            .http
            .post(format!("{ANTHROPIC_BASE}/v1/messages"))
            .header("x-api-key", &self.key)
            .header("anthropic-version", Self::VERSION)
            .json(&json!({
                "model": "claude-sonnet-4-5",
                "max_tokens": 1024,
                "messages": [{ "role": "user", "content": prompt }]
            }))
            .send()
            .await?;
        Ok(res.text().await?)
    }

    pub async fn groq(&self, prompt: &str) -> anyhow::Result<()> {
        let url = format!("{}/chat/completions", *GROQ_BASE);
        let mut body = json!({ "model": "llama-3.3-70b-versatile", "messages": [{ "role": "user", "content": prompt }] });
        body["stream"] = json!(false);
        self.http.post(&url).bearer_auth(&self.key).json(&body).send().await?;
        Ok(())
    }

    pub async fn gemini(&self, text: String) -> anyhow::Result<()> {
        let request = GenerateRequest { parts: vec![text], max_output_tokens: 256, temperature: None, cache_key: String::new() };
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert("x-goog-api-key", HeaderValue::from_str(&self.key)?);
        self.http
            .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent")
            .headers(headers)
            .json(&request)
            .send()
            .await?;
        Ok(())
    }
}

pub async fn deepseek(prompt: &str) -> anyhow::Result<()> {
    let token = std::env::var("DEEPSEEK_API_KEY")?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build()?;
    client
        .request(reqwest::Method::POST, "https://api.deepseek.com/chat/completions")
        .header(AUTHORIZATION, format!("Bearer {}", token))
        .json(&json!({ "model": "deepseek-chat", "messages": [{ "role": "user", "content": prompt }] }))
        .send()
        .await?;
    Ok(())
}
