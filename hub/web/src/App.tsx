import { createHashRouter, Navigate, RouterProvider, useParams, type RouteObject } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/auth/LoginPage';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { WorkspacePage } from '@/features/workspace/WorkspacePage';
import { DecisionPage } from '@/features/decision/DecisionPage';
import { DocumentPage } from '@/features/documents/DocumentPage';
import { HistoryPage } from '@/features/history/HistoryPage';

/** A fresh form for every decision (keyed by its id). */
function DecisionRoute() {
  const { wsId, runId, decId } = useParams();
  return <DecisionPage key={`${wsId}/${runId}/${decId}`} />;
}

/**
 * Hash routing works both when the backend serves the UI and on a static host (Vercel).
 * Signed-in routes. `/login` here only bounces a signed-in user back to where they wanted to go.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'w/:wsId', element: <WorkspacePage /> },
      { path: 'w/:wsId/d/:runId/:decId', element: <DecisionRoute /> },
      { path: 'w/:wsId/docs/:docId', element: <DocumentPage /> },
      { path: 'w/:wsId/history', element: <HistoryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

/** Signed-out routes: everything goes to the login page and remembers where it was headed. */
function ToLogin() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  return <Navigate to={hash.startsWith('/login') || hash === '/' ? '/login' : `/login?next=${encodeURIComponent(hash)}`} replace />;
}
export const publicRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '*', element: <ToLogin /> },
];

export function App() {
  return <RouterProvider router={createHashRouter(routes)} />;
}

export function PublicApp() {
  return <RouterProvider router={createHashRouter(publicRoutes)} />;
}
