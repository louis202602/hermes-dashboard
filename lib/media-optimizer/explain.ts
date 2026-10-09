import type { MediaOptimizerJob } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — « Pourquoi ce média est bloqué ? »
 *
 * Fonction PURE. Les raisons sont déduites UNIQUEMENT des champs réellement
 * renvoyés par la base ; aucune cause n'est supposée. Ordre stable :
 * droits → état → erreur → contrôles IG/FB → lien public → brouillon → avertissements.
 */

export type BlockerSeverity = "blocking" | "warning";

export interface BlockerReason {
  code:
    | "rights_pending"
    | "rights_rejected"
    | "status_blocked"
    | "status_failed"
    | "error"
    | "ig_not_ok"
    | "fb_not_ok"
    | "not_public_ready"
    | "draft_error"
    | "warning";
  severity: BlockerSeverity;
  message: string;
}

function clip(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

export function explainBlockers(job: MediaOptimizerJob): BlockerReason[] {
  const out: BlockerReason[] = [];

  if (job.rightsStatus === "pending_review") {
    out.push({
      code: "rights_pending",
      severity: "blocking",
      message: "Les droits d’utilisation ne sont pas encore validés : une personne doit indiquer l’origine ou l’accord du média.",
    });
  } else if (job.rightsStatus === "rejected") {
    out.push({
      code: "rights_rejected",
      severity: "blocking",
      message: `Les droits ont été refusés${job.rightsNote ? ` (${clip(job.rightsNote, 160)})` : ""} : ce média ne doit pas être publié.`,
    });
  }

  if (job.status === "blocked") {
    out.push({ code: "status_blocked", severity: "blocking", message: "Le traitement est à l’état « Bloqué »." });
  } else if (job.status === "failed") {
    out.push({
      code: "status_failed",
      severity: "blocking",
      message: `Le traitement a échoué${job.attempts > 0 ? ` après ${job.attempts} tentative${job.attempts > 1 ? "s" : ""}` : ""}.`,
    });
  }

  if (job.error) {
    out.push({ code: "error", severity: "blocking", message: `Erreur remontée par l’optimiseur : ${clip(job.error)}` });
  }

  if (job.igOk === false) {
    out.push({
      code: "ig_not_ok",
      severity: "blocking",
      message: "Le contrôle Instagram est négatif : le fichier ne respecte pas les contraintes du réseau.",
    });
  }
  if (job.fbOk === false) {
    out.push({
      code: "fb_not_ok",
      severity: "blocking",
      message: "Le contrôle Facebook est négatif : le fichier ne respecte pas les contraintes du réseau.",
    });
  }

  if (job.status === "ready_to_publish" && job.publicReady === false) {
    out.push({
      code: "not_public_ready",
      severity: "blocking",
      message: "Le média est marqué « Prêt » mais aucun lien public n’est disponible pour Buffer.",
    });
  }

  if (job.draftError) {
    out.push({ code: "draft_error", severity: "blocking", message: `Le brouillon Buffer a échoué : ${clip(job.draftError)}` });
  }

  for (const w of job.warnings) {
    out.push({ code: "warning", severity: "warning", message: `Avertissement : ${clip(w)}` });
  }

  return out;
}
