import { requireAuthedUser } from "@/lib/dashboard/requestScope";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { E2E_SURVEY_ID, validateE2ESurveyAction } from "./actions";

const E2E_TAG = "PV-E2E-20260901-213021";

export default async function E2ESurveyValidationPage() {
  await requireAuthedUser();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_pv_site_survey", {
    p_survey_id: E2E_SURVEY_ID,
  });

  const result = data as
    | {
        ok?: boolean;
        code?: string;
        gate?: string;
        survey?: { id?: string; status?: string; observations?: string | null };
        prospect?: { company_name?: string | null };
        findings?: Array<{ is_blocking?: boolean; resolution?: string | null }>;
      }
    | null;

  if (error || !result?.ok || !result.survey) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900">
          <h1 className="text-xl font-semibold">Validation indisponible</h1>
          <p className="mt-2">Cette visite test n’est pas accessible avec votre session actuelle.</p>
        </div>
      </main>
    );
  }

  const status = result.survey.status ?? "INCONNU";
  const validated = status === "VALIDATED";
  const blockingFindings = (result.findings ?? []).filter(
    (finding) => finding.is_blocking && !finding.resolution,
  ).length;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          Test uniquement — aucune donnée client réelle
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          TEST E2E — Validation visite technique
        </h1>

        <dl className="mt-6 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Tag</dt>
            <dd className="font-mono text-slate-950">{E2E_TAG}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Fixture</dt>
            <dd className="text-slate-950">
              {result.prospect?.company_name ?? "Fixture photovoltaïque de test"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Survey ID</dt>
            <dd className="break-all font-mono text-slate-950">{E2E_SURVEY_ID}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">État</dt>
            <dd className="font-semibold text-slate-950">{status}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Gate</dt>
            <dd className="font-semibold text-slate-950">{result.gate ?? "INCONNU"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Blocages terrain non résolus</dt>
            <dd className="font-semibold text-slate-950">{blockingFindings}</dd>
          </div>
        </dl>

        {validated ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 p-4 font-semibold text-emerald-800">
            VALIDATED — la visite test est validée.
          </div>
        ) : (
          <form action={validateE2ESurveyAction} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-300"
            >
              VALIDER LA VISITE TEST
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              Ce clic utilise votre session Supabase authentifiée. Aucun service_role n’est utilisé.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
