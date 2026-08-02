import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api-client';
import { useActionFeedback } from '../system/ActionFeedback';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  project_id?: string | null;
  assignee_id?: string | null;
  completed_at?: string | null;
};

export type CreateTaskInput = {
  title: string;
  description?: string;
  priority: TaskPriority;
  dueAt?: string;
  projectId?: string;
  assigneeId?: string;
};

export type TeamMember = {
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  department: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  priority?: TaskPriority;
  status?: string;
  due_at?: string | null;
  items: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done'; position: number }>;
};

export type CreateProjectInput = {
  name: string;
  description?: string;
  priority: TaskPriority;
  dueAt?: string;
};

export type AccountingResponse = {
  summary: { income: number; expense: number; profit: number; vat: number };
  transactions: Array<{
    id: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    occurred_at: string;
    accountName: string;
  }>;
};

export const useTasksQuery = () => useQuery({ queryKey: ['tasks'], queryFn: () => apiFetch<TaskItem[]>('/tasks') });
export const useTeamQuery = () => useQuery({ queryKey: ['team'], queryFn: () => apiFetch<TeamMember[]>('/team') });
export const useProjectsQuery = () => useQuery({ queryKey: ['projects'], queryFn: () => apiFetch<Project[]>('/projects') });
export const useAccountingQuery = () => useQuery({ queryKey: ['accounting'], queryFn: () => apiFetch<AccountingResponse>('/accounting') });

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();
  const feedback = useActionFeedback();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => apiFetch<TaskItem>('/tasks', {
      method: 'POST',
      body: {
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.dueAt || null,
        project_id: input.projectId || null,
        assignee_id: input.assigneeId || null,
      },
    }),
    onSuccess: (task) => {
      queryClient.setQueryData<TaskItem[]>(['tasks'], current => [task, ...(current ?? [])]);
      feedback.success('Задача создана');
    },
    onError: (reason) => feedback.error('Задача не создана', reason instanceof Error ? reason.message : 'Backend отклонил создание задачи.'),
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  const feedback = useActionFeedback();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => apiFetch<Project>('/projects', {
      method: 'POST',
      body: {
        name: input.name,
        description: input.description,
        priority: input.priority,
        due_at: input.dueAt || null,
      },
    }),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(['projects'], current => [project, ...(current ?? [])]);
      feedback.success('Проект создан');
    },
    onError: (reason) => feedback.error('Проект не создан', reason instanceof Error ? reason.message : 'Backend отклонил создание проекта.'),
  });
}

export function useToggleTaskMutation() {
  const queryClient = useQueryClient();
  const feedback = useActionFeedback();
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      apiFetch<TaskItem>(`/tasks/${id}`, { method: 'PATCH', body: { status: done ? 'done' : 'todo' } }),
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData<TaskItem[]>(['tasks']);
      queryClient.setQueryData<TaskItem[]>(['tasks'], current => current?.map(task => task.id === id ? { ...task, status: done ? 'done' : 'todo' } : task) ?? []);
      return { previous, done };
    },
    onError: (reason, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['tasks'], context.previous);
      feedback.error('Задача не обновлена', reason instanceof Error ? reason.message : 'Backend отклонил изменение статуса.');
    },
    onSuccess: (_task, _variables, context) => {
      feedback.success(context?.done ? 'Задача выполнена' : 'Задача возвращена в работу');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
