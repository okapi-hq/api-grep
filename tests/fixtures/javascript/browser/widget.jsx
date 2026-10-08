import { useEffect, useState } from "react";

export function Stars({ repo }) {
  const [stars, setStars] = useState(0);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`).then((r) => r.json()).then((d) => setStars(d.stargazers_count));
  }, [repo]);
  return <span>{stars}</span>;
}
