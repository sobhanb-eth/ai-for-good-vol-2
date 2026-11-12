// "/" is rewritten to the static game (public/game.html) in next.config.ts.
// This page only renders if that rewrite is removed, so it links to the game.
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "15vh auto", padding: "0 16px" }}>
      <h1>FakeSpotter Arena</h1>
      <p>
        The game lives at <a href="/game.html">/game.html</a>.
      </p>
    </main>
  );
}
