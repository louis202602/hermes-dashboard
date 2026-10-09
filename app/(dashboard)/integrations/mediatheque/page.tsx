import {
  activateStopAction,
  loadMediaPreviewsAction,
  requestOptimizationAction,
  setRightsAction,
} from "@/app/actions/media-optimizer";
import { MediaOptimizerView } from "@/components/media-optimizer/MediaOptimizerView";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getMediaOptimizerState } from "@/services/hermes/mediaOptimizer";

export const metadata = { title: "Médiathèque — Optimiseur de médias" };
export const dynamic = "force-dynamic";

export default async function MediathequePage() {
  await requireRoute("/integrations/mediatheque");
  const result = await getMediaOptimizerState();

  return (
    <MediaOptimizerView
      state={result.ok && result.data ? result.data : null}
      actions={{
        requestOptimization: requestOptimizationAction,
        setRights: setRightsAction,
        activateStop: activateStopAction,
        loadPreviews: loadMediaPreviewsAction,
      }}
    />
  );
}
