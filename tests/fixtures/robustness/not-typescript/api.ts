export async function rateLimit() {
  return fetch("https://api.github.com/rate_limit");
}
