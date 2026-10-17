const TELEGRAM = "https://api.telegram.org";

async function doFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return res.json();
}

function retrying(url: string) {
  return doFetch(url, { headers: { "x-retry": "1" } });
}

function signed(url: string) {
  return retrying(url);
}

function traced(url: string) {
  return signed(url);
}

function metered(url: string) {
  return traced(url);
}

function throttled(url: string) {
  return metered(url);
}

// seven wrappers from fetch: the call is not followed, so its host is named in the code and explained by no call
function relay(url: string) {
  return throttled(url);
}

export const notify = (token: string, chat: string) => relay(`${TELEGRAM}/bot${token}/sendMessage?chat_id=${chat}`);
