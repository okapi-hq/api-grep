/// A cache keyed by URL: `get` reads a map, nothing is sent.
pub struct UrlCache { entries: std::collections::HashMap<String, Vec<u8>> }

impl UrlCache {
    pub fn get(&self, url: &str) -> Option<&Vec<u8>> {
        self.entries.get(url)
    }
}
