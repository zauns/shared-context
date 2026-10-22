import { Navigate, Route, Routes } from 'react-router';
import HomeRoute from './routes/HomeRoute.js';
import ProjectShell from './routes/ProjectShell.js';
import SetupRoute from './routes/SetupRoute.js';
import BoardRoute from './routes/BoardRoute.js';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/projects/:projectKey" element={<ProjectShell />}>
        <Route index element={<Navigate to="board" replace />} />
        <Route path="board" element={<BoardRoute />} />
        <Route path="issues/:issueKey" element={<BoardRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
