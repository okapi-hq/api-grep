use super::config::pagerduty;

pub async fn page_oncall(summary: &str) -> reqwest::Result<()> {
    let routing_key = std::env::var("PAGERDUTY_ROUTING_KEY").unwrap_or_default();
    reqwest::Client::new()
        .post(pagerduty::EVENTS_URL)
        .json(&serde_json::json!({
            "routing_key": routing_key,
            "event_action": "trigger",
            "payload": { "summary": summary, "severity": "error", "source": "helpdesk" }
        }))
        .send()
        .await?;
    Ok(())
}
