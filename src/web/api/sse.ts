import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type SseStatus = 'connecting' | 'open' | 'error';

const EVENT_TYPES = [
  'issue.created',
  'issue.updated',
  'issue.moved',
  'issue.claimed',
  'issue.released',
  'issue.blocked',
  'issue.unblocked',
  'issue.deleted',
  'issue.restored',
  'attachment.added',
  'attachment.removed',
  'link.added',
  'link.removed',
  'comment.added',
  'comment.updated',
  'comment.deleted',
];

interface StatusState {
  key?: string;
  status: SseStatus;
}

export function useProjectEvents(projectKey: string | undefined): SseStatus {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StatusState>({ status: 'connecting' });

  useEffect(() => {
    if (!projectKey) return;
    const source = new EventSource(
      `/api/events?project=${encodeURIComponent(projectKey)}`,
    );

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['board', projectKey] });
      void queryClient.invalidateQueries({ queryKey: ['issue'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['trash', projectKey] });
    };

    source.onopen = () => setState({ key: projectKey, status: 'open' });
    source.onerror = () => setState({ key: projectKey, status: 'error' });
    for (const type of EVENT_TYPES) source.addEventListener(type, invalidate);
    source.addEventListener('resync', invalidate);

    return () => {
      for (const type of EVENT_TYPES) source.removeEventListener(type, invalidate);
      source.removeEventListener('resync', invalidate);
      source.close();
    };
  }, [projectKey, queryClient]);

  return projectKey && state.key === projectKey ? state.status : 'connecting';
}
