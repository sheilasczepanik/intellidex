export function EvidenceThumb({
  src,
  alt,
  className = "h-9 w-9",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={`shrink-0 rounded-[8px] border border-slate-200 object-cover ${className}`}
    />
  );
}

export default EvidenceThumb;
