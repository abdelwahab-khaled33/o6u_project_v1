export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-[18px] w-[18px] animate-spin rounded-full border-2 border-[#c7cfdf] border-t-accent motion-reduce:animate-none"
    />
  );
}
