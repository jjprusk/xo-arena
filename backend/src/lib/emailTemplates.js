/**
 * Email templates for the feedback system.
 */

/**
 * Thank-you email sent to users after submitting feedback.
 * @param {{ name: string, category: string, message: string }} params
 * @returns {string} HTML string
 */
export function thankYouTemplate({ name, category, message }) {
  const categoryLabel = category.charAt(0) + category.slice(1).toLowerCase()
  const truncated = message.length > 200 ? message.slice(0, 200) + '…' : message
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">Thanks for your feedback, ${name}!</h2>
  <p>We received your <strong>${categoryLabel}</strong> feedback:</p>
  <blockquote style="border-left: 3px solid #ccc; margin: 16px 0; padding: 8px 16px; color: #555;">
    ${truncated}
  </blockquote>
  <p>We review all feedback and will follow up if needed. Thank you for helping us improve XO Arena.</p>
  <p style="color: #888; font-size: 0.85em; margin-top: 32px;">— The XO Arena Team</p>
</body>
</html>
  `.trim()
}

/**
 * Reply notification email sent to the submitter when staff replies to their feedback.
 * @param {{ name: string, adminName: string, originalMessage: string, replyMessage: string }} params
 * @returns {string} HTML string
 */
export function replyTemplate({ name, adminName, originalMessage, replyMessage }) {
  const truncatedOriginal = originalMessage.length > 200 ? originalMessage.slice(0, 200) + '…' : originalMessage
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">A reply to your feedback, ${name}!</h2>
  <p><strong>${adminName}</strong> from the XO Arena team replied:</p>
  <blockquote style="border-left: 3px solid #2563eb; margin: 16px 0; padding: 8px 16px; color: #333;">
    ${replyMessage}
  </blockquote>
  <p style="color: #888; font-size: 0.85em;">Your original message:</p>
  <blockquote style="border-left: 3px solid #ccc; margin: 16px 0; padding: 8px 16px; color: #555;">
    ${truncatedOriginal}
  </blockquote>
  <p style="color: #888; font-size: 0.85em; margin-top: 32px;">— The XO Arena Team</p>
</body>
</html>
  `.trim()
}

/**
 * Staff alert email sent to admins/support when new feedback arrives.
 * @param {{ category: string, message: string, pageUrl: string, appId: string }} params
 * @returns {string} HTML string
 */
export function staffAlertTemplate({ category, message, pageUrl, appId }) {
  const categoryLabel = category.charAt(0) + category.slice(1).toLowerCase()
  const truncated = message.length > 300 ? message.slice(0, 300) + '…' : message
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a2e;">New Feedback — ${appId}</h2>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
    <tr>
      <td style="padding: 6px; font-weight: bold; width: 100px;">Category</td>
      <td style="padding: 6px;">${categoryLabel}</td>
    </tr>
    <tr style="background: #f9f9f9;">
      <td style="padding: 6px; font-weight: bold;">App</td>
      <td style="padding: 6px;">${appId}</td>
    </tr>
    <tr>
      <td style="padding: 6px; font-weight: bold;">Page</td>
      <td style="padding: 6px;"><a href="${pageUrl}">${pageUrl}</a></td>
    </tr>
  </table>
  <p><strong>Message:</strong></p>
  <blockquote style="border-left: 3px solid #ccc; margin: 8px 0; padding: 8px 16px; color: #555;">
    ${truncated}
  </blockquote>
</body>
</html>
  `.trim()
}
