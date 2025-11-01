import React from 'react'
import TaskPanel from '@/components/taskPanel'

const TasksPage = () => {
  return (
    <div className="min-h-screen p-6">
      <h1 className="text-xl font-semibold mb-4">タスク管理</h1>
      <TaskPanel />
    </div>
  )
}

export default TasksPage
