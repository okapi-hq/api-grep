use reqwest::blocking::Client;
use std::collections::HashMap;

const TELEGRAM_API: &str = concat!("https://api.telegram.org", "/bot");

pub fn telegram(chat_id: i64, text: &str) -> reqwest::Result<()> {
    let token = std::env::var("TELEGRAM_TOKEN").expect("TELEGRAM_TOKEN");
    let url = format!("{}{}/sendMessage", TELEGRAM_API, token);
    Client::new().post(&url).form(&[("chat_id", chat_id.to_string()), ("text", text.to_string())]).send()?;
    Ok(())
}

pub fn slack(text: &str) -> reqwest::Result<()> {
    let mut payload = HashMap::new();
    payload.insert("text", text);
    payload.insert("channel", "#ops");
    let webhook = std::env::var("SLACK_WEBHOOK_URL").unwrap_or_else(|_| String::from("https://hooks.slack.com/services/T000/B000/XXXX"));
    Client::new().post(webhook).json(&payload).send()?;
    Ok(())
}

pub fn twilio(sid: &str, to: &str, body: &str) -> reqwest::Result<()> {
    let mut url = String::from("https://api.twilio.com/2010-04-01/Accounts/");
    url.push_str(sid);
    url.push_str("/Messages.json");
    let auth = std::env::var("TWILIO_AUTH_TOKEN").unwrap();
    Client::new()
        .post(url)
        .basic_auth(sid, Some(auth))
        .form(&[("To", to), ("From", "+15550100"), ("Body", body)])
        .send()?;
    Ok(())
}

pub fn status() -> reqwest::Result<String> {
    reqwest::blocking::get("https://www.githubstatus.com/api/v2/status.json")?.text()
}
