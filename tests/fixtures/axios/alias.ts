import http from "axios";

export const me = () => http.get("https://api.github.com/user");
