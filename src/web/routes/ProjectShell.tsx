import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { useProjects } from '../api/queries.js';
import { ErrorState, FullPageSpinner } from '../components/common/Feedback.js';
import ProjectModal from '../components/ProjectModal.js';
import Sidebar from '../components/Sidebar.js';
import { useDensity, useLastProject, useTheme } from '../state/local.js';

export default function ProjectShell() {
  const { projectKey = '' } = useParams();
  const projects = useProjects();
  const navigate = useNavigate();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const [, setLastProject] = useLastProject();

  const project = projects.data?.find((entry) => entry.key === projectKey);

  useEffect(() => {
    if (project) setLastProject(project.key);
  }, [project, setLastProject]);

  if (projects.isLoading) return <FullPageSpinner />;
  if (projects.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center app-bg">
        <ErrorState
          title="Cannot load Projects"
          message={projects.error.message}
          onRetry={() => void projects.refetch()}
        />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center app-bg">
        <ErrorState
          title="Project not found"
          message={`No Project with key ${projectKey}.`}
          onRetry={() => navigate('/')}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen app-bg">
      <Sidebar
        projects={projects.data ?? []}
        activeKey={project.key}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        density={density}
        onToggleDensity={() =>
          setDensity(density === 'compact' ? 'comfortable' : 'compact')
        }
        onNewProject={() => setNewProjectOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <ProjectModal
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreated={(created) => {
          setLastProject(created.key);
          navigate(`/projects/${created.key}/board`);
        }}
      />
    </div>
  );
}
