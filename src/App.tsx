import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { OwnerDashboardPage } from './pages/OwnerDashboardPage';
import { ServerPage } from './pages/ServerPage';
import { PublicStorefrontPage } from './pages/PublicStorefrontPage';
import { UserRole } from './types';

function getHomePathForRole(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return '/super-admin';
    case 'owner':
      return '/dashboard';
    case 'server':
      return '/server';
  }
}

const RoleGuard: React.FC<{ allowedRoles: UserRole[]; children: React.ReactNode }> = ({
  allowedRoles,
  children,
}) => {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading workspace...</p>
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to={getHomePathForRole(profile.role)} replace />;
  }

  return <>{children}</>;
};

const RootRedirect: React.FC = () => {
  const { profile, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading HostGrid...</p>
      </div>
    );
  }
  if (!profile) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={getHomePathForRole(profile.role)} replace />;
};

export default function App() {
  const routerBasename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter basename={routerBasename}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/super-admin"
                element={
                  <RoleGuard allowedRoles={['super_admin']}>
                    <SuperAdminPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RoleGuard allowedRoles={['owner', 'super_admin']}>
                    <OwnerDashboardPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/dashboard/:tab"
                element={
                  <RoleGuard allowedRoles={['owner', 'super_admin']}>
                    <OwnerDashboardPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/server"
                element={
                  <RoleGuard allowedRoles={['owner', 'server', 'super_admin']}>
                    <ServerPage />
                  </RoleGuard>
                }
              />
              <Route path="/s/:slug" element={<PublicStorefrontPage />} />
              <Route path="/" element={<RootRedirect />} />
              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
