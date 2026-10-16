pub struct Endpoint {
    pub name: &'static str,
    pub base_url: &'static str,
}

pub const ENDPOINTS: [Endpoint; 2] = [
    Endpoint { name: "together", base_url: "https://api.together.xyz/v1" },
    Endpoint { name: "fireworks", base_url: "https://api.fireworks.ai/inference/v1" },
];

pub async fn models(name: &str) -> reqwest::Result<reqwest::Response> {
    let endpoint = ENDPOINTS.iter().find(|e| e.name == name).unwrap();
    reqwest::get(format!("{}/models", endpoint.base_url)).await
}
