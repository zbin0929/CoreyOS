import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';
import { Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PageHeader } from '@/app/shell/PageHeader';
import { StepNode, type StepNodeData } from './nodes/StepNode';
import { PropertyPanel } from './PropertyPanel';
import {
  workflowGet,
  workflowSave,
  type WorkflowDef,
  type WorkflowStep,
} from '@/lib/ipc';

const nodeTypes: NodeTypes = { step: StepNode };

function stepToNode(step: WorkflowStep, index: number): Node {
  const data: StepNodeData = {
    id: step.id,
    name: step.name,
    stepType: step.type,
    agentId: step.agent_id,
  };
  return {
    id: step.id,
    type: 'step',
    position: { x: 250, y: index * 120 },
    data,
  };
}

function stepsToEdges(steps: WorkflowStep[]): Edge[] {
  const edges: Edge[] = [];
  for (const step of steps) {
    for (const afterId of step.after) {
      edges.push({
        id: `${afterId}-${step.id}`,
        source: afterId,
        target: step.id,
        animated: true,
      });
    }
  }
  return edges;
}

interface Props {
  workflowId: string | null;
  onBack: () => void;
}

export function WorkflowEditor({ workflowId, onBack }: Props) {
  const { t } = useTranslation();
  const [def, setDef] = useState<WorkflowDef | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (workflowId) {
      void workflowGet(workflowId).then((d) => {
        setDef(d);
        setLoaded(true);
      }).catch(() => setLoaded(true));
    } else {
      setDef({
        id: `wf_${Date.now()}`,
        name: '',
        description: '',
        version: 1,
        trigger: { type: 'manual' } as any,
        inputs: [],
        steps: [],
      });
      setLoaded(true);
    }
  }, [workflowId]);

  const initialNodes = useMemo(() => {
    if (!def) return [];
    return def.steps.map((s, i) => stepToNode(s, i));
  }, [def]);

  const initialEdges = useMemo(() => {
    if (!def) return [];
    return stepsToEdges(def.steps);
  }, [def]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    if (connection.target && connection.source) {
      setDef((prev) => {
        if (!prev) return prev;
        const steps = prev.steps.map((s) => {
          if (s.id === connection.target) {
            const after = [...new Set([...s.after, connection.source!])];
            return { ...s, after };
          }
          return s;
        });
        return { ...prev, steps };
      });
    }
  }, [setEdges]);

  const handleSave = async () => {
    if (!def) return;
    setSaving(true);
    try {
      await workflowSave(def);
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = () => {
    const id = `step_${Date.now()}`;
    const newStep: WorkflowStep = {
      id,
      name: id,
      type: 'agent',
      after: [],
      agent_id: 'hermes-default',
      prompt: '',
    };
    setDef((prev) => prev ? { ...prev, steps: [...prev.steps, newStep] } : prev);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'step',
        position: { x: 250 + Math.random() * 100, y: (nds.length) * 120 },
        data: { id, name: id, stepType: 'agent', agentId: 'hermes-default' } as StepNodeData,
      },
    ]);
  };

  const handleUpdateStep = (updated: WorkflowStep) => {
    setDef((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((s) => s.id === updated.id ? updated : s);
      return { ...prev, steps };
    });
    setNodes((nds) =>
      nds.map((n) =>
        n.id === updated.id
          ? {
              ...n,
              data: {
                id: updated.id,
                name: updated.name,
                stepType: updated.type,
                agentId: updated.agent_id,
              } as StepNodeData,
            }
          : n,
      ),
    );
  };

  const handleDeleteStep = (id: string) => {
    setDef((prev) => {
      if (!prev) return prev;
      const steps = prev.steps
        .filter((s) => s.id !== id)
        .map((s) => ({ ...s, after: s.after.filter((a) => a !== id) }));
      return { ...prev, steps };
    });
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedStepId(null);
  };

  const handleDefFieldChange = (field: 'name' | 'description' | 'trigger_type', value: string) => {
    setDef((prev) => {
      if (!prev) return prev;
      if (field === 'trigger_type') {
        const trigger = value === 'cron'
          ? { type: 'cron' as const, expression: '0 * * * *' }
          : { type: 'manual' as const };
        return { ...prev, trigger };
      }
      return { ...prev, [field]: value };
    });
  };

  const selectedStep = def?.steps.find((s) => s.id === selectedStepId) ?? null;

  if (!loaded || !def) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle">
        {t('workflow_page.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={def.name || t('workflow_page.new_workflow')}
        subtitle={t('workflow_page.editor_subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack}>
              {t('workflow_page.back')}
            </Button>
            <Button variant="ghost" onClick={handleAddStep}>
              <Icon icon={Plus} size="xs" />
              {t('workflow_page.add_step')}
            </Button>
            <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
              <Icon icon={Save} size="xs" />
              {saving ? t('workflow_page.saving') : t('workflow_page.save')}
            </Button>
          </div>
        }
      />
      <div className="flex flex-1 min-h-0">
        <div className="w-64 shrink-0 border-r border-border bg-bg-elev-1 p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-fg">{t('workflow_page.basic_info')}</h3>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.wf_name')}</span>
            <input
              className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
              value={def.name}
              onChange={(e) => handleDefFieldChange('name', e.target.value)}
              placeholder={t('workflow_page.wf_name_placeholder')}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('workflow_page.wf_desc')}</span>
            <input
              className="flex h-8 w-full rounded-md border border-border bg-bg-elev-1 px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-gold-500"
              value={def.description}
              onChange={(e) => handleDefFieldChange('description', e.target.value)}
              placeholder={t('workflow_page.wf_desc_placeholder')}
            />
          </label>
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs font-medium text-fg-subtle">{t('workflow_page.help_title')}</p>
            <ul className="space-y-1 text-[11px] text-fg-subtle">
              <li>🤖 <b>Agent</b> — AI 执行任务</li>
              <li>🔧 <b>Tool</b> — 调用工具</li>
              <li>🌐 <b>Browser</b> — 浏览器自动化</li>
              <li>⚡ <b>Parallel</b> — 并行执行</li>
              <li>🔀 <b>Branch</b> — 条件分支</li>
              <li>🔄 <b>Loop</b> — 循环执行</li>
              <li>✋ <b>Approval</b> — 人工审批</li>
            </ul>
            <p className="mt-2 text-[11px] text-fg-subtle">
              {t('workflow_page.help_tip')}
            </p>
          </div>
        </div>
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedStepId(node.id)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <div className="w-72 shrink-0 border-l border-border bg-bg-elev-1">
          <PropertyPanel
            step={selectedStep}
            onUpdate={handleUpdateStep}
            onDelete={handleDeleteStep}
          />
        </div>
      </div>
    </div>
  );
}
