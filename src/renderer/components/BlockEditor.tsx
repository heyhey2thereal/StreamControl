import { useRef, useState } from 'react';
import type { MacroAction, MacroActionKind, MacroCondition } from '../../shared/types';
import { BLOCKS, BLOCK_GROUPS, MACRO_CONDITIONS, MACRO_OPERATORS, blockFor, makeAction } from '../../shared/macro-blocks';
import { useTranslation } from '../hooks/useTranslation';
import { Icon, type IconName } from '../components/Icon';
import { VariableDialog } from '../components/VariableDialog';

interface EditorContext {
  /** Scenes OBS disponibles. */
  scenes: string[];
  /** Sources OBS disponibles (entrees audio et video). */
  sources: string[];
  /** Adresses de diffusion disponibles. */
  streams: Array<{ id: string; name: string; path: string }>;
}

/**
 * Bloc de la palette : on clique pour l'ajouter a la suite.
 *
 * Un simple clic suffit : le glisser-deposer est peu pratique au trackpad, et
 * l'ajout en fin de sequence est le geste le plus courant.
 */
export function BlockPalette({ onAdd }: { onAdd: (kind: MacroActionKind) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  /**
   * Filtre la palette sur le libelle du bloc.
   *
   * Avec 47 blocs, retrouver « verrouiller le poste » demandait de parcourir
   * cinq familles a l'oeil. La recherche cherche dans toutes les familles a la
   * fois, comme celle des reglages.
   */
  const needle = query.trim().toLowerCase();
  const matches = (block: (typeof BLOCKS)[number]): boolean => {
    if (!needle) return true;
    return (
      t(block.label as never).toLowerCase().includes(needle) ||
      block.kind.toLowerCase().includes(needle)
    );
  };

  const total = BLOCKS.filter(matches).length;

  return (
    <div className="block-palette">
      <div className="palette-search">
        <Icon name="search" size={13} />
        <input
          className="input"
          type="text"
          id="block-search"
          placeholder={t('macro.searchBlock')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" className="btn tiny ghost" onClick={() => setQuery('')} title={t('action.reset')}>
            ✕
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="muted" style={{ padding: '8px 2px' }}>
          {t('macro.noBlockMatch', { filter: query.trim() })}
        </div>
      ) : null}

      {BLOCK_GROUPS.map((group) => {
        const blocks = BLOCKS.filter((block) => block.group === group.id && matches(block));
        if (blocks.length === 0) return null;
        return (
          <div className="palette-group" key={group.id}>
            <div className="palette-title">
              <Icon name={group.icon as IconName} size={13} />
              {t(group.label as never)}
              <span className="muted"> {blocks.length}</span>
            </div>
            {blocks.map((block) => (
              <button
                key={block.kind}
                type="button"
                className={`palette-block group-${group.id}`}
                // Glisser-deposer : on depose le bloc a l'endroit voulu, sans
                // devoir l'ajouter puis le remonter a la main.
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/streamcontrol-block', block.kind);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAdd(block.kind)}
                title={t(block.label as never)}
              >
                <span className="block-dot" aria-hidden />
                {t(block.label as never)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Un champ de bloc, selon son type. */
function Field({
  action,
  field,
  context,
  onChange,
}: {
  action: MacroAction;
  field: (typeof BLOCKS)[number]['fields'][number];
  context: EditorContext;
  onChange: (patch: Partial<MacroAction>) => void;
}) {
  const { t } = useTranslation();
  const value = (action as unknown as Record<string, unknown>)[field.key as string];
  const text = String(value ?? '');

  /** Applique la limite du champ, pour ne pas accepter une saisie refusee. */
  const clamp = (next: string): string =>
    field.maxLength && next.length > field.maxLength ? next.slice(0, field.maxLength) : next;

  // Tous les champs texte portent le bouton variable : un nom de scene, une
  // source, une adresse peuvent aussi contenir une variable.
  const withVariables = (control: React.ReactNode, onInsert: (token: string) => void) => (
    <div className="variable-field">
      {control}
      <VariableInsertButton onPick={onInsert} streams={context.streams} />
    </div>
  );

  if (field.kind === 'scene') {
    // Liste deroulante si OBS a fourni ses scenes, saisie libre sinon.
    // Sans ce repli, un menu vide rendrait le bloc inutilisable tant qu'OBS
    // n'est pas connecte : « on ne peut rien mettre ».
    if (context.scenes.length > 0) {
      return (
        <select className="input" value={text} onChange={(e) => onChange({ scene: e.target.value })}>
          <option value="">{t('macro.pickScene')}</option>
          {context.scenes.map((scene) => (
            <option key={scene} value={scene}>
              {scene}
            </option>
          ))}
        </select>
      );
    }
    return withVariables(
      <input
        className="input"
        type="text"
        value={text}
        placeholder={t('macro.sceneName')}
        maxLength={field.maxLength}
        onChange={(e) => onChange({ scene: clamp(e.target.value) })}
      />,
      (token) => onChange({ scene: clamp(`${text}${token}`) }),
    );
  }

  if (field.kind === 'stream') {
    // Meme repli que les scenes : sans adresse connue, on saisit l'identifiant
    // a la main plutot que de rester bloque sur un menu vide.
    if (context.streams.length > 0) {
      return (
        <select className="input" value={text} onChange={(e) => onChange({ streamId: e.target.value })}>
          <option value="">{t('macro.pickStream')}</option>
          {context.streams.map((stream) => (
            <option key={stream.id} value={stream.id}>
              {stream.name} (/{stream.path})
            </option>
          ))}
        </select>
      );
    }
    return withVariables(
      <input
        className="input"
        type="text"
        value={text}
        placeholder={t('macro.streamName')}
        maxLength={field.maxLength}
        onChange={(e) => onChange({ streamId: clamp(e.target.value) })}
      />,
      (token) => onChange({ streamId: clamp(`${text}${token}`) }),
    );
  }

  if (field.kind === 'source') {
    // Liste deroulante si OBS expose ses sources, saisie libre sinon : une
    // source peut ne pas encore exister au moment ou la macro est ecrite.
    if (context.sources.length > 0) {
      return (
        <select className="input" value={text} onChange={(e) => onChange({ source: e.target.value })}>
          <option value="">{t('macro.pickSource')}</option>
          {context.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      );
    }
    return withVariables(
      <input
        className="input"
        type="text"
        value={text}
        placeholder={t('macro.sourceName')}
        maxLength={field.maxLength}
        onChange={(e) => onChange({ source: clamp(e.target.value) })}
      />,
      (token) => onChange({ source: clamp(`${text}${token}`) }),
    );
  }

  if (field.kind === 'level') {
    return (
      <select
        className="input"
        value={text || 'info'}
        onChange={(e) => onChange({ level: e.target.value as MacroAction['level'] })}
      >
        <option value="info">{t('macro.levelInfo')}</option>
        <option value="warn">{t('macro.levelWarn')}</option>
        <option value="error">{t('macro.levelError')}</option>
      </select>
    );
  }

  if (field.kind === 'condition') {
    // Etat predefini : c'est le repli du bloc condition, et le seul test du
    // bloc « attendre une condition ».
    return (
      <select
        className="input"
        value={text || 'obs-connected'}
        onChange={(e) => onChange({ condition: e.target.value as MacroCondition })}
      >
        {MACRO_CONDITIONS.map((condition) => (
          <option key={condition.id} value={condition.id}>
            {t(condition.label as never)}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'operator') {
    // Comparaison du bloc condition : egal, contient, plus petit que...
    return (
      <select
        className="input"
        value={text || 'equal'}
        onChange={(e) => onChange({ conditionOperator: e.target.value as MacroAction['conditionOperator'] })}
      >
        {MACRO_OPERATORS.map((operator) => (
          <option key={operator.id} value={operator.id}>
            {t(operator.label as never)}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'choice') {
    // Choix limite : ce qui se passe quand une condition est fausse.
    return (
      <select
        className="input"
        value={text || String(field.default ?? '')}
        onChange={(e) => onChange({ [field.key]: e.target.value } as Partial<MacroAction>)}
      >
        {(field.choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {t(choice.label as never)}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'toggle') {
    // La cle du champ est respectee : une case peut piloter autre chose que
    // `enabled` (« Demander une confirmation », par exemple).
    //
    // Le libelle n'est PAS repete ici : le bloc affiche deja le libelle du
    // champ juste au-dessus. Le repeter le faisait apparaitre deux fois.
    return (
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value !== false}
          onChange={(e) => onChange({ [field.key]: e.target.checked } as Partial<MacroAction>)}
        />
        <span>{value !== false ? t('common.yes') : t('common.no')}</span>
      </label>
    );
  }

  if (field.kind === 'number') {
    return (
      <input
        className="input"
        type="number"
        min={field.min}
        max={field.max}
        value={Number(value ?? field.default ?? 0)}
        onChange={(e) =>
          onChange({ [field.key]: Number.parseInt(e.target.value, 10) || 0 } as Partial<MacroAction>)
        }
      />
    );
  }

  if (field.kind === 'file' || field.kind === 'folder') {
    // Le bloc « jouer un son » porte aussi un volume : la pre-ecoute le suit.
    const soundVolume = (action as unknown as Record<string, unknown>).soundVolume;
    return (
      <PathField
        kind={field.kind}
        value={text}
        maxLength={field.maxLength}
        streamContext={context.streams}
        volume={typeof soundVolume === 'number' ? soundVolume : undefined}
        onChange={(next) => onChange({ [field.key]: next } as Partial<MacroAction>)}
      />
    );
  }

  // Champs libres : texte, URL, mot de passe. Ils acceptent les variables, et
  // portent donc le bouton « {x} » a droite.
  return (
    <VariableField
      type={field.kind === 'password' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
      value={text}
      streams={context.streams}
      placeholder={field.kind === 'url' ? 'http://...' : undefined}
      multiline={field.multiline}
      maxLength={field.maxLength}
      onChange={(next) => onChange({ [field.key]: next } as Partial<MacroAction>)}
    />
  );
}

/**
 * Champ texte avec bouton d'insertion de variable.
 *
 * L'insertion se fait **au curseur** : on retrouve la position de selection au
 * moment du clic, et le jeton s'insere la, pas a la fin. Sans cela, ecrire
 * « Debut du direct pour » puis inserer `{flux_nom}` aurait donne
 * « Debut du direct pour {flux_nom} »... mais aussi « pour {flux_nom}debut » si
 * le curseur etait ailleurs. La position est donc memorisee a chaque frappe.
 */
function VariableField({
  type,
  value,
  placeholder,
  multiline,
  maxLength,
  streams,
  onChange,
}: {
  type: 'text' | 'url' | 'password';
  value: string;
  placeholder?: string;
  /** Adresses disponibles, pour le selecteur de flux de la pop-up. */
  streams?: Array<{ id: string; name: string; path: string }>;
  /** Vrai pour un message long : le champ s'affiche sur plusieurs lignes. */
  multiline?: boolean;
  /** Nombre maximal de caracteres acceptes. */
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  /** Position du curseur, mise a jour a chaque selection. */
  const caret = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });

  /** Insere un jeton a la position memorisee du curseur. */
  const insert = (token: string) => {
    const { start, end } = caret.current;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // Une espace avant, si le texte precedent ne se termine pas deja par une.
    const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${prefix}${token}${after}`;
    onChange(next);
    const cursor = before.length + prefix.length + token.length;
    caret.current = { start: cursor, end: cursor };
    // Le curseur revient apres le jeton insere, pour continuer a taper.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  };

  /** Enregistre la saisie, en respectant la limite du champ. */
  const handleChange = (next: string, target: HTMLInputElement | HTMLTextAreaElement) => {
    caret.current = {
      start: target.selectionStart ?? next.length,
      end: target.selectionEnd ?? next.length,
    };
    // La limite est appliquee a la saisie : on ne laisse pas ecrire ce qui
    // serait refuse ensuite.
    onChange(maxLength && next.length > maxLength ? next.slice(0, maxLength) : next);
  };

  const overLimit = Boolean(maxLength && value.length >= maxLength);

  return (
    <div className={`variable-field${multiline ? ' multiline' : ''}`}>
      {multiline ? (
        // Un message long tient mal sur une ligne : on l'affiche en zone de
        // texte, ou tout le contenu reste visible.
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="input"
          value={value}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value, event.target)}
          onSelect={(event) => {
            const target = event.currentTarget;
            caret.current = { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 };
          }}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          className="input"
          type={type}
          value={value}
          autoComplete="off"
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value, event.target)}
          onSelect={(event) => {
            const target = event.currentTarget;
            caret.current = { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 };
          }}
        />
      )}
      <VariableInsertButton onPick={insert} streams={streams} />
      {/* Le compteur n'apparait qu'a l'approche de la limite : inutile de
          l'afficher pour un champ a peine rempli. */}
      {maxLength && value.length > maxLength * 0.75 ? (
        <span className={`char-count${overLimit ? ' full' : ''}`}>
          {value.length}/{maxLength}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Bouton « {x} » qui ouvre la liste des variables.
 *
 * Il ne fait que demander l'insertion : c'est le champ qui decide ou poser le
 * jeton, puisqu'il est seul a connaitre la position du curseur.
 */
function VariableInsertButton({
  onPick,
  streams,
}: {
  onPick: (token: string) => void;
  /** Adresses disponibles : la pop-up propose alors un flux a designer. */
  streams?: Array<{ id: string; name: string; path: string }>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn tiny ghost variable-button"
        title={t('var.insert')}
        aria-label={t('var.insert')}
        onClick={() => setOpen(true)}
      >
        {'{x}'}
      </button>
      {open ? (
        <VariableDialog
          streams={streams ?? []}
          onPick={(token) => onPick(`{${token}}`)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Champ de chemin avec bouton « Parcourir ».
 *
 * L'utilisateur choisit un fichier ou un dossier dans l'explorateur au lieu de
 * recopier un chemin, source d'erreurs. Un son choisi peut etre ecoute sur
 * place, ce qui evite de lancer la macro pour verifier le bon fichier.
 */
function PathField({
  kind,
  value,
  onChange,
  volume,
  maxLength,
  streamContext,
}: {
  kind: 'file' | 'folder';
  value: string;
  onChange: (value: string) => void;
  /** Volume de pre-ecoute, de 0 a 100. Absent = plein volume. */
  volume?: number;
  /** Nombre maximal de caracteres acceptes. */
  maxLength?: number;
  /** Adresses disponibles, pour le selecteur de flux de la pop-up. */
  streamContext?: Array<{ id: string; name: string; path: string }>;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const browse = async () => {
    const picked = await window.streamcontrol.macroPickPath(kind);
    if (picked) onChange(picked);
  };

  const preview = async () => {
    const dataUrl = await window.streamcontrol.macroReadSound(value);
    if (!dataUrl) return;
    setPlaying(true);
    const audio = new Audio(dataUrl);
    // La pre-ecoute respecte le volume du bloc : on entend ce qu'on obtiendra.
    audio.volume = typeof volume === 'number' ? Math.max(0, Math.min(1, volume / 100)) : 1;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    void audio.play().catch(() => setPlaying(false));
  };

  /** Ajoute un jeton a la fin du chemin : un chemin se termine rarement par une variable. */
  const append = (token: string) => {
    const next = value ? `${value}${token}` : token;
    onChange(next);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="path-field">
      <div className="input-row">
        <input
          ref={inputRef}
          className="input"
          type="text"
          value={value}
          autoComplete="off"
          maxLength={maxLength}
          placeholder={kind === 'folder' ? t('macro.folderPlaceholder') : t('macro.filePlaceholder')}
          onChange={(event) => onChange(event.target.value)}
        />
        <VariableInsertButton onPick={append} streams={streamContext} />
        <button type="button" className="btn small" onClick={() => void browse()}>
          {t('action.browse')}
        </button>
        {kind === 'file' && value ? (
          <button
            type="button"
            className="btn small ghost"
            disabled={playing}
            title={t('macro.testSound')}
            onClick={() => void preview()}
          >
            {playing ? t('macro.playing') : t('macro.testSound')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Editeur d'une suite de blocs.
 *
 * Les blocs s'empilent verticalement, dans l'ordre d'execution. Les blocs
 * « condition » et « repeter » contiennent une sous-sequence : c'est ce qui
 * forme l'arbre, comme un editeur de blocs classique.
 */
export function BlockSequence({
  actions,
  context,
  onChange,
  depth = 0,
}: {
  actions: MacroAction[];
  context: EditorContext;
  onChange: (actions: MacroAction[]) => void;
  depth?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  /** Index devant lequel un bloc serait depose (-1 = aucun). */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** Index du bloc en cours de deplacement dans cette sequence. */
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const update = (index: number, patch: Partial<MacroAction>) => {
    const next = [...actions];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const remove = (index: number) => onChange(actions.filter((_, i) => i !== index));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    const next = [...actions];
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry);
    onChange(next);
  };

  const duplicate = (index: number) => {
    const next = [...actions];
    next.splice(index + 1, 0, JSON.parse(JSON.stringify(actions[index])) as MacroAction);
    onChange(next);
  };

  /**
   * Accepte un depot : un bloc de la palette (creation) ou un bloc deplace.
   * La position visee est `dropAt`.
   */
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const position = dropAt ?? actions.length;
    setDropAt(null);

    const kind = event.dataTransfer.getData('text/streamcontrol-block');
    if (kind) {
      const next = [...actions];
      next.splice(position, 0, makeAction(kind as MacroActionKind));
      onChange(next);
      setDragFrom(null);
      return;
    }

    if (dragFrom !== null && dragFrom !== position) {
      const next = [...actions];
      const [entry] = next.splice(dragFrom, 1);
      next.splice(dragFrom < position ? position - 1 : position, 0, entry);
      onChange(next);
    }
    setDragFrom(null);
  };

  if (actions.length === 0) {
    return (
      <div
        className={`block-sequence empty${depth > 0 ? ' nested' : ''}${dropAt === 0 ? ' drop-target' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropAt(0);
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={handleDrop}
      >
        <span className="muted">{depth > 0 ? t('macro.emptyNested') : t('macro.emptySequence')}</span>
      </div>
    );
  }

  return (
    <div className={`block-sequence${depth > 0 ? ' nested' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      {actions.map((action, index) => {
        const definition = blockFor(action.kind);
        const group = definition?.group ?? 'controle';
        const isOpen = open === index;
        return (
          <div
            className={`block group-${group}${isOpen ? ' open' : ''}${dropAt === index ? ' drop-target' : ''}`}
            key={`${action.kind}-${index}`}
            // Le bloc lui-meme se deplace : on peut reordonner a la souris.
            draggable
            onDragStart={(event) => {
              setDragFrom(index);
              event.dataTransfer.effectAllowed = 'move';
              // Un marqueur vide : c'est `dragFrom` qui porte l'information.
              event.dataTransfer.setData('text/streamcontrol-move', String(index));
            }}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              // On vise la position du bloc survole, selon la moitie.
              const box = event.currentTarget.getBoundingClientRect();
              const after = event.clientY > box.top + box.height / 2;
              setDropAt(index + (after ? 1 : 0));
            }}
            onDrop={handleDrop}
          >
            <div className="block-head">
              <button
                type="button"
                className="block-toggle"
                onClick={() => setOpen(isOpen ? null : index)}
                aria-expanded={isOpen}
              >
                <span className="block-index">{index + 1}</span>
                <span className="block-label">{t((definition?.label ?? `macro.kind.${action.kind}`) as never)}</span>
                {action.delaySeconds ? <span className="block-delay">+{action.delaySeconds}s</span> : null}
                {action.scene ? <span className="block-arg">{action.scene}</span> : null}
                {action.text ? <span className="block-arg">{action.text}</span> : null}
                <span className="block-caret" aria-hidden>
                  {isOpen ? '\u25BE' : '\u25B8'}
                </span>
              </button>
              <div className="block-tools">
                <button type="button" className="btn tiny ghost" onClick={() => move(index, -1)} title={t('macro.up')}>
                  ↑
                </button>
                <button type="button" className="btn tiny ghost" onClick={() => move(index, 1)} title={t('macro.down')}>
                  ↓
                </button>
                <button type="button" className="btn tiny ghost" onClick={() => duplicate(index)} title={t('macro.duplicate')}>
                  ⧉
                </button>
                <button type="button" className="btn tiny danger" onClick={() => remove(index)} title={t('action.delete')}>
                  ✕
                </button>
              </div>
            </div>

            {isOpen ? (
              <div className="block-body">
                {(definition?.fields ?? []).map((field) => (
                  <div className="field" key={String(field.key)}>
                    <label>{t(field.label as never)}</label>
                    <Field action={action} field={field} context={context} onChange={(patch) => update(index, patch)} />
                    {field.hint ? <div className="hint">{t(field.hint as never)}</div> : null}
                  </div>
                ))}

                {/* Delai avant le bloc suivant : c'est ce qui espace la sequence. */}
                <div className="field">
                  <label>{t('macro.delay')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={3600}
                    value={action.delaySeconds ?? 0}
                    onChange={(e) =>
                      update(index, { delaySeconds: Number.parseInt(e.target.value, 10) || 0 })
                    }
                  />
                  <div className="hint">{t('macro.delayHint')}</div>
                </div>

                {/* Bloc imbrique : une sous-sequence. */}
                {definition?.nested ? (
                  <div className="field">
                    <label>{t('macro.innerSequence')}</label>
                    <BlockSequence
                      actions={action.actions ?? []}
                      context={context}
                      depth={depth + 1}
                      onChange={(children) => update(index, { actions: children })}
                    />
                    <AddBlockMenu
                      onAdd={(kind) => update(index, { actions: [...(action.actions ?? []), makeAction(kind)] })}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Petit menu pour ajouter un bloc dans une sous-sequence. */
function AddBlockMenu({ onAdd }: { onAdd: (kind: MacroActionKind) => void }) {
  const { t } = useTranslation();
  return (
    <select
      className="input block-add"
      value=""
      onChange={(event) => {
        if (event.target.value) onAdd(event.target.value as MacroActionKind);
      }}
    >
      <option value="">{t('macro.addInBlock')}</option>
      {BLOCKS.map((block) => (
        <option key={block.kind} value={block.kind}>
          {t(block.label as never)}
        </option>
      ))}
    </select>
  );
}
