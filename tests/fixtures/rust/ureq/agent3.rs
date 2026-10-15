use ureq::Agent;

// ureq 3: headers with `header`, bodies with `send` / `send_json`, an agent's verbs
pub fn ping_healthcheck(uuid: &str) -> Result<(), ureq::Error> {
    let agent: Agent = Agent::config_builder().build().into();
    agent.post(&format!("https://hc-ping.com/{uuid}")).send("ok")?;
    Ok(())
}

pub fn pushover(token: &str, user: &str, message: &str) -> Result<(), ureq::Error> {
    ureq::post("https://api.pushover.net/1/messages.json")
        .header("Accept", "application/json")
        .send_json(serde_json::json!({ "token": token, "user": user, "message": message }))?;
    Ok(())
}

pub fn status() -> Result<String, ureq::Error> {
    let mut res = ureq::get("https://status.example-cdn.net/api/v1/status").call()?;
    Ok(res.body_mut().read_to_string()?)
}
