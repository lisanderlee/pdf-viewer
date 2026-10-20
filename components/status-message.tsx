export function StatusMessage({ message }: { message: string }) {
  return (
    <main className="status">
      <p>{message}</p>
    </main>
  );
}
