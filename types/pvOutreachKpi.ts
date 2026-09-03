export type PvOutreachWorkerStatus = "ENVOI_ACTIF" | "EN_ATTENTE" | "BLOQUE" | "REPOS" | "INCONNU";

export type PvOutreachKpi = {
  date: string | null;
  zone: string | null;
  sentToday: number;
  sendingToday: number;
  queuedToday: number;
  failedToday: number;
  engagedToday: number;
  target: number;
  dailyCap: number;
  remainingToTarget: number;
  repliesToday: number;
  actionableRepliesToday: number;
  bouncesToday: number;
  unsubscribesToday: number;
  globalStopActive: boolean;
  qualifiedTotal: number;
  qualifiedWithEmail: number;
  workerStatus: PvOutreachWorkerStatus;
  lastSentAt: string | null;
  lastSendingActivityAt: string | null;
  oldestDueQueuedAt: string | null;
};
