interface CreateUser {
  name: string;
  age?: number;
  role: "admin" | "user";
  address: { city: string; zip: string | null };
  tags: string[];
}

export function createUser(input: CreateUser) {
  return fetch("https://api.example.com/users", { method: "POST", body: JSON.stringify(input) });
}

export function createAnything(input: any) {
  return fetch("https://api.example.com/anything", { method: "POST", body: JSON.stringify(input) });
}
