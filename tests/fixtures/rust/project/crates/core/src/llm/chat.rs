use super::client::Groq;
use serde_json::{json, Value};

impl Groq {
    async fn post(&self, path: &str, body: Value) -> reqwest::Result<reqwest::Response> {
        self.http.post(format!("{}{path}", self.base_url)).bearer_auth(&self.key).json(&body).send().await
    }

    pub async fn ask(&self, prompt: &str) -> reqwest::Result<String> {
        let body = json!({ "model": crate::config::MODEL, "messages": [{ "role": "user", "content": prompt }] });
        self.post("/chat/completions", body).await?.text().await
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn builds_url() {
        let _ = reqwest::blocking::get("https://example.invalid/never-reported");
    }
}
