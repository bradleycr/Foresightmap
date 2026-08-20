/**
 * Event polls — one question, a handful of options, a QR into the room.
 */

export type PollStatus = "draft" | "live" | "closed";

export interface PollOption {
  id: string;
  label: string;
}

export interface PollResultOption extends PollOption {
  votes: number;
}

export interface PollPublic {
  id: string;
  slug: string;
  question: string;
  options: PollOption[];
  status: PollStatus;
  eventId: string;
  eventTitle: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  results: PollResultOption[];
  totalVotes: number;
  yourOptionId: string | null;
}

export interface PollAdmin extends PollPublic {
  createdByPersonId: string;
  createdByName: string;
}

export interface PollsAdminPayload {
  canManage: boolean;
  polls: PollAdmin[];
}
