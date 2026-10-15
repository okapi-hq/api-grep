mod mail {
    pub const API: &str = "https://api.postmarkapp.com";
}

fn main() {
    let client = reqwest::blocking::Client::new();
    let _ = client
        .post(format!("{}/email", mail::API))
        .header("X-Postmark-Server-Token", std::env::var("POSTMARK_TOKEN").unwrap())
        .json(&serde_json::json!({ "From": "digest@example.org", "To": "team@example.org", "Subject": "Daily digest" }))
        .send();
}
