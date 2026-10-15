use serde_json::json;

const DEFAULT_MISTRAL_URL: &str = "https://api.mistral.ai/v1/embeddings";

pub struct Embedder {
    url: String,
    key: String,
    model: String,
}

impl Embedder {
    pub fn new(url: Option<String>, key: String) -> Self {
        Embedder { url: url.unwrap_or(DEFAULT_MISTRAL_URL.to_owned()), key, model: "mistral-embed".into() }
    }

    pub fn embed(&self, input: &str) -> Result<serde_json::Value, ureq::Error> {
        let body = json!({ "input": [input], "model": self.model });
        let value = ureq::post(&self.url)
            .set("Content-Type", "application/json")
            .set("Authorization", format!("Bearer {}", self.key).as_str())
            .send_bytes(serde_json::to_vec(&body).unwrap().as_ref())?
            .into_json()?;
        Ok(value)
    }
}

pub fn voyage(texts: Vec<String>) -> Result<(), ureq::Error> {
    let key = std::env::var("VOYAGE_API_KEY").unwrap();
    ureq::post("https://api.voyageai.com/v1/embeddings")
        .set("Authorization", &format!("Bearer {key}"))
        .send_json(json!({ "input": texts, "model": "voyage-3" }))?;
    Ok(())
}

pub fn weather(lat: f64, lon: f64) -> Result<String, ureq::Error> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(5)).build();
    Ok(agent
        .get("https://api.open-meteo.com/v1/forecast")
        .query("latitude", &lat.to_string())
        .query("longitude", &lon.to_string())
        .call()?
        .into_string()?)
}

pub fn subscribe(email: &str) -> Result<(), ureq::Error> {
    ureq::post("https://api.buttondown.email/v1/subscribers")
        .set("Authorization", &format!("Token {}", std::env::var("BUTTONDOWN_KEY").unwrap()))
        .send_form(&[("email_address", email), ("tags", "newsletter")])?;
    Ok(())
}
