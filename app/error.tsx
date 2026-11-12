"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <main style={{ padding: 24 }}><h2>Something went wrong</h2><p>Your data is safe. Try again, or reload the page.</p><button onClick={reset}>Try again</button></main>;
}
