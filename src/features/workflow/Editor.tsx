import { useCallback, useMemo, useState } from 'react';
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

function stepToNode(step: WorkflowStep, allIds: string[]): Node {
  const data: StepNodeData = {
    id: step.id,
    name: step.name,
    stepType: step.type,
    agentId: step.agent_id,
  };
  return {
    id: step.id,
    type: 'step',
    position: { x: 250, y: allIds.indexOf(step.id) * 120 },
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
  workflowId: string;
  onBack: () => void;
}

export function WorkflowEditor({ workflowId, onBack }: Props) {
  const { t } = useTranslation();
  const [def, setDef] = useState<WorkflowDef | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialNodes = useMemo(() => {
    if (!def) return [];
    return def.steps.map((s, _i, arr) => stepToNode(s, arr.map((x) => x.id)));
  }, [def]);

  const initialEdges = useMemo(() => {
    if (!def) return [];
    return stepsToEdges(def.steps);
  }, [def]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const loadDef = useCallback(async () => {
    try {
      const d = await workflowGet(workflowId);
      setDef(d);
    } catch { /* ignore */ }
  }, [workflowId]);

  useState(() => { void loadDef(); });

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

  const selectedStep = def?.steps.find((s) => s.id === selectedStepId) ?? null;

  if (!def) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle">
        {t('workflow_page.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={def.name}
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
