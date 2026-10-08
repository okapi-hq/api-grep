// A URL that is only rendered, never requested by the code itself.
const CDN = "https://images.example-cdn.com";

export function Avatar({ userId }: { userId: string }) {
  const src = `${CDN}/avatars/${userId}.png`;
  return <img src={src} alt="" width={32} height={32} />;
}

export const Logo = () => <img src="https://assets.example-cdn.com/logo.svg" alt="logo" />;
