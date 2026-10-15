use axum::{extract::State, routing::{get, post}, Json, Router};
use std::collections::HashMap;
use tokio::sync::mpsc;

#[derive(Clone)]
struct AppState {
    tx: mpsc::Sender<String>,
    cache: HashMap<String, String>,
}

async fn health() -> &'static str {
    "ok"
}

async fn ingest(State(state): State<AppState>, Json(body): Json<serde_json::Value>) -> Json<serde_json::Value> {
    state.tx.send(body.to_string()).await.unwrap();
    let cached = state.cache.get("https://not-a-request.example/key");
    Json(serde_json::json!({ "queued": true, "cached": cached }))
}

pub fn router(state: AppState) -> Router {
    Router::new().route("/health", get(health)).route("/v1/ingest", post(ingest)).with_state(state)
}

/// Reads a response another part of the program received: nothing is sent here.
pub async fn read(resp: reqwest::Response) -> reqwest::Result<serde_json::Value> {
    let status = resp.status();
    let body = resp.json::<serde_json::Value>().await?;
    println!("{status} {}", body);
    Ok(body)
}

pub fn queue(sender: std::sync::mpsc::Sender<&'static str>) {
    sender.send("https://not-a-request.example/queued").unwrap();
}

pub fn redis_get(conn: &mut redis::Connection) -> redis::RedisResult<String> {
    redis::cmd("GET").arg("https://not-a-request.example/redis").query(conn)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn calls_out() {
        reqwest::get("https://not-a-request.example/unit-test").await.unwrap();
    }
}
