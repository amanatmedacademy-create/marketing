import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { PipelineStage } from '../types';

type StageInput = Pick<PipelineStage, 'name' | 'color' | 'isWon' | 'isLost'>;

type CreatePipelineInput = {
  companyId: string;
  name: string;
  isDefault: boolean;
  stages: StageInput[];
};

export function useCreatePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId, name, isDefault, stages }: CreatePipelineInput) => {
      if (!name.trim()) throw new Error('Введите название воронки');
      if (stages.length < 2) throw new Error('Добавьте минимум два этапа');

      if (isDefault) {
        const { error } = await supabase.from('crm_pipelines').update({ is_default: false }).eq('company_id', companyId);
        if (error) throw error;
      }

      const { data: pipeline, error: pipelineError } = await supabase
        .from('crm_pipelines')
        .insert({ company_id: companyId, name: name.trim(), is_default: isDefault, position: Date.now() })
        .select('id')
        .single();
      if (pipelineError) throw pipelineError;

      const stageRows = stages.map((stage, index) => ({
        company_id: companyId,
        pipeline_id: pipeline.id,
        name: stage.name.trim(),
        color: stage.color,
        position: index,
        probability: stage.isWon ? 100 : stage.isLost ? 0 : Math.min(90, 10 + index * 20),
        stage_type: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
      }));
      const { error: stagesError } = await supabase.from('crm_pipeline_stages').insert(stageRows);
      if (stagesError) {
        await supabase.from('crm_pipelines').delete().eq('id', pipeline.id).eq('company_id', companyId);
        throw stagesError;
      }
      return pipeline.id as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useRenamePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId, pipelineId, name }: { companyId: string; pipelineId: string; name: string }) => {
      const { error } = await supabase.from('crm_pipelines').update({ name: name.trim() }).eq('id', pipelineId).eq('company_id', companyId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}

export function useDeletePipelineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ companyId, pipelineId }: { companyId: string; pipelineId: string }) => {
      const { count, error: countError } = await supabase.from('crm_deals').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('pipeline_id', pipelineId).is('deleted_at', null);
      if (countError) throw countError;
      if ((count ?? 0) > 0) throw new Error('Нельзя удалить воронку, пока в ней есть лиды');
      const { error } = await supabase.from('crm_pipelines').delete().eq('id', pipelineId).eq('company_id', companyId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
  });
}
