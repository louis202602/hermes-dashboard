export type PvLeadTemperature = "FROID" | "TIEDE" | "CHAUD" | "TRES_PRIORITAIRE";

export type PvLeadInboxItem = {
  prospectId: string;
  companyName: string | null;
  city: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  qualificationScore: number | null;
  leadTemperature: PvLeadTemperature;
  priorityReason: string | null;
  replyStatus: string | null;
  replySummary: string | null;
  lastContactAt: string | null;
  needsCallback: boolean;
  nextAction: string | null;
  nextActionAt: string | null;
  alertPriority: string | null;
  alertChannelsRequired: string[];
  lastNotifiedAt: string | null;
  projectId: string | null;
  projectStatus: string | null;
  puissanceKwc: number | null;
};

export type PvLeadInbox = {
  items: PvLeadInboxItem[];
  total: number;
};
