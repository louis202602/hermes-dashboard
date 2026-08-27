export type PvDailyKpi = {
  date: string | null;
  zone: string | null;
  qualifiedCallableCount: number;
  target: number;
  remaining: number;
  weeklyCount: number;
  weeklyTarget: number;
  readyProspectIds: string[];
};
