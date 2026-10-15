pub async fn seed() {
    reqwest::Client::new().post("https://not-a-request.example/cfg-test-module").send().await.unwrap();
}
