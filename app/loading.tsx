export default function Loading() {
  return (
    <div className="rounded-md border border-matrix-border bg-matrix-panel/75 px-4 py-3 shadow-glow">
      <div className="h-1.5 overflow-hidden rounded-full bg-matrix-panel2">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-matrix-gold shadow-gold" />
      </div>
      <p className="mt-3 text-sm text-matrix-muted">Carregando modulo...</p>
    </div>
  );
}
