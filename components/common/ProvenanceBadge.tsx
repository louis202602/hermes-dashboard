import type { DataProvenance } from "@/types/hermes";

const LABELS: Record<DataProvenance, string> = {
  REAL: "Données réelles",
  MOCK: "Démonstration",
  DERIVED: "Dérivé",
  UNAVAILABLE: "Indisponible",
};

/**
 * Small badge that labels the provenance of a section's data, so nothing
 * illustrative is ever mistaken for real backend data.
 */
export default function ProvenanceBadge({
  provenance,
}: {
  provenance: DataProvenance;
}) {
  return (
    <span
      className={`provenance-badge is-${provenance.toLowerCase()}`}
      title={`Source : ${LABELS[provenance]}`}
    >
      {LABELS[provenance]}
    </span>
  );
}
