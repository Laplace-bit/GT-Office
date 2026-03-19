import { memo } from 'react'
import { useNotifications, removeNotification, type Notification } from '../../stores/notification'
import { AppIcon } from '../../shell/ui/icons'
import './NotificationList.scss'

const NotificationCard = memo(({ notification }: { notification: Notification }) => {
  const { id, type, message } = notification

  const getIconName = () => {
    switch (type) {
      case 'success': return 'check'
      case 'error': return 'x-mark'
      case 'warning': return 'bolt'
      case 'info':
      default: return 'info'
    }
  }

  return (
    <div className={`notification-card notification-${type}`}>
      <div className="notification-icon">
        <AppIcon name={getIconName() as any} />
      </div>
      <div className="notification-content">
        {message}
      </div>
      <button 
        className="notification-close" 
        onClick={() => removeNotification(id)}
        aria-label="Close"
      >
        <AppIcon name="close" />
      </button>
    </div>
  )
})

export const NotificationList = memo(() => {
  const notifications = useNotifications()

  if (notifications.length === 0) return null

  return (
    <div className="notification-list">
      {notifications.map((n) => (
        <NotificationCard key={n.id} notification={n} />
      ))}
    </div>
  )
})
