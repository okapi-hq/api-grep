use crate::config::{GROQ_BASE, MODEL};
use serde_json::{json, Value};

pub struct Groq {
    base_url: String,
    http: reqwest::Client,
    key: String,
}

impl Groq {
    pub fn new(key: impl Into<String>) -> Self {
        Self { base_url: GROQ_BASE.to_string(), http: reqwest::Client::new(), key: key.into() }
    }
}
