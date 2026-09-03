export type PvOutreachKpi = {
  date: string | null;
  zone: string | null;
  sentToday: number;
  sendingToday: number;
  queuedToday: number;
  failedToday: number;
  engagedToday: number;
  target: number;
  remainingToTarget: number;
  repliesToday: number;
  actionableRepliesToday: number;
  bouncesToday: number;
  unsubscribesToday: number;
  globalStopActive: boolean;
  qualifiedTotal: number;
  qualifiedWithEmail: number;
};
