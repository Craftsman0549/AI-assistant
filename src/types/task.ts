export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'canceled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task {
  id: string
  title: string
  note?: string
  status: TaskStatus
  priority: TaskPriority
  due?: string // ISO8601
  createdAt: string // ISO8601
  updatedAt: string // ISO8601
}

export interface CreateTaskInput {
  title: string
  note?: string
  priority?: TaskPriority
  due?: string
}

export interface UpdateTaskInput {
  title?: string
  note?: string
  status?: TaskStatus
  priority?: TaskPriority
  due?: string | null
}

export interface TaskMeta {
  isActive: boolean
  totalSeconds: number
}

export type TaskWithMeta = Task & Partial<TaskMeta>
