use reqwest::{header, Client};

pub struct GitHub {
    client: Client,
    api: String,
}

impl GitHub {
    pub fn new(token: &str) -> anyhow::Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(header::AUTHORIZATION, header::HeaderValue::from_str(&format!("Bearer {token}"))?);
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("application/vnd.github+json"));
        let client = Client::builder().default_headers(headers).user_agent("relay-desk/0.1").build()?;
        Ok(GitHub { client, api: "https://api.github.com".to_string() })
    }

    async fn get(&self, path: &str) -> anyhow::Result<reqwest::Response> {
        Ok(self.client.get(format!("{}{}", self.api, path)).send().await?)
    }

    pub async fn issues(&self, owner: &str, repo: &str, page: u32) -> anyhow::Result<()> {
        self.client
            .get(format!("{}/repos/{owner}/{repo}/issues", self.api))
            .query(&[("state", "open"), ("per_page", "100")])
            .query(&[("page", page)])
            .send()
            .await?;
        Ok(())
    }

    pub async fn me(&self) -> anyhow::Result<()> {
        self.get("/user").await?;
        Ok(())
    }

    pub async fn search(&self, q: &str, sort: Option<&str>) -> anyhow::Result<()> {
        let request = self.client.get(format!("{}/search/issues", self.api)).query(&[("q", q)]);
        let request = match sort {
            Some(s) => request.query(&[("sort", s)]).header("x-sorted", "1"),
            None => request,
        };
        request.send().await?;
        Ok(())
    }
}
