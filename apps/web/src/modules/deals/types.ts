export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  affectsRevenue: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  order: number;
  stages: PipelineStage[];
}

export interface Contact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export interface Manager {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Deal {
  id: string;
  pipelineId: string;
  stageId: string;
  title: string;
  oneTimeAmount: string | null;
  recurringAmount: string | null;
  order: number;
  contact: Contact | null;
  manager: Manager | null;
  tags: { tag: { id: string; name: string; color: string } }[];
}

export interface ListDealsResponse {
  items: Deal[];
  total: number;
  page: number;
  pageSize: number;
}
