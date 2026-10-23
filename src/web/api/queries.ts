import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';
import type {
  ActorRef,
  ApiConfig,
  BackupListResult,
  BoardResult,
  IssueDetail,
  IssueListResult,
  Module,
  ProjectSummary,
  TrashBatch,
} from './types.js';
import type { FilterState } from '../lib/filters.js';

export const queryKeys = {
  config: ['config'] as const,
  projects: ['projects'] as const,
  board: (projectKey: string, filters: FilterState) =>
    ['board', projectKey, filters] as const,
  issue: (issueKey: string) => ['issue', issueKey] as const,
  modules: (projectKey: string) => ['modules', projectKey] as const,
  issueOptions: (projectKey: string) => ['issue-options', projectKey] as const,
  actors: ['actors'] as const,
  trash: (projectKey: string) => ['trash', projectKey] as const,
  backups: ['backups'] as const,
};

export function useConfig() {
  return useQuery<ApiConfig>({
    queryKey: queryKeys.config,
    queryFn: () => api.config(),
    staleTime: 30_000,
  });
}

export function useProjects() {
  return useQuery<ProjectSummary[]>({
    queryKey: queryKeys.projects,
    queryFn: () => api.projects().then((result) => result.items),
    staleTime: 10_000,
  });
}

export function useBoard(projectKey: string | undefined, filters: FilterState) {
  return useQuery<BoardResult>({
    queryKey: projectKey
      ? queryKeys.board(projectKey, filters)
      : (['board', 'missing', filters] as const),
    queryFn: () => api.board(projectKey!, filters),
    enabled: Boolean(projectKey),
    staleTime: 5_000,
  });
}

export function useIssue(issueKey: string | undefined) {
  return useQuery<IssueDetail>({
    queryKey: issueKey ? queryKeys.issue(issueKey) : (['issue', 'missing'] as const),
    queryFn: () => api.issue(issueKey!).then((result) => result.issue),
    enabled: Boolean(issueKey),
    staleTime: 5_000,
  });
}

export function useModules(projectKey: string | undefined) {
  return useQuery<Module[]>({
    queryKey: projectKey
      ? queryKeys.modules(projectKey)
      : (['modules', 'missing'] as const),
    queryFn: () => api.modules(projectKey!).then((result) => result.items),
    enabled: Boolean(projectKey),
    staleTime: 30_000,
  });
}

export function useActors() {
  return useQuery<ActorRef[]>({
    queryKey: queryKeys.actors,
    queryFn: () => api.actors().then((result) => result.items),
    staleTime: 60_000,
  });
}

export function useIssueOptions(projectKey: string | undefined) {
  return useQuery<IssueListResult>({
    queryKey: projectKey
      ? queryKeys.issueOptions(projectKey)
      : (['issue-options', 'missing'] as const),
    queryFn: () => api.listIssues(projectKey!, 200),
    enabled: Boolean(projectKey),
    staleTime: 15_000,
  });
}

export function useTrash(projectKey: string | undefined) {
  return useQuery<TrashBatch[]>({
    queryKey: projectKey
      ? queryKeys.trash(projectKey)
      : (['trash', 'missing'] as const),
    queryFn: () => api.trash(projectKey!).then((result) => result.items),
    enabled: Boolean(projectKey),
    staleTime: 5_000,
  });
}

export function useBackups(enabled = true) {
  return useQuery<BackupListResult>({
    queryKey: queryKeys.backups,
    queryFn: () => api.backups(),
    enabled,
    staleTime: 5_000,
  });
}
