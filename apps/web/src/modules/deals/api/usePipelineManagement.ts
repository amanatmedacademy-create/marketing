import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api-client';
import type { Pipeline, PipelineStage } from '../types';

type StageInput = Pick<PipelineStage, 'name' | 'color' | 'isWon' | 'isLost'>;

type CreatePipelineInput = {
  name: string;
  isDefault: boolean;
  stages: StageInput[];
};

export function useCreatePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineInput) =>
      apiFetch<Pipeline>('/pipelines', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useRenamePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, name }: { pipelineId: string; name: string }) =>
      apiFetch<Pipeline>(`/pipelines/${pipelineId}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useDeletePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId }: { pipelineId: string }) =>
      apiFetch<void>(`/pipelines/${pipelineId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}
