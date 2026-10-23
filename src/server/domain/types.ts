export const STAGES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;
export type Stage = (typeof STAGES)[number];

export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ACTOR_KINDS = ['human', 'agent'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type StageCounts = Record<Stage, number>;
export type PriorityCounts = Record<Priority, number>;

export interface ActorRef {
  id: string;
  name: string;
  kind: ActorKind;
  can_read_images: boolean;
  color: string | null;
}

export interface Module {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  usage_count?: number;
}

export interface ChildProgress {
  done: number;
  active: number;
  cancelled: number;
  total: number;
}

export interface IssueRef {
  id: string;
  key: string;
  title: string;
}

export interface TrashBatch {
  batch: string;
  deleted_at: string;
  deleted_by: ActorRef | null;
  issues: IssueRef[];
}

export interface IssueCard {
  id: string;
  key: string;
  title: string;
  stage: Stage;
  priority: Priority;
  assignee: ActorRef | null;
  module: Module | null;
  blocked: boolean;
  blocked_reason: string | null;
  attachment_count: number;
  comment_count: number;
  child_progress: ChildProgress;
  position: number;
  rev: number;
  updated_at: string;
}

export interface Link {
  id: string;
  url: string;
  label: string | null;
  created_by: ActorRef;
  created_at: string;
}

export interface Attachment {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_by: ActorRef;
  created_at: string;
  has_text: boolean;
  is_image: boolean;
}

export interface Comment {
  id: string;
  body: string;
  author: ActorRef;
  rev: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface ActivityEvent {
  id: number;
  type: string;
  project_id: string;
  issue_id: string;
  issue_key: string;
  actor: ActorRef | null;
  actor_name: string;
  at: string;
  changes: ActivityChange[];
}

export interface IssueDetail extends IssueCard {
  project: { id: string; key: string; name: string };
  number: number;
  description: string;
  parent: IssueRef | null;
  children: IssueCard[];
  links: Link[];
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEvent[];
  created_by: ActorRef;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  blocked_at: string | null;
  blocked_by: ActorRef | null;
  latest_activity_id: number;
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  root_path: string | null;
  doc_allowlist: string[];
  modules: Module[];
  counts: {
    by_stage: StageCounts;
    by_priority: PriorityCounts;
    blocked: number;
    total: number;
  };
  updated_at: string;
}

export interface ProjectDoc {
  path: string;
  size: number;
}

export interface ContextSnapshot {
  project: ProjectSummary;
  counts: ProjectSummary['counts'];
  modules: Module[];
  blocked_issues: IssueCard[];
  my_issues: IssueCard[];
  recent_changes: ActivityEvent[];
  docs: ProjectDoc[];
}
