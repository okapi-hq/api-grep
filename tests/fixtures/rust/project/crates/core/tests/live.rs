#[tokio::test]
async fn live() {
    reqwest::get("https://example.invalid/integration-test").await.unwrap();
}
