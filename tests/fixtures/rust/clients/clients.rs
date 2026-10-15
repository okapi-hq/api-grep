use std::sync::Arc;
use url::Url;
use std::sync::LazyLock;

static HOOK: LazyLock<String> = LazyLock::new(|| option_env!("HOOK_URL").unwrap_or("https://hooks.mailroom.example/notify").to_string());

pub struct Svc { http: Arc<reqwest::Client> }

impl Svc {
    pub async fn a(&self) {
        let base = Url::parse("https://api.mailchimp.com/3.0/").unwrap();
        let u = base.join("lists").unwrap();
        self.http.get(u).send().await.unwrap();
        let p = ["https://api.mailroom.example", "v2", "items"].join("/");
        self.http.delete(p).send().await.unwrap();
        let es = self.http.post("https://api.openai.com/v1/responses").json(&serde_json::json!({"model": "gpt-4o", "stream": true})).eventsource().unwrap();
        self.http.post(&*HOOK).send().await.unwrap();
    }
}

pub async fn actix() {
    let client = awc::Client::default();
    client.post("https://api.sendgrid.com/v3/mail/send").insert_header(("Authorization", "Bearer x")).send_json(&serde_json::json!({"subject": "hi"})).await.unwrap();
}

pub async fn surf_it() -> surf::Result<()> {
    let body: serde_json::Value = surf::post("https://api.resend.com/emails").header("Authorization", "Bearer k").body_json(&serde_json::json!({"to": "a@b.c"}))?.recv_json().await?;
    Ok(())
}

pub fn isahc_it() {
    let r = isahc::post("https://api.postmarkapp.com/email", r#"{"To":"a"}"#);
    let g = isahc::get_async("https://api.ipify.org");
}
