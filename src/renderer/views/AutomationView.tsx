import { useEffect, useState } from 'react';
import type {
  Macro,
  MacroAction,
  MacroActionKind,
  MacroRunEntry,
  MacroTrigger,
  MacroTriggerKind,
  ShowStep,
} from '../../shared/types';
import { makeAction } from '../../shared/macro-blocks';
import { MACRO_TEMPLATES } from '../../shared/macro-templates';
import { VARIABLE_PATTERN, variableFor } from '../../shared/macro-variables';
import type { StreamControl } from '../hooks/useStreamControl';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Spinner';
import { BlockPalette, BlockSequence } from '../components/BlockEditor';

/**
 * Compte les variables distinctes utilisees par une suite d'actions.
 *
 * Le modele est montre avec ce nombre : l'operateur voit d'un coup d'oeil
 * combien de valeurs du moment il exploite. On descend dans les blocs imbriques.
 */
function countTemplateVariables(actions: MacroAction[]): number {
  const found = new Set<string>();
  const visit = (list: MacroAction[]) => {
    for (const action of list) {
      for (const value of Object.values(action as unknown as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        for (const match of value.matchAll(VARIABLE_PATTERN)) {
          if (variableFor(match[1])) found.add(match[1]);
        }
      }
      if (Array.isArray(action.actions)) visit(action.actions);
    }
  };
  visit(actions);
  return found.size;
}

/** Declencheurs proposes, dans l'ordre du formulaire. */
const TRIGGER_KINDS: MacroTriggerKind[] = [
  'manual',
  'stream-connect',
  'stream-disconnect',
  'alert',
  'schedule',
  'startup',
];

/** Natures d'alerte pouvant declencher une macro. */
const ALERT_KINDS = ['offline', 'online', 'low-bitrate', 'recovered'];

/**
 * Onglet Automatisation.
 *
 * Deux parties : les **macros**, construites comme un arbre de blocs (chacun
 * empile une action, et certains blocs en contiennent d'autres), et le
 * **conducteur de spectacle**, une liste d'etapes horodatees.
 */
export function AutomationView({ sc }: { sc: StreamControl }) {
  const { t } = useTranslation();
  const [macros, setMacros] = useState<Macro[]>([]);
  const [steps, setSteps] = useState<ShowStep[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [newStep, setNewStep] = useState({ name: '', at: '' });
  const [history, setHistory] = useState<MacroRunEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const reload = async () => {
    const list = await window.streamcontrol.macrosList();
    setMacros(list);
    setSteps(await window.streamcontrol.showList());
    setRunning((await window.streamcontrol.macrosRunning()).running);
    setHistory(await window.streamcontrol.macroHistory());
    setSelected((previous) => previous ?? list[0]?.id ?? null);
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      void window.streamcontrol.macrosRunning().then((result) => setRunning(result.running));
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const context = {
    scenes: sc.obs.scenes.map((scene) => scene.name),
    sources: sc.obs.sources ?? [],
    streams: sc.streams.map((stream) => ({ id: stream.id, name: stream.name, path: stream.path })),
  };

  const addMacro = async () => {
    const macro = await window.streamcontrol.macroCreate(t('macro.newName'));
    await reload();
    setSelected(macro.id);
  };

  /** Cree une macro a partir d'un modele, puis la selectionne. */
  const useTemplate = async (id: string, name: string) => {
    const macro = await window.streamcontrol.macroFromTemplate(id, name);
    if (!macro) return;
    await reload();
    setSelected(macro.id);
    setShowTemplates(false);
    sc.notify('ok', t('tpl.created', { name: macro.name }));
  };

  /**
   * Met a jour une macro.
   *
   * Mise a jour **optimiste** : l'interface applique le changement tout de
   * suite, et l'ecriture disque suit. Sans cela, le champ controle affichait
   * l'ancienne valeur jusqu'a la fin de l'aller-retour IPC : on avait
   * l'impression que la saisie « ne changeait rien ».
   */
  const updateMacro = async (id: string, patch: Partial<Macro>) => {
    setMacros((previous) => previous.map((macro) => (macro.id === id ? { ...macro, ...patch } : macro)));
    await window.streamcontrol.macroUpdate(id, patch);
  };

  const duplicate = async (id: string) => {
    const copy = await window.streamcontrol.macroDuplicate(id);
    await reload();
    if (copy) setSelected(copy.id);
  };

  /** Exporte les macros dans un fichier JSON, choisi par l'utilisateur. */
  const exportMacros = async () => {
    const json = await window.streamcontrol.macroExport();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `streamcontrol-macros-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    sc.notify('ok', t('macro.exported'));
  };

  /** Importe des macros depuis un fichier JSON choisi par l'utilisateur. */
  const importMacros = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await window.streamcontrol.macroImport(await file.text());
      if (result.imported > 0) {
        sc.notify('ok', t('macro.imported', { count: result.imported }));
        await reload();
      } else {
        sc.notify('err', result.message ?? t('macro.importFailed'));
      }
    };
    input.click();
  };

  const runMacro = async (id: string) => {
    setBusy(id);
    try {
      const result = await window.streamcontrol.macroRun(id);
      sc.notify(
        result.ok ? 'ok' : 'warn',
        result.ok ? t('macro.done', { count: result.executed }) : result.message ?? t('macro.failed'),
      );
    } finally {
      setBusy('');
    }
  };

  const current = macros.find((macro) => macro.id === selected) ?? null;
  const currentIndex = steps.findIndex((step) => !step.done);

  /** Ajoute un declencheur, en evitant les doublons de nature. */
  const addTrigger = async (macro: Macro, kind: MacroTriggerKind) => {
    if (macro.triggers.some((trigger) => trigger.kind === kind)) return;
    await updateMacro(macro.id, { triggers: [...macro.triggers, { kind }] });
  };

  const updateTrigger = async (macro: Macro, index: number, patch: Partial<MacroTrigger>) => {
    const triggers = macro.triggers.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger));
    await updateMacro(macro.id, { triggers });
  };

  const removeTrigger = async (macro: Macro, index: number) => {
    await updateMacro(macro.id, { triggers: macro.triggers.filter((_, i) => i !== index) });
  };

  return (
    <div className="content">
      <div className="topbar" style={{ margin: '-20px -22px 20px', padding: '15px 22px' }}>
        <div>
          <h1>{t('nav.automation')}</h1>
          <div className="topbar-sub">{t('automation.subtitle')}</div>
        </div>
      </div>

      {/* --- Modeles de macro -------------------------------------------- */}
      <div className="section-title">{t('tpl.title')}</div>
      <div className="panel">
        <div className="hint">{t('tpl.subtitle')}</div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn small"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            {showTemplates ? t('tpl.hide') : t('tpl.show')}
            <span className="muted"> {MACRO_TEMPLATES.length}</span>
          </button>
        </div>

        {showTemplates ? (
          <div className="template-grid" id="template-grid">
            {MACRO_TEMPLATES.map((template) => {
              // On construit le modele a blanc, pour compter ses actions et ses
              // variables : l'operateur voit ce qu'il obtient avant de cliquer.
              const preview = template.build({
                streams: context.streams,
                scenes: context.scenes,
              });
              const variableCount = countTemplateVariables(preview);
              return (
                <div className="template-card" key={template.id}>
                  <div className="template-head">
                    <Icon name={template.icon as never} size={15} />
                    <span className="template-name">{t(template.label as never)}</span>
                  </div>
                  <div className="template-desc">{t(template.description as never)}</div>
                  <div className="template-meta">
                    <span className="badge">{t(template.level as never)}</span>
                    <span className="muted">{t('tpl.actions', { count: preview.length })}</span>
                    <span className="muted">{t('tpl.variables', { count: variableCount })}</span>
                  </div>
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => void useTemplate(template.id, t(template.label as never))}
                  >
                    {t('tpl.use')}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* --- Macros ------------------------------------------------------ */}
      <div className="section-title">{t('macro.title')}</div>

      {macros.length === 0 ? (
        <div className="panel">
          <div className="muted">{t('macro.empty')}</div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn small primary" onClick={() => void addMacro()}>
              {t('macro.create')}
            </button>
          </div>
        </div>
      ) : (
        <div className="automation-layout">
          {/* Liste des macros, a gauche. */}
          <div className="macro-list">
            {macros.map((macro) => (
              <button
                key={macro.id}
                type="button"
                className={`macro-item${macro.id === selected ? ' active' : ''}`}
                onClick={() => setSelected(macro.id)}
              >
                <span className="macro-name">{macro.name}</span>
                {running.includes(macro.id) ? <Spinner size={12} /> : null}
                <span className="macro-count">{macro.actions.length}</span>
              </button>
            ))}
            <button type="button" className="btn small primary" style={{ marginTop: 8 }} onClick={() => void addMacro()}>
              {t('macro.create')}
            </button>
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button type="button" className="btn tiny ghost" onClick={() => void exportMacros()} title={t('macro.export')}>
                {t('macro.export')}
              </button>
              <button type="button" className="btn tiny ghost" onClick={() => void importMacros()} title={t('macro.import')}>
                {t('macro.import')}
              </button>
            </div>
          </div>

          {/* Editeur de la macro choisie. */}
          {current ? (
            <div className="macro-editor">
              <div className="panel">
                <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    className="input"
                    value={current.name}
                    onChange={(event) => void updateMacro(current.id, { name: event.target.value })}
                  />
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busy === current.id || running.includes(current.id)}
                    onClick={() => void runMacro(current.id)}
                  >
                    {t('macro.run')}
                  </button>
                  {running.includes(current.id) ? (
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => void window.streamcontrol.macroStop(current.id)}
                    >
                      {t('action.stop')}
                    </button>
                  ) : null}
                  <button type="button" className="btn small ghost" onClick={() => void duplicate(current.id)}>
                    {t('macro.duplicate')}
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() =>
                      void window.streamcontrol.macroDelete(current.id).then(() => {
                        setSelected(null);
                        return reload();
                      })
                    }
                  >
                    {t('action.delete')}
                  </button>
                </div>

                <label className="checkbox" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={current.disabled !== true}
                    onChange={(event) => void updateMacro(current.id, { disabled: !event.target.checked })}
                  />
                  {t('macro.enabled')}
                </label>
              </div>

              {/* --- Declencheurs ---------------------------------------- */}
              <div className="panel">
                <div className="section-title" style={{ marginTop: 0 }}>{t('macro.triggers')}</div>
                <div className="hint">{t('macro.triggersHint')}</div>

                <div className="chip-row" style={{ marginTop: 10 }}>
                  {TRIGGER_KINDS.filter((kind) => !current.triggers.some((trigger) => trigger.kind === kind)).map(
                    (kind) => (
                      <button key={kind} type="button" className="chip" onClick={() => void addTrigger(current, kind)}>
                        <Icon name="macros" size={13} />
                        {t(`macro.trigger.${kind}` as never)}
                      </button>
                    ),
                  )}
                </div>

                {current.triggers.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    {current.triggers.map((trigger, index) => (
                      <div className="tool-row" key={`${trigger.kind}-${index}`}>
                        <div style={{ flex: 1 }}>
                          <strong>
                            <Icon name="macros" size={13} /> {t(`macro.trigger.${trigger.kind}` as never)}
                          </strong>
                          {/* Parametres du declencheur, selon sa nature. */}
                          {trigger.kind === 'stream-connect' || trigger.kind === 'stream-disconnect' ? (
                            <select
                              className="input"
                              style={{ marginTop: 6 }}
                              value={trigger.path ?? ''}
                              onChange={(event) => void updateTrigger(current, index, { path: event.target.value })}
                            >
                              <option value="">{t('macro.anyStream')}</option>
                              {context.streams.map((stream) => (
                                <option key={stream.id} value={stream.path}>
                                  {stream.name} (/{stream.path})
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {trigger.kind === 'alert' ? (
                            <select
                              className="input"
                              style={{ marginTop: 6 }}
                              value={trigger.alertKind ?? ''}
                              onChange={(event) => void updateTrigger(current, index, { alertKind: event.target.value })}
                            >
                              <option value="">{t('macro.anyAlert')}</option>
                              {ALERT_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {t(`watch.kind.${kind}` as never)}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {trigger.kind === 'schedule' ? (
                            <input
                              className="input"
                              style={{ marginTop: 6 }}
                              type="time"
                              value={trigger.at ?? ''}
                              onChange={(event) => void updateTrigger(current, index, { at: event.target.value })}
                            />
                          ) : null}
                        </div>
                        <button type="button" className="btn small ghost" onClick={() => void removeTrigger(current, index)}>
                          {t('action.delete')}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* --- Blocs ------------------------------------------------ */}
              <div className="block-layout">
                <div className="panel">
                  <div className="section-title" style={{ marginTop: 0 }}>{t('macro.palette')}</div>
                  <div className="hint">{t('macro.paletteHint')}</div>
                  <BlockPalette
                    onAdd={(kind: MacroActionKind) =>
                      void updateMacro(current.id, { actions: [...current.actions, makeAction(kind)] })
                    }
                  />
                </div>

                <div className="panel">
                  <div className="section-title" style={{ marginTop: 0 }}>{t('macro.sequence')}</div>
                  <div className="hint">{t('macro.sequenceHint')}</div>
                  <BlockSequence
                    actions={current.actions}
                    context={context}
                    onChange={(actions: MacroAction[]) => void updateMacro(current.id, { actions })}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* --- Journal d'execution ----------------------------------------- */}
      <div className="section-title">
        {t('macro.history')}
        {history.length > 0 ? <span className="badge" style={{ marginLeft: 8 }}>{history.length}</span> : null}
      </div>
      <div className="panel">
        <div className="btn-row">
          <button type="button" className="btn small ghost" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? t('macro.hideHistory') : t('macro.showHistory')}
          </button>
          {history.length > 0 ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void window.streamcontrol.macroHistoryClear().then(reload)}
            >
              {t('macro.clearHistory')}
            </button>
          ) : null}
        </div>

        {showHistory ? (
          history.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>{t('macro.noHistory')}</div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {history.slice(0, 30).map((entry) => (
                <div className="tool-row" key={entry.id}>
                  <div>
                    <strong>
                      <span className={`badge ${entry.ok ? 'ok' : 'err'}`} style={{ marginRight: 8 }}>
                        {entry.ok ? t('macro.ok') : t('macro.ko')}
                      </span>
                      {entry.macroName}
                    </strong>
                    <div className="tool-path">
                      {new Date(entry.at).toLocaleString()} · {entry.executed}/{entry.total} ·{' '}
                      {entry.durationMs} ms · {t(`macro.origin.${entry.origin}` as never)}
                    </div>
                    {entry.message ? <div className="tool-path">{entry.message}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="btn tiny ghost"
                    onClick={() => void runMacro(entry.macroId)}
                    title={t('macro.runAgain')}
                  >
                    {t('macro.runAgain')}
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="hint">{t('macro.historyHint')}</div>
        )}
      </div>

      {/* --- Conducteur de spectacle ------------------------------------- */}
      <div className="section-title">{t('show.title')}</div>
      <div className="panel">
        <div className="hint">{t('show.subtitle')}</div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="field">
            <label>{t('show.stepName')}</label>
            <input
              className="input"
              value={newStep.name}
              placeholder={t('show.stepPlaceholder')}
              onChange={(event) => setNewStep({ ...newStep, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('show.stepTime')}</label>
            <input
              className="input"
              type="time"
              value={newStep.at}
              onChange={(event) => setNewStep({ ...newStep, at: event.target.value })}
            />
          </div>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn small"
            disabled={newStep.name.trim().length === 0}
            onClick={() =>
              void window.streamcontrol.showAdd(newStep.name, newStep.at, '').then(() => {
                setNewStep({ name: '', at: '' });
                return reload();
              })
            }
          >
            {t('show.addStep')}
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={steps.length === 0}
            onClick={() =>
              void window.streamcontrol.showNext().then((result) => {
                if (!result.ok && result.message) sc.notify('warn', result.message);
                return reload();
              })
            }
          >
            {t('show.next')}
          </button>
          <button type="button" className="btn small ghost" onClick={() => void window.streamcontrol.showReset().then(reload)}>
            {t('show.reset')}
          </button>
        </div>
      </div>

      {steps.length > 0 ? (
        <div className="panel">
          {steps.map((step, index) => (
            <div
              className="tool-row"
              key={step.id}
              style={{
                borderColor: index === currentIndex ? 'var(--accent)' : undefined,
                opacity: step.done ? 0.55 : 1,
              }}
            >
              <div>
                <strong>
                  {step.done ? <Icon name="check" size={14} /> : null} {step.name}
                </strong>
                <div className="tool-path">
                  {step.at ? `${step.at} · ` : ''}
                  {step.actions.length} {t('show.actions')}
                </div>
              </div>
              <button
                type="button"
                className="btn small danger"
                onClick={() => void window.streamcontrol.showDelete(step.id).then(reload)}
              >
                {t('action.delete')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
