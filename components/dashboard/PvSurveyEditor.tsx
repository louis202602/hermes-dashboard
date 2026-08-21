"use client";

import { useActionState } from "react";

import {
  applyPvSurveyMeasurementAction,
  generatePvSurveyReportAction,
  PV_INITIAL_STATE,
  resolvePvSurveyFindingAction,
  setPvSurveyStatusAction,
  upsertPvSurveyContextAction,
  upsertPvSurveyElectricalAction,
  upsertPvSurveyRoofAction,
  validatePvSiteSurveyAction,
} from "@/app/actions/pv";
import {
  pvSurveyComparison,
  pvSurveyStatusTone,
  pvSurveyTone,
  pvSurveyValue,
  PV_SURVEY_FINDING_LABELS,
  PV_SURVEY_RESOLUTION_LABELS,
  PV_SURVEY_SEVERITY_LABELS,
  PV_SURVEY_STATUS_LABELS,
} from "@/lib/pv/surveyLabels";
import {
  PV_SURVEY_ACCESS_DIFFICULTIES,
  PV_SURVEY_ACCESS_MEANS,
  PV_SURVEY_BOARD_CONDITIONS,
  PV_SURVEY_EARTHING_STATES,
  PV_SURVEY_RESOLUTIONS,
  PV_SURVEY_ROOF_ACCESS,
  PV_SURVEY_ROOF_CONDITIONS,
  PV_SURVEY_ROOF_TYPES,
  PV_SURVEY_SHADING_LEVELS,
  PV_SURVEY_SITE_CONDITIONS,
  PV_SURVEY_WEATHER,
  type PvSiteSurvey,
  type PvSiteSurveyDetail,
  type PvSurveyComparisonRow,
  type PvSurveyFinding,
} from "@/types/pv";

