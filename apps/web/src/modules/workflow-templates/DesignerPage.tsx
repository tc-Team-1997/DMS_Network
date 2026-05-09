/**
 * DesignerPage — full BPMN template designer.
 *
 * Route: /workflows/templates/:id/design
 * Tabs: Canvas | DMN | SLA & Calendar | Simulation | Versions
 *
 * RBAC: Doc Admin only (checked server-side; client shows AccessDenied for other roles).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Save,
  Send,
  Plus,
  GitBranch,
  Cpu,
  Calendar,
  Play,
  History,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Panel, Skeleton, useToast } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { AccessDenied } from '@/components/AccessDenied';

import {
  fetchTemplate,
  fetchTemplateVersions,
  createTemplateVersion,
  updateTemplateVersion,
  publishTemplateVersion,
  fetchCalendars,
  createCalendar,
  updateCalendar,
} from './api';
import { BpmnCanvas } from './components/BpmnCanvas';
import { NodePalette } from './components/NodePalette';
import { DmnEditor } from './components/DmnEditor';
import { SimulationPanel } from './components/SimulationPanel';
import { VersionDiff } from './components/VersionDiff';
import { CalendarEditor } from './components/CalendarEditor';
import { SlaEditor } from './components/SlaEditor';
import { BOB_DEFAULT_HOLIDAYS, BOB_DEFAULT_HOURS } from './components/CalendarEditor';

import type {
  CanvasData,
  CanvasNode,
  CanvasNodeType,
  DmnMap,
  DmnTable,
  SlaMap,
  TemplateVersion,
  BusinessCalendar,
} from './schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'canvas' | 'dmn' | 'sla' | 'simulation' | 'versions';

const TABS: Array<{ id: Tab; label: string; icon: typeof Save }> = [
  { id: 'canvas',     label: 'Canvas',       icon: GitBranch },
  { id: 'dmn',        label: 'DMN',          icon: Cpu },
  { id: 'sla',        label: 'SLA & Calendar', icon: Calendar },
  { id: 'simulation', label: 'Simulation',   icon: Play },
  { id: 'versions',   label: 'Versions',     icon: History },
];

const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] };
const EMPTY_DMN: DmnMap = {};
const EMPTY_SLA: SlaMap = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function defaultPositionForType(_type: CanvasNodeType, existingCount: number): { x: number; y: number } {
  const col = existingCount % 4;
  const row = Math.floor(existingCount / 4);
  return { x: 60 + col * 200, y: 60 + row * 120 };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DesignerPage() {
  const role = useAuth((s) => s.user?.role);
  if (role !== 'Doc Admin') return <AccessDenied />;

  const { id: rawId } = useParams<{ id: string }>();
  const templateId = parseInt(rawId ?? '', 10);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [activeTab,       setActiveTab]       = useState<Tab>('canvas');
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [publishReason,   setPublishReason]   = useState('');
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedNodeId,  setSelectedNodeId]  = useState<string | null>(null);
  const [activeDmnTableId, setActiveDmnTableId] = useState<string | null>(null);
  const [calendarDraft, setCalendarDraft]     = useState<{
    name:         string;
    holidays:     string[];
    hours:        typeof BOB_DEFAULT_HOURS;
    editing:      boolean;
    calendarId:   number | null;
  }>({ name: '', holidays: [], hours: BOB_DEFAULT_HOURS, editing: false, calendarId: null });

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const templateQ = useQuery({
    queryKey: ['workflow-templates', templateId],
    queryFn: () => fetchTemplate(templateId),
    enabled: Number.isFinite(templateId),
  });

  const versionsQ = useQuery({
    queryKey: ['wf-template-versions', templateId],
    queryFn: () => fetchTemplateVersions(templateId),
    enabled: Number.isFinite(templateId),
  });

  const calendarsQ = useQuery({
    queryKey: ['business-calendars'],
    queryFn: fetchCalendars,
  });

  // Resolve the active version object.
  const versions = versionsQ.data ?? [];
  const activeVersion = useMemo<TemplateVersion | null>(
    () => (activeVersionId ? (versions.find((v) => v.id === activeVersionId) ?? null) : null),
    [versions, activeVersionId],
  );

  // Local editable draft of the active version's BPMN/DMN/SLA.
  const [localCanvas, setLocalCanvas] = useState<CanvasData>(EMPTY_CANVAS);
  const [localDmn,    setLocalDmn]    = useState<DmnMap>(EMPTY_DMN);
  const [localSla,    setLocalSla]    = useState<SlaMap>(EMPTY_SLA);

  // Sync local state when the active version changes.
  useEffect(() => {
    if (activeVersion) {
      setLocalCanvas(activeVersion.bpmn_json);
      setLocalDmn(activeVersion.dmn_json);
      setLocalSla(activeVersion.sla_json);
    } else {
      setLocalCanvas(EMPTY_CANVAS);
      setLocalDmn(EMPTY_DMN);
      setLocalSla(EMPTY_SLA);
    }
  }, [activeVersion]);

  // Auto-select the first draft or first version when versions load.
  useEffect(() => {
    if (activeVersionId !== null) return;
    if (versions.length > 0) {
      const draft = versions.find((v) => v.status === 'draft');
      setActiveVersionId((draft ?? versions[0])?.id ?? null);
    }
  }, [versions, activeVersionId]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const invalidateVersions = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['wf-template-versions', templateId] });
    void qc.invalidateQueries({ queryKey: ['workflow-templates', templateId] });
    void qc.invalidateQueries({ queryKey: ['workflow-templates'] });
  }, [qc, templateId]);

  const createVersionMut = useMutation({
    mutationFn: () => createTemplateVersion(templateId, {}),
    onSuccess: (v) => {
      invalidateVersions();
      setActiveVersionId(v.id);
      toast({ variant: 'success', title: 'New draft version created' });
    },
    onError: () => toast({ variant: 'error', title: 'Failed to create version' }),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!activeVersionId) throw new Error('No version selected');
      return updateTemplateVersion(templateId, activeVersionId, {
        bpmn_json: localCanvas,
        dmn_json:  localDmn,
        sla_json:  localSla,
      });
    },
    onSuccess: () => {
      invalidateVersions();
      toast({ variant: 'success', title: 'Version saved' });
    },
    onError: (e: unknown) => toast({
      variant: 'error',
      title: 'Save failed',
      message: (e as Error).message,
    }),
  });

  const publishMut = useMutation({
    mutationFn: () => {
      if (!activeVersionId) throw new Error('No version selected');
      return publishTemplateVersion(templateId, activeVersionId, { reason: publishReason });
    },
    onSuccess: () => {
      invalidateVersions();
      setShowPublishForm(false);
      setPublishReason('');
      toast({ variant: 'success', title: 'Version published' });
    },
    onError: (e: unknown) => toast({
      variant: 'error',
      title: 'Publish failed',
      message: (e as Error).message,
    }),
  });

  const createCalendarMut = useMutation({
    mutationFn: () => createCalendar({
      name:                calendarDraft.name,
      holidays_json:       calendarDraft.holidays,
      business_hours_json: calendarDraft.hours,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['business-calendars'] });
      setCalendarDraft((d) => ({ ...d, editing: false }));
      toast({ variant: 'success', title: 'Calendar created' });
    },
    onError: () => toast({ variant: 'error', title: 'Failed to create calendar' }),
  });

  const updateCalendarMut = useMutation({
    mutationFn: () => {
      if (!calendarDraft.calendarId) throw new Error('No calendar selected');
      return updateCalendar(calendarDraft.calendarId, {
        name:                calendarDraft.name,
        holidays_json:       calendarDraft.holidays,
        business_hours_json: calendarDraft.hours,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['business-calendars'] });
      setCalendarDraft((d) => ({ ...d, editing: false }));
      toast({ variant: 'success', title: 'Calendar updated' });
    },
    onError: () => toast({ variant: 'error', title: 'Failed to update calendar' }),
  });

  // ---------------------------------------------------------------------------
  // Canvas drop handler (add node from palette)
  // ---------------------------------------------------------------------------

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('application/bpmn-node-type') as CanvasNodeType;
      if (!nodeType) return;
      const newNode: CanvasNode = {
        id:    genId(),
        type:  nodeType,
        label: nodeType === 'start' ? 'Start'
               : nodeType === 'end'   ? 'End'
               : nodeType === 'decision' ? 'Decision'
               : nodeType === 'parallel-split' ? 'Fork'
               : nodeType === 'parallel-join'  ? 'Join'
               : nodeType === 'edd-case'       ? 'EDD Review'
               : 'New Stage',
        role:  nodeType === 'stage' || nodeType === 'edd-case' ? 'Maker' : undefined,
        ...defaultPositionForType(nodeType, localCanvas.nodes.length),
      };
      setLocalCanvas((c) => ({ ...c, nodes: [...c.nodes, newNode] }));
    },
    [localCanvas.nodes.length],
  );

  // ---------------------------------------------------------------------------
  // Selected node properties panel
  // ---------------------------------------------------------------------------

  const selectedNode = useMemo(
    () => localCanvas.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [localCanvas.nodes, selectedNodeId],
  );

  const updateSelectedNode = (patch: Partial<CanvasNode>) => {
    setLocalCanvas((c) => ({
      ...c,
      nodes: c.nodes.map((n) => (n.id === selectedNodeId ? { ...n, ...patch } : n)),
    }));
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setLocalCanvas((c) => ({
      nodes: c.nodes.filter((n) => n.id !== selectedNodeId),
      edges: c.edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId),
    }));
    setSelectedNodeId(null);
  };

  // ---------------------------------------------------------------------------
  // DMN helpers
  // ---------------------------------------------------------------------------

  const stageLabels = useMemo(
    () => localCanvas.nodes
      .filter((n) => n.type === 'stage' || n.type === 'edd-case')
      .map((n) => n.label),
    [localCanvas.nodes],
  );

  const createDmnTable = () => {
    const id = genId();
    const newTable: DmnTable = {
      id,
      name:   'New Decision Table',
      inputs: ['risk_band'],
      rules:  [
        { conditions: { risk_band: 'HIGH' }, output: stageLabels[0] ?? 'EDD Review' },
        { conditions: {},                    output: stageLabels[0] ?? 'Maker Review' },
      ],
    };
    setLocalDmn((d) => ({ ...d, [id]: newTable }));
    setActiveDmnTableId(id);
  };

  const deleteDmnTable = (id: string) => {
    setLocalDmn((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    if (activeDmnTableId === id) setActiveDmnTableId(null);
  };

  // ---------------------------------------------------------------------------
  // Stage nodes for SLA editor
  // ---------------------------------------------------------------------------

  const stageNodes = useMemo(
    () => localCanvas.nodes.filter((n) => n.type === 'stage' || n.type === 'edd-case'),
    [localCanvas.nodes],
  );

  // ---------------------------------------------------------------------------
  // Calendar edit helpers
  // ---------------------------------------------------------------------------

  const startEditCalendar = (cal: BusinessCalendar) => {
    setCalendarDraft({
      name:       cal.name,
      holidays:   cal.holidays_json,
      hours:      cal.business_hours_json,
      editing:    true,
      calendarId: cal.id,
    });
  };

  const startNewCalendar = () => {
    setCalendarDraft({
      name:       '',
      holidays:   BOB_DEFAULT_HOLIDAYS,
      hours:      BOB_DEFAULT_HOURS,
      editing:    true,
      calendarId: null,
    });
  };

  // ---------------------------------------------------------------------------
  // Readonly mode (published/archived)
  // ---------------------------------------------------------------------------

  const isReadonly = activeVersion?.status !== 'draft';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (templateQ.isLoading || versionsQ.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!templateQ.data) {
    return (
      <div className="p-8 text-center text-muted text-sm">
        Template not found.
      </div>
    );
  }

  const template = templateQ.data;
  const calendars = calendarsQ.data ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-divider bg-surface flex-shrink-0">
        <Link
          to="/workflows/templates"
          className="text-muted hover:text-ink"
          aria-label="Back to templates"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-md font-semibold text-ink flex-1">
          {template.name}
          <span className="ml-2 text-xs text-muted font-normal">Designer</span>
        </h1>

        {/* Version selector */}
        <div className="flex items-center gap-2">
          {versions.length > 0 && (
            <select
              value={activeVersionId ?? ''}
              onChange={(e) => setActiveVersionId(parseInt(e.target.value, 10))}
              className="input h-8 text-xs"
              aria-label="Select version"
              data-testid="designer-version-select"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} — {v.status}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => createVersionMut.mutate()}
            loading={createVersionMut.isPending}
            data-testid="designer-new-version"
          >
            <Plus size={13} /> New version
          </Button>
        </div>

        {/* Save / Publish */}
        {activeVersion?.status === 'draft' && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => saveMut.mutate()}
              loading={saveMut.isPending}
              data-testid="designer-save"
            >
              <Save size={13} /> Save
            </Button>
            <Button
              size="sm"
              onClick={() => setShowPublishForm((v) => !v)}
              data-testid="designer-publish-open"
            >
              <Send size={13} /> Publish
            </Button>
          </>
        )}
        {activeVersion && activeVersion.status !== 'draft' && (
          <span className="text-xs text-muted capitalize px-2 py-1 rounded-badge bg-divider">
            {activeVersion.status}
          </span>
        )}
      </header>

      {/* Publish form */}
      {showPublishForm && (
        <div className="flex items-center gap-3 px-6 py-3 bg-brand-skyLight border-b border-divider flex-shrink-0">
          <input
            type="text"
            value={publishReason}
            onChange={(e) => setPublishReason(e.target.value)}
            placeholder="Reason for publishing (min 20 chars)…"
            className="input flex-1 h-8 text-xs"
            data-testid="designer-publish-reason"
          />
          <Button
            size="sm"
            onClick={() => publishMut.mutate()}
            disabled={publishReason.trim().length < 20}
            loading={publishMut.isPending}
            data-testid="designer-publish-confirm"
          >
            Confirm publish
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowPublishForm(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-divider bg-surface px-6 flex-shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-brand-blue text-brand-blue'
                  : 'border-transparent text-ink-sub hover:text-ink',
              )}
              aria-selected={activeTab === tab.id}
              data-testid={`designer-tab-${tab.id}`}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">

        {/* Canvas tab */}
        {activeTab === 'canvas' && (
          <div className="flex h-full">
            {!isReadonly && <NodePalette />}

            {/* Canvas area */}
            <div
              className="flex-1 overflow-auto p-4 relative"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCanvasDrop}
              data-testid="designer-canvas"
            >
              {versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted">
                  <GitBranch size={32} className="opacity-30" />
                  <p className="text-sm">No version yet. Create a new version to start designing.</p>
                  <Button
                    size="sm"
                    onClick={() => createVersionMut.mutate()}
                    loading={createVersionMut.isPending}
                  >
                    <Plus size={13} /> Create first version
                  </Button>
                </div>
              ) : (
                <BpmnCanvas
                  data={localCanvas}
                  {...(!isReadonly && { onChange: setLocalCanvas })}
                  readonly={isReadonly}
                  highlightedNodes={highlightedNodes}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                />
              )}
            </div>

            {/* Properties panel */}
            {selectedNode && (
              <aside
                className="w-56 flex-shrink-0 border-l border-divider bg-surface-alt overflow-y-auto p-3 space-y-3"
                aria-label="Node properties"
              >
                <h3 className="text-xs font-semibold text-ink">Properties</h3>
                <div className="space-y-2">
                  <label className="flex flex-col text-2xs text-muted">
                    Label
                    <input
                      type="text"
                      value={selectedNode.label}
                      readOnly={isReadonly}
                      onChange={(e) => updateSelectedNode({ label: e.target.value })}
                      className="input h-7 text-xs mt-0.5"
                    />
                  </label>
                  {(selectedNode.type === 'stage' || selectedNode.type === 'edd-case') && (
                    <label className="flex flex-col text-2xs text-muted">
                      Role
                      <select
                        value={selectedNode.role ?? 'Maker'}
                        disabled={isReadonly}
                        onChange={(e) => updateSelectedNode({ role: e.target.value })}
                        className="input h-7 text-xs mt-0.5"
                      >
                        <option>Maker</option>
                        <option>Checker</option>
                        <option>Doc Admin</option>
                        <option>Compliance</option>
                        <option>system</option>
                      </select>
                    </label>
                  )}
                  {selectedNode.type === 'decision' && (
                    <label className="flex flex-col text-2xs text-muted">
                      DMN table
                      <select
                        value={selectedNode.dmn_table_id ?? ''}
                        disabled={isReadonly}
                        onChange={(e) => updateSelectedNode({ dmn_table_id: e.target.value || undefined })}
                        className="input h-7 text-xs mt-0.5"
                      >
                        <option value="">None</option>
                        {Object.values(localDmn).map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="text-2xs text-muted">
                    Type: <span className="font-mono">{selectedNode.type}</span>
                  </p>
                  <p className="text-2xs text-muted">
                    ID: <span className="font-mono text-2xs">{selectedNode.id}</span>
                  </p>
                  {!isReadonly && (
                    <button
                      type="button"
                      onClick={deleteSelectedNode}
                      className="text-2xs text-danger hover:underline"
                    >
                      Delete node
                    </button>
                  )}
                </div>
              </aside>
            )}
          </div>
        )}

        {/* DMN tab */}
        {activeTab === 'dmn' && (
          <div className="flex h-full overflow-hidden">
            {/* Table list */}
            <aside className="w-44 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto p-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1 py-1">
                Decision tables
              </p>
              {Object.values(localDmn).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveDmnTableId(t.id)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-input text-xs transition-colors',
                    activeDmnTableId === t.id
                      ? 'bg-brand-skyLight text-brand-blue font-semibold'
                      : 'text-ink-sub hover:bg-divider',
                  )}
                >
                  {t.name}
                </button>
              ))}
              {!isReadonly && (
                <Button size="sm" variant="ghost" className="w-full" onClick={createDmnTable}>
                  <Plus size={11} /> Add table
                </Button>
              )}
            </aside>

            <div className="flex-1 overflow-auto p-4">
              {activeDmnTableId && localDmn[activeDmnTableId] ? (
                <Panel
                  title={localDmn[activeDmnTableId]?.name ?? 'Decision table'}
                  action={
                    !isReadonly && (
                      <button
                        type="button"
                        onClick={() => deleteDmnTable(activeDmnTableId)}
                        className="text-xs text-danger hover:underline"
                      >
                        Delete
                      </button>
                    )
                  }
                >
                  <DmnEditor
                    table={localDmn[activeDmnTableId]!}
                    onChange={(t) => setLocalDmn((d) => ({ ...d, [t.id]: t }))}
                    readonly={isReadonly}
                  />
                </Panel>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted">
                  <Cpu size={24} className="opacity-30" />
                  <p className="text-sm">Select or create a decision table.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SLA & Calendar tab */}
        {activeTab === 'sla' && (
          <div className="overflow-auto p-6 space-y-6 max-w-3xl">
            <Panel title="Stage SLAs">
              <SlaEditor
                stageNodes={stageNodes}
                slaMap={localSla}
                calendars={calendars.map((c) => ({ id: c.id, name: c.name }))}
                onChange={setLocalSla}
                readonly={isReadonly}
              />
            </Panel>

            <Panel
              title="Business Calendars"
              action={
                !calendarDraft.editing && (
                  <Button size="sm" variant="ghost" onClick={startNewCalendar}>
                    <Plus size={11} /> New calendar
                  </Button>
                )
              }
            >
              {calendarDraft.editing ? (
                <div className="space-y-4">
                  <CalendarEditor
                    name={calendarDraft.name}
                    holidays={calendarDraft.holidays}
                    businessHours={calendarDraft.hours}
                    onChangeName={(n) => setCalendarDraft((d) => ({ ...d, name: n }))}
                    onChangeHolidays={(h) => setCalendarDraft((d) => ({ ...d, holidays: h }))}
                    onChangeHours={(h) => setCalendarDraft((d) => ({ ...d, hours: h }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        calendarDraft.calendarId
                          ? updateCalendarMut.mutate()
                          : createCalendarMut.mutate()
                      }
                      loading={createCalendarMut.isPending || updateCalendarMut.isPending}
                      disabled={!calendarDraft.name.trim()}
                    >
                      <Save size={13} /> Save calendar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCalendarDraft((d) => ({ ...d, editing: false }))}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {calendars.length === 0 && (
                    <p className="text-xs text-muted py-4 text-center">
                      No calendars. Create one to set business hours and BoB national holidays.
                    </p>
                  )}
                  {calendars.map((cal) => (
                    <div
                      key={cal.id}
                      className="flex items-center gap-3 rounded-input border border-divider px-3 py-2"
                    >
                      <div className="flex-1">
                        <p className="text-xs font-medium text-ink">{cal.name}</p>
                        <p className="text-2xs text-muted">
                          {cal.business_hours_json.days.length} work days ·{' '}
                          {cal.holidays_json.length} holidays · {cal.business_hours_json.tz}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditCalendar(cal)}
                        className="text-xs text-brand-blue hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* Simulation tab */}
        {activeTab === 'simulation' && (
          <div className="overflow-auto p-6 max-w-2xl">
            <Panel title="Workflow Simulation">
              <SimulationPanel
                canvas={localCanvas}
                dmnMap={localDmn}
                slaMap={localSla}
                onHighlightNodes={setHighlightedNodes}
              />
            </Panel>
          </div>
        )}

        {/* Versions tab */}
        {activeTab === 'versions' && (
          <div className="overflow-auto p-6 space-y-4 max-w-3xl">
            {versions.length < 2 && (
              <p className="text-xs text-muted">Create at least two versions to compare them.</p>
            )}
            {versions.length >= 2 && (() => {
              const latest = versions[0];
              const prev   = versions[1];
              if (!latest || !prev) return null;
              return (
                <Panel
                  title="Diff — latest vs previous"
                  action={
                    <span className="text-2xs text-muted">
                      v{prev.version} → v{latest.version}
                    </span>
                  }
                >
                  <VersionDiff
                    prev={prev.bpmn_json}
                    next={latest.bpmn_json}
                    prevLabel={`v${prev.version} (${prev.status})`}
                    nextLabel={`v${latest.version} (${latest.status})`}
                  />
                </Panel>
              );
            })()}

            {/* Version list */}
            <Panel title="All versions">
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className={cn(
                      'flex items-center gap-3 rounded-input border px-3 py-2 cursor-pointer transition-colors',
                      v.id === activeVersionId
                        ? 'border-brand-blue bg-brand-skyLight'
                        : 'border-divider hover:border-brand-blue/40',
                    )}
                    onClick={() => {
                      setActiveVersionId(v.id);
                      setActiveTab('canvas');
                    }}
                    data-testid={`designer-version-row-${v.id}`}
                  >
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-ink">v{v.version}</p>
                      <p className="text-2xs text-muted">{v.created_at}</p>
                    </div>
                    <span className={cn(
                      'text-2xs px-2 py-0.5 rounded-badge font-medium',
                      v.status === 'published' ? 'bg-success/20 text-success'
                      : v.status === 'draft'   ? 'bg-warning/20 text-warning'
                      : 'bg-divider text-muted',
                    )}>
                      {v.status}
                    </span>
                    <span className="text-2xs text-muted">
                      {v.bpmn_json.nodes.length} nodes
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
