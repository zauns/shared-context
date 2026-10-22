import { Navigate } from 'react-router';
import { useConfig, useProjects } from '../api/queries.js';
import { ErrorState, FullPageSpinner } from '../components/common/Feedback.js';
import { useLastProject } from '../state/local.js';

export default function HomeRoute() {
  const config = useConfig();
  const projects = useProjects();
  const [lastProject] = useLastProject();

  if (config.isLoading || projects.isLoading) {
    return <FullPageSpinner />;
  }
  if (config.isError || projects.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center app-bg">
        <ErrorState
          title="Cannot reach Shared Context"
          message={config.error?.message ?? projects.error?.message}
        />
      </div>
    );
  }

  if (config.data?.setup_required || (projects.data?.length ?? 0) === 0) {
    return <Navigate to="/setup" replace />;
  }

  const target =
    projects.data?.find((project) => project.key === lastProject) ?? projects.data?.[0];
  if (!target) return <Navigate to="/setup" replace />;
  return <Navigate to={`/projects/${target.key}/board`} replace />;
}