/** Message d'action rendu tel quel — un refus reste un refus. */
function Feedback({ state }: { state: { phase: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

/** Liste déroulante d'un vocabulaire clos. « — » = pas de changement. */
function VocabField({
  name,
  label,
  values,
  current,
}: {
  name: string;
  label: string;
  values: readonly string[];
  current: string | null;
}) {
  return (
    <label className="agent-field">
      <span>{label}</span>
      <select name={name} defaultValue={current ?? ""}>
        <option value="">— non mesuré —</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {pvSurveyValue(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumField({
  name,
  label,
  current,
  step = "0.01",
  min = "0",
  max,
  unit,
}: {
  name: string;
  label: string;
  current: number | null;
  step?: string;
  min?: string;
  max?: string;
  unit?: string;
}) {
  return (
    <label className="agent-field">
      <span>
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input
        type="number"
        name={name}
        step={step}
        min={min}
        max={max}
        defaultValue={current === null ? "" : String(current)}
      />
    </label>
  );
}

function TextField({
  name,
  label,
  current,
}: {
  name: string;
  label: string;
  current: string | null;
}) {
  return (
    <label className="agent-field">
      <span>{label}</span>
      <input type="text" name={name} defaultValue={current ?? ""} />
    </label>
  );
}

/** Rappel commun aux trois formulaires de relevé. Dit une limite réelle. */
function KeepNotice() {
  return (
    <p className="photo-note">
      Un champ laissé vide <strong>ne remplace pas</strong> une valeur déjà relevée :
      l’enregistrement complète le relevé, il ne l’efface pas.
    </p>
  );
}

function RoofForm({ survey }: { survey: PvSiteSurvey }) {
  const [state, formAction, pending] = useActionState(upsertPvSurveyRoofAction, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="agent-action-form pv-survey-form">
      <input type="hidden" name="survey_id" value={survey.id} />
      <NumField name="roof_area_total_m2" label="Surface totale de toiture" unit="m²"
        current={survey.roofAreaTotalMeasuredM2} />
      <NumField name="roof_area_usable_m2" label="Surface exploitable" unit="m²"
        current={survey.roofAreaUsableMeasuredM2} />
      <NumField name="azimuth_deg" label="Orientation (azimut)" unit="°" max="360"
        current={survey.azimuthMeasuredDeg} />
      <NumField name="tilt_deg" label="Inclinaison" unit="°" max="90"
        current={survey.tiltMeasuredDeg} />
      <VocabField name="roof_type" label="Type de couverture"
        values={PV_SURVEY_ROOF_TYPES} current={survey.roofTypeMeasured} />
      <VocabField name="roof_condition" label="État de la couverture"
        values={PV_SURVEY_ROOF_CONDITIONS} current={survey.roofConditionMeasured} />
      <VocabField name="shading" label="Ombrage constaté"
        values={PV_SURVEY_SHADING_LEVELS} current={survey.shadingMeasured} />
      <VocabField name="access_difficulty" label="Difficulté d’accès"
        values={PV_SURVEY_ACCESS_DIFFICULTIES} current={survey.accessDifficultyMeasured} />
      <NumField name="height_m" label="Hauteur au faîtage" unit="m" current={survey.heightMeasuredM} />
      <NumField name="ridge_length_m" label="Longueur de faîtage" unit="m" current={survey.ridgeLengthM} />
      <NumField name="eave_length_m" label="Longueur d’égout" unit="m" current={survey.eaveLengthM} />
      <NumField name="slope_length_m" label="Longueur de rampant" unit="m" current={survey.slopeLengthM} />
      <TextField name="obstacles" label="Obstacles (cheminées, chiens-assis, antennes…)"
        current={survey.obstacles} />

      {/* CONSTAT, pas diagnostic — le libellé le dit à l'endroit où l'on coche. */}
      <input type="hidden" name="asbestos_declared" value="1" />
      <label className="agent-field pv-checkbox">
        <input type="checkbox" name="asbestos_suspicion" defaultChecked={survey.asbestosSuspicion} />
        <span>
          Suspicion d’amiante constatée sur site. Hermès <strong>ne produit aucun
          diagnostic</strong> : seul un opérateur certifié peut la confirmer ou la lever.
        </span>
      </label>
      <TextField name="asbestos_note" label="Ce qui motive la suspicion (obligatoire si cochée)"
        current={survey.asbestosNote} />

      <KeepNotice />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le relevé de toiture"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ElectricalForm({ survey }: { survey: PvSiteSurvey }) {
  const [state, formAction, pending] = useActionState(
    upsertPvSurveyElectricalAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-survey-form">
      <input type="hidden" name="survey_id" value={survey.id} />
      <TextField name="panel_location" label="Implantation des panneaux" current={survey.panelLocation} />
      <TextField name="inverter_location" label="Emplacement de l’onduleur" current={survey.inverterLocation} />
      <TextField name="battery_location" label="Emplacement batterie (si prévue)" current={survey.batteryLocation} />
      <TextField name="cable_route" label="Cheminement de câble" current={survey.cableRoute} />
      <NumField name="cable_distance_m" label="Distance de câble" unit="m" current={survey.cableDistanceM} />
      <TextField name="panel_board_location" label="Emplacement du tableau électrique"
        current={survey.panelBoardLocation} />
      <VocabField name="panel_board_condition" label="État du tableau"
        values={PV_SURVEY_BOARD_CONDITIONS} current={survey.panelBoardCondition} />
      <NumField name="panel_board_free_slots" label="Modules libres au tableau" step="1"
        current={survey.panelBoardFreeSlots} />
      <NumField name="main_breaker_rating_a" label="Calibre du disjoncteur de branchement" unit="A"
        current={survey.mainBreakerRatingA} />
      <VocabField name="earthing_observed" label="Prise de terre (observation visuelle)"
        values={PV_SURVEY_EARTHING_STATES} current={survey.earthingObserved} />
      <TextField name="earthing_note" label="Précision sur la prise de terre" current={survey.earthingNote} />
      <p className="photo-note">
        Ces éléments sont des <strong>observations</strong> de visite, pas un contrôle
        réglementaire : ils ne remplacent ni un Consuel ni une vérification par un
        organisme agréé.
      </p>
      <KeepNotice />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le relevé électrique"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ContextForm({ survey }: { survey: PvSiteSurvey }) {
  const [state, formAction, pending] = useActionState(upsertPvSurveyContextAction, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="agent-action-form pv-survey-form">
      <input type="hidden" name="survey_id" value={survey.id} />
      <VocabField name="weather_conditions" label="Météo pendant la visite"
        values={PV_SURVEY_WEATHER} current={survey.weatherConditions} />
      <VocabField name="roof_access" label="Accès au toit"
        values={PV_SURVEY_ROOF_ACCESS} current={survey.roofAccess} />
      <VocabField name="access_means" label="Moyen d’accès utilisé"
        values={PV_SURVEY_ACCESS_MEANS} current={survey.accessMeans} />
      <VocabField name="site_condition" label="État général du site"
        values={PV_SURVEY_SITE_CONDITIONS} current={survey.siteCondition} />
      <TextField name="safety_constraints" label="Contraintes de sécurité" current={survey.safetyConstraints} />
      <TextField name="observations" label="Observations" current={survey.observations} />
      <TextField name="remarks" label="Remarques libres" current={survey.remarks} />
      <KeepNotice />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer les conditions de visite"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * APPLIQUER une mesure au site.
 *
 * Le seul chemin par lequel une valeur de terrain remplace une valeur déclarée.
 * Il est explicite, confirmé, et audité en base : rien n'écrase `pv_sites`
 * silencieusement, surtout pas l'enregistrement d'un relevé.
 */
function ApplyMeasurementForm({ surveyId, row }: { surveyId: string; row: PvSurveyComparisonRow }) {
  const [state, formAction, pending] = useActionState(
    applyPvSurveyMeasurementAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="pv-survey-apply">
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="field" value={row.field} />
      <label className="pv-checkbox">
        <input type="checkbox" name="confirm" value="APPLIQUER" required />
        <span>Remplacer la donnée déclarée par la mesure</span>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Appliquer au site"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ResolveFindingForm({
  surveyId,
  finding,
}: {
  surveyId: string;
  finding: PvSurveyFinding;
}) {
  const [state, formAction, pending] = useActionState(
    resolvePvSurveyFindingAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-survey-resolve">
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="finding_id" value={finding.id} />
      <label className="agent-field">
        <span>Décision</span>
        <select name="resolution" defaultValue="">
          <option value="" disabled>
            — choisir —
          </option>
          {PV_SURVEY_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {PV_SURVEY_RESOLUTION_LABELS[r] ?? r}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Justification</span>
        <input type="text" name="comment" maxLength={500} />
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Résoudre cet écart"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function StatusForm({ surveyId, nextStatuses }: { surveyId: string; nextStatuses: string[] }) {
  const [state, formAction, pending] = useActionState(setPvSurveyStatusAction, PV_INITIAL_STATE);
  if (nextStatuses.length === 0) {
    return (
      <p className="photo-note">
        Aucune suite n’est ouverte depuis cet état. C’est la table de transitions de la
        base qui le dit, pas cet écran.
      </p>
    );
  }
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="survey_id" value={surveyId} />
      <label className="agent-field">
        <span>Faire passer la visite à</span>
        <select name="status" defaultValue={nextStatuses[0]}>
          {nextStatuses.map((s) => (
            <option key={s} value={s}>
              {PV_SURVEY_STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Application…" : "Changer l’état"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * VALIDER. Geste humain, jamais automatisable : la base refuse quand l'appelant
 * n'est pas un utilisateur authentifié agissant en son propre nom — un agent ne
 * peut donc pas valider une visite, même en passant par la même façade.
 */
function ValidateForm({
  surveyId,
  blockingUnresolved,
  canValidate,
}: {
  surveyId: string;
  blockingUnresolved: number;
  canValidate: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    validatePvSiteSurveyAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-danger-zone">
      <input type="hidden" name="survey_id" value={surveyId} />
      <p className="pv-warning" role="note">
        Valider une visite, c’est <strong>attester</strong> que le relevé correspond au
        site. C’est cette attestation qui autorisera l’émission d’un devis contractuel.
      </p>
      {blockingUnresolved > 0 ? (
        <p className="photo-note">
          {blockingUnresolved} écart(s) bloquant(s) ne sont pas résolus. La base refusera
          la validation tant qu’ils le resteront — c’est le but : une visite ne peut pas
          attester le contraire de ce qu’elle a constaté.
        </p>
      ) : null}
      {!canValidate ? (
        <p className="photo-note">
          Cette visite n’est pas dans un état d’où la validation est possible. Terminez-la
          d’abord.
        </p>
      ) : null}
      <label className="agent-field pv-checkbox">
        <input type="checkbox" name="confirm" value="VALIDER" required />
        <span>Je confirme avoir réalisé cette visite et relevé ces mesures sur site.</span>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Validation…" : "Valider la visite"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ReportForm({
  surveyId,
  company,
  requestId,
}: {
  surveyId: string;
  company: string;
  requestId: string;
}) {
  const [state, formAction, pending] = useActionState(
    generatePvSurveyReportAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="survey_id" value={surveyId} />
      <input type="hidden" name="company" value={company} />
      <input type="hidden" name="request_id" value={requestId} />
      <p className="photo-note">
        Le rapport de visite est un <strong>document interne</strong> : ce n’est pas un
        devis, il ne porte aucun prix et ne recueille aucune signature.
      </p>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Génération…" : "Générer le rapport de visite (PDF)"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function siteLabel(detail: PvSiteSurveyDetail): string {
  const s = detail.site;
  if (s === null) return "—";
  const parts = [s.addressLine1, s.postalCode, s.city].filter(
    (x): x is string => x !== null && x.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : (s.label ?? "—");
}

/**
 * ÉCRAN DE VISITE TECHNIQUE.
 *
 * Trois propriétés portent l'écran :
 *   1. La colonne « Statut » est TEXTUELLE. La couleur ne fait que redire ce que
 *      le mot dit déjà, et « Non mesuré » n'est jamais confondu avec « Conforme ».
 *   2. Aucune gravité n'est décidée ici : elle vient des écarts calculés en base
 *      par des règles déterministes et des seuils configurables.
 *   3. Appliquer une mesure au site est un geste séparé, confirmé et audité.
 */
export default function PvSurveyEditor({
  detail,
  company,
}: {
  detail: PvSiteSurveyDetail;
  company: string;
}) {
  const s = detail.survey;
  const locked = s.status === "VALIDATED" || s.status === "CANCELLED";
  const rows = pvSurveyComparison(s, detail.site, detail.findings);
  const blockingUnresolved = detail.findings.filter(
    (f) => f.isBlocking && f.resolution === null,
  ).length;
  const canValidate = s.status === "DONE" || s.status === "NEEDS_REVIEW";

  return (
    <>
      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">VISITE TECHNIQUE</span>
            <h2>Constat de terrain</h2>
          </div>
          <span className={`pv-badge is-${pvSurveyStatusTone(s.status)}`}>
            {PV_SURVEY_STATUS_LABELS[s.status] ?? s.status}
          </span>
        </header>

        <dl className="pv-facts">
          <div>
            <dt>Site</dt>
            <dd>{siteLabel(detail)}</dd>
          </div>
          <div>
            <dt>Prévue le</dt>
            <dd>{s.scheduledOn ?? "—"}</dd>
          </div>
          <div>
            <dt>Terminée le</dt>
            <dd>{s.completedAt === null ? "—" : s.completedAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt>Validée le</dt>
            <dd>{s.validatedAt === null ? "—" : s.validatedAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt>Écarts bloquants non résolus</dt>
            <dd>{blockingUnresolved}</dd>
          </div>
        </dl>

        {locked ? (
          <p className="photo-note">
            Cette visite est {s.status === "VALIDATED" ? "validée" : "annulée"} : son relevé
            est <strong>figé</strong>. Pour constater autre chose, planifiez une nouvelle
            visite — celle-ci reste intacte et auditable.
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">DÉCLARÉ / MESURÉ</span>
            <h2>Ce que le terrain confirme ou infirme</h2>
          </div>
        </header>

        <table className="pv-survey-table">
          <thead>
            <tr>
              <th scope="col">Élément</th>
              <th scope="col">Déclaré</th>
              <th scope="col">Mesuré</th>
              <th scope="col">Écart</th>
              <th scope="col">Statut</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field}>
                <th scope="row">{r.label}</th>
                <td>
                  {r.declared === null
                    ? "Non renseigné"
                    : `${pvSurveyValue(r.declared)}${r.unit ? ` ${r.unit}` : ""}`}
                </td>
                <td>
                  {r.measured === null
                    ? "Non mesuré"
                    : `${pvSurveyValue(r.measured)}${r.unit ? ` ${r.unit}` : ""}`}
                </td>
                <td>{r.delta === null ? "—" : `${r.delta}${r.unit ? ` ${r.unit}` : ""}`}</td>
                {/* Libellé TEXTUEL. La classe de ton ne porte aucune information seule. */}
                <td className={`pv-survey-status is-${pvSurveyTone(r.status)}`}>
                  {PV_SURVEY_SEVERITY_LABELS[r.status] ?? r.status}
                </td>
                <td>
                  {r.applicable && !locked ? (
                    <ApplyMeasurementForm surveyId={s.id} row={r} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="photo-note">
          Appliquer une mesure met à jour la fiche du site. La valeur déclarée d’origine
          n’est pas perdue : elle reste dans cette visite et dans le journal d’audit.
          Hermès <strong>ne modifie jamais l’étude</strong> de son propre chef — si la
          mesure change le dimensionnement, c’est à vous de réviser l’étude.
        </p>
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">ÉCARTS CONSTATÉS</span>
            <h2>
              {detail.findings.length === 0
                ? "Aucun écart"
                : `${detail.findings.length} écart(s)`}
            </h2>
          </div>
        </header>

        {detail.findings.length === 0 ? (
          <p className="photo-note">
            Aucun écart retenu par les règles de comparaison. Cela ne veut pas dire que
            tout a été mesuré : les éléments non relevés figurent « Non mesuré » dans le
            tableau ci-dessus.
          </p>
        ) : (
          <ul className="pv-survey-findings">
            {detail.findings.map((f) => (
              <li key={f.id} className={`pv-survey-finding is-${pvSurveyTone(f.severity)}`}>
                <p className="pv-survey-finding-head">
                  <strong>{PV_SURVEY_FINDING_LABELS[f.code] ?? f.code}</strong>{" "}
                  <span className="pv-badge">
                    {PV_SURVEY_SEVERITY_LABELS[f.severity] ?? f.severity}
                  </span>
                </p>
                <p className="photo-note">
                  Déclaré : {pvSurveyValue(f.declaredValue) ?? "non renseigné"}
                  {f.unit ? ` ${f.unit}` : ""} — Mesuré :{" "}
                  {pvSurveyValue(f.measuredValue) ?? "non mesuré"}
                  {f.unit ? ` ${f.unit}` : ""}
                </p>
                {f.comment !== null ? <p className="photo-note">{f.comment}</p> : null}
                {f.resolution !== null ? (
                  <p className="photo-session-meta">
                    Résolu : {PV_SURVEY_RESOLUTION_LABELS[f.resolution] ?? f.resolution}
                    {f.resolvedAt === null ? "" : ` le ${f.resolvedAt.slice(0, 10)}`}
                  </p>
                ) : locked ? null : (
                  <ResolveFindingForm surveyId={s.id} finding={f} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {locked ? null : (
        <section className="dashboard-card pv-card">
          <header className="panel-head">
            <div>
              <span className="panel-eyebrow">RELEVÉ</span>
              <h2>Saisir les mesures</h2>
            </div>
          </header>
          <h3 className="panel-eyebrow">Toiture</h3>
          <RoofForm survey={s} />
          <h3 className="panel-eyebrow">Implantation et électricité</h3>
          <ElectricalForm survey={s} />
          <h3 className="panel-eyebrow">Conditions de visite</h3>
          <ContextForm survey={s} />
        </section>
      )}

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">PIÈCES JOINTES</span>
            <h2>Photos et documents</h2>
          </div>
        </header>
        {detail.documents.length === 0 ? (
          <p className="photo-note">
            Aucune pièce rattachée. Les photos se déposent depuis la fiche du site et se
            rattachent à la visite ; elles restent dans le bucket privé existant.
          </p>
        ) : (
          <ul className="pv-document-list">
            {detail.documents.map((d) => (
              <li key={d.id}>
                {d.signedUrl === null ? (
                  <span>{d.originalFilename ?? d.docType}</span>
                ) : (
                  <a href={d.signedUrl} target="_blank" rel="noreferrer">
                    {d.originalFilename ?? d.docType}
                  </a>
                )}
                <span className="photo-note">
                  {d.docType} — {Math.round(d.sizeBytes / 1024)} Ko
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">SUITES</span>
            <h2>Actions</h2>
          </div>
        </header>

        {/* Clé d'idempotence STABLE : deux clics ne produisent pas deux fichiers,
            mais un changement d'état produit bien un nouveau constat archivé. */}
        <ReportForm surveyId={s.id} company={company} requestId={`survey-${s.id}-${s.status}`} />

        {locked ? null : <StatusForm surveyId={s.id} nextStatuses={detail.nextStatuses} />}

        {locked ? null : (
          <ValidateForm
            surveyId={s.id}
            blockingUnresolved={blockingUnresolved}
            canValidate={canValidate}
          />
        )}
      </section>
    </>
  );
}
