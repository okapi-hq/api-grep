enum Endpoints {
  Users = "https://api.example.com/users",
}

export const users = () => fetch(Endpoints.Users);
