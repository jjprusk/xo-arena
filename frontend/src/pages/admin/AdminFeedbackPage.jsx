import React from 'react'
import { AdminHeader } from './AdminDashboard.jsx'
import FeedbackInbox from '../../components/feedback/FeedbackInbox.jsx'

export default function AdminFeedbackPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <AdminHeader title="Feedback" subtitle="User-submitted feedback and bug reports" />
      <FeedbackInbox apiBase="/api/v1/admin/feedback" />
    </div>
  )
}
