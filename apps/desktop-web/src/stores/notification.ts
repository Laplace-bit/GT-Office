import { useSyncExternalStore } from 'react'

export type NotificationType = 'info' | 'warning' | 'error' | 'success'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  duration?: number // ms, default 5000, 0 means persistent
}

class NotificationStore {
  private notifications: Notification[] = []
  private listeners: Set<() => void> = new Set()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.notifications

  addNotification = (notification: Omit<Notification, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    const newNotification = { ...notification, id }
    this.notifications = [...this.notifications, newNotification]
    this.notify()

    const duration = notification.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        this.removeNotification(id)
      }, duration)
    }
    return id
  }

  removeNotification = (id: string) => {
    this.notifications = this.notifications.filter((n) => n.id !== id)
    this.notify()
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }
}

export const notificationStore = new NotificationStore()

export function useNotifications() {
  return useSyncExternalStore(
    notificationStore.subscribe,
    notificationStore.getSnapshot
  )
}

export const addNotification = (n: Omit<Notification, 'id'>) => notificationStore.addNotification(n)
export const removeNotification = (id: string) => notificationStore.removeNotification(id)
