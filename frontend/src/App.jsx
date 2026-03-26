import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import AdminRoute from './components/admin/AdminRoute.jsx'
import PlayPage from './pages/PlayPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import LogViewerPage from './pages/LogViewerPage.jsx'
import AIDashboardPage from './pages/AIDashboardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import MLDashboardPage from './pages/MLDashboardPage.jsx'
import PuzzlePage from './pages/PuzzlePage.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx'
import AdminGamesPage from './pages/admin/AdminGamesPage.jsx'
import AdminMLPage from './pages/admin/AdminMLPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'

const isStaging = import.meta.env.VITE_ENV === 'staging'

export default function App() {
  useEffect(() => {
    if (isStaging) document.title = '[STAGING] XO Arena'
  }, [])

  return (
    <BrowserRouter>
      {isStaging && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#f59e0b', color: '#000', textAlign: 'center',
          fontSize: '12px', fontWeight: '600', padding: '4px',
          letterSpacing: '0.05em',
        }}>
          STAGING ENVIRONMENT — not production
        </div>
      )}
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/play" replace />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/puzzles" element={<PuzzlePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/ml" element={<MLDashboardPage />} />

          {/* Admin routes — all guarded by AdminRoute */}
          <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path="/admin/games" element={<AdminRoute><AdminGamesPage /></AdminRoute>} />
          <Route path="/admin/logs" element={<AdminRoute><LogViewerPage /></AdminRoute>} />
          <Route path="/admin/ai" element={<AdminRoute><AIDashboardPage /></AdminRoute>} />
          <Route path="/admin/ml-models" element={<AdminRoute><AdminMLPage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
