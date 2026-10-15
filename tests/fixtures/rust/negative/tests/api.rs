#[tokio::test]
async fn integration() {
    reqwest::Client::new().post("https://not-a-request.example/integration").send().await.unwrap();
}
