import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api-client';
import { useActionFeedback } from '../system/ActionFeedback';

export type TaskItem = {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_at: string | null;
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
  items: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done'; position: number }>;
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
