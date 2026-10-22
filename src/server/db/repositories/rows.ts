export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  root_path: string | null;
  doc_allowlist_json: string;
  next_issue_number: number;
  created_at: string;
  updated_at: string;
}

export interface ModuleRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
}

export interface ActorRow {
  id: string;
  name: string;
  name_key: string;
  kind: 'human' | 'agent';
  can_read_images: number;
  color: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface IssueRow {
  id: string;
  project_id: string;
  number: number;
  key: string;
  title: string;
  description: string;
  stage: string;
  priority: string;
  assignee_id: string | null;
  module_id: string | null;
  parent_id: string | null;
  blocked: number;
  blocked_reason: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  position: number;
  rev: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_batch: string | null;
  client_request_id: string | null;
}

export interface LinkRow {
  id: string;
  issue_id: string;
  url: string;
  label: string | null;
  created_by: string;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  issue_id: string;
  original_name: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  text_path: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface CommentRow {
  id: string;
  issue_id: string;
  body: string;
  author_id: string;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface ActivityRow {
  id: number;
  project_id: string;
  issue_id: string;
  actor_id: string | null;
  actor_name: string;
  type: string;
  changes_json: string;
  created_at: string;
}
