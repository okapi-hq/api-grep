use sentry::{Hub, Level};

fn process(batch: &[u8]) -> Result<usize, std::io::Error> {
    if batch.is_empty() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "empty batch"));
    }
    Ok(batch.len())
}

fn main() {
    let _guard = sentry::init(("https://key@o1.ingest.sentry.io/42", sentry::ClientOptions::default()));
    match process(&[]) {
        Ok(n) => sentry::capture_message(&format!("processed {n}"), Level::Info),
        Err(e) => sentry::capture_error(&e),
    };
    Hub::current().capture_message("worker stopped", Level::Warning);
}
