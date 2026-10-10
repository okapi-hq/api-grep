export const booksCommon = {
  getApiUrl(env: "production" | "sandbox") {
    return env === "production" ? "https://api.example-books.com/v3" : "https://sandbox.example-books.com/v3";
  },
  tokenUrl: (realm: string) => `https://oauth.example-books.com/realms/${realm}/token`,
};
