/**
 * Loading skeleton placeholder. Presentational only — used to represent the
 * LOADING state of a data surface without inventing any content.
 */
export default function Skeleton({
  width,
  height = 14,
  radius,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`ds-skeleton${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width: width ?? "100%",
        height,
        borderRadius: radius,
      }}
    />
  );
}
