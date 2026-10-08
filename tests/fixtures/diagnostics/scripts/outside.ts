// Outside the tsconfig `include`: still scanned (every source file under the directory is).
export const seed = () => fetch("https://api.example.com/v1/seed", { method: "POST" });
