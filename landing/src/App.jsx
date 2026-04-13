// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import AdminRoute from './components/admin/AdminRoute.jsx'
import HomePage from './pages/HomePage.jsx'
import TournamentsPage from './pages/TournamentsPage.jsx'
import TournamentDetailPage from './pages/TournamentDetailPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import PlayPage from './pages/PlayPage.jsx'
import ReplayPage from './pages/ReplayPage.jsx'
import FAQPage from './pages/FAQPage.jsx'
import AboutPage from './pages/AboutPage.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminTournamentsPage from './pages/admin/AdminTournamentsPage.jsx'
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx'
import AdminUserProfilePage from './pages/admin/AdminUserProfilePage.jsx'
import AdminGamesPage from './pages/admin/AdminGamesPage.jsx'
import AdminMLPage from './pages/admin/AdminMLPage.jsx'
import AdminBotsPage from './pages/admin/AdminBotsPage.jsx'
import AdminFeedbackPage from './pages/admin/AdminFeedbackPage.jsx'
import AdminHealthPage from './pages/admin/AdminHealthPage.jsx'
import LogViewerPage from './pages/admin/LogViewerPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/replay/:id" element={<ReplayPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/about" element={<AboutPage />} />

          {/* Admin routes — all guarded by AdminRoute */}
          <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/tournaments" element={<AdminRoute><AdminTournamentsPage /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path="/admin/users/:id" element={<AdminRoute><AdminUserProfilePage /></AdminRoute>} />
          <Route path="/admin/games" element={<AdminRoute><AdminGamesPage /></AdminRoute>} />
          <Route path="/admin/ml-models" element={<AdminRoute><AdminMLPage /></AdminRoute>} />
          <Route path="/admin/bots" element={<AdminRoute><AdminBotsPage /></AdminRoute>} />
          <Route path="/admin/feedback" element={<AdminRoute><AdminFeedbackPage /></AdminRoute>} />
          <Route path="/admin/health" element={<AdminRoute><AdminHealthPage /></AdminRoute>} />
          <Route path="/admin/logs" element={<AdminRoute><LogViewerPage /></AdminRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
