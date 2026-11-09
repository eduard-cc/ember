import {ChevronRight, CircleAlert, CloudOff, Loader, Lock} from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {useBackLayer} from '../state/back';
import type {SyncIssue, useSync} from '../sync/use-sync';
import {cn} from '../utils/cn';
import {dateLabel} from '../utils/date';
import {plural} from '../utils/plural';
import {Announcement} from './StateNotice';
import {Button} from './ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ui/responsive-dialog';

/**
 * Ongoing conditions in three tiers, each shown in one place and opening one details drawer:
 * - quiet: heals by itself (connecting, offline, history downloading). A small outlined pill on
 *   the header's meta line or beside the page title.
 * - notice: needs the owner but is not a failure (read-only tab). A neutral strip under the header.
 * - problem: a failed save or sync, or unreadable data. A destructive strip under the header.
 * Nothing shows when all is well.
 */
export type Tier = 'quiet' | 'notice' | 'problem';
export interface Condition {
  key:
    | 'connecting'
    | 'offline'
    | 'downloading'
    | 'read-only'
    | 'not-synced'
    | 'not-saved'
    | 'unreadable';
  tier: Tier;
  /** The pill or strip text. */
  short: string;
  title: string;
  body: string;
  items?: {key: string; name: string; detail: string}[];
  /** The strip's link text: what tapping it leads to. */
  link?: string;
  action?: {
    label: string;
    danger?: boolean;
    /** Runs with the drawer's action button, which a follow-up confirmation returns focus to. */
    run: (trigger: HTMLButtonElement) => void;
  };
}

const issueDetail: Record<string, string> = {
  REVISION_CONFLICT: 'Changed on another device',
  DOCUMENT_TOO_LARGE: 'Too large to sync',
};

/** What a retained sync issue holds back, named from its queued operation. */
function issueItem(issue: SyncIssue) {
  const payload = issue.payload;
  // Templates and empty imported rows can have no date.
  const named = (name: string, date: string) =>
    [name || 'Untitled', date && dateLabel(date)].filter(Boolean).join(' · ');
  const name =
    issue.kind === 'putBodyWeight' && payload
      ? named('Body weight', payload.date)
      : issue.kind === 'putTemplate' && payload && 'name' in payload
        ? named(payload.name, '') + ' · template'
        : issue.kind === 'deleteTemplate'
          ? 'Deleted template'
          : issue.kind === 'deleteWorkout' || issue.kind === 'deleteImportedWorkout'
            ? 'Deleted workout'
            : payload && 'name' in payload
              ? named(payload.name, payload.date)
              : 'A change';
  const code = issue.errorCode ?? 'SYNC_REJECTED';
  return {
    key: issue.operationId,
    name,
    detail: issueDetail[code] ?? `Refused by your server (${code})`,
  };
}

/**
 * The app's current conditions, most urgent first. Sync conditions wait while a storage or
 * ownership problem stands (sync does not run then); a sync lock has its own full page.
 */
export function appConditions({
  ownershipError,
  persistenceError,
  recoveryError,
  sync,
  onReset,
}: {
  ownershipError: string;
  persistenceError: string;
  recoveryError: string;
  sync: Pick<
    ReturnType<typeof useSync>,
    'locked' | 'issues' | 'pending' | 'lastAttemptFailed' | 'historyDownload' | 'status'
  >;
  onReset: (trigger: HTMLButtonElement) => void;
}): Condition[] {
  const conditions: Condition[] = [];
  if (recoveryError)
    conditions.push({
      key: 'unreadable',
      tier: 'problem',
      short: 'Saved data can’t be read',
      title: 'Saved data unavailable',
      body: recoveryError,
      action: {label: 'Reset unreadable saved data', danger: true, run: onReset},
    });
  else if (persistenceError)
    conditions.push({
      key: 'not-saved',
      tier: 'problem',
      short: 'Can’t save on this phone',
      title: 'Can’t save on this phone',
      body: persistenceError,
    });
  if (!sync.locked && sync.issues.length) {
    const n = sync.issues.length;
    conditions.push({
      key: 'not-synced',
      tier: 'problem',
      short: `${plural(n, 'change')} not synced`,
      title: 'Changes not synced',
      body: `Your server refused ${n === 1 ? 'this change. It is' : 'these changes. They are'} kept on this phone; later edits to the same item wait until this is resolved.`,
      items: sync.issues.map(issueItem),
    });
  }
  if (ownershipError) {
    // Reload helps only once the writer tab closes; without Web Locks it never would.
    const reloadable = typeof navigator.locks?.request === 'function';
    conditions.push({
      key: 'read-only',
      tier: 'notice',
      short: reloadable
        ? 'Read-only · Ember is open in another tab'
        : 'Read-only · this browser can’t protect your draft',
      title: 'Read-only tab',
      body: ownershipError,
      link: reloadable ? 'Reload' : undefined,
      action: reloadable
        ? {label: 'Reload to enable editing', run: () => location.reload()}
        : undefined,
    });
  }
  if (ownershipError || persistenceError || sync.locked) return conditions;
  const waiting = sync.pending
    ? ` ${plural(sync.pending, 'change')} ${sync.pending === 1 ? 'is' : 'are'} saved on this phone and will sync when your server is reachable.`
    : '';
  if (sync.historyDownload === 'downloading')
    conditions.push({
      key: 'downloading',
      tier: 'quiet',
      short: 'Downloading history',
      title: 'History downloading',
      body: 'Downloading your workout history from your server. Older workouts appear as they arrive.',
    });
  else if (sync.lastAttemptFailed)
    conditions.push({
      key: 'offline',
      tier: 'quiet',
      short: sync.pending ? `Offline · ${sync.pending} waiting` : 'Offline',
      title: 'Offline',
      body:
        (sync.historyDownload === 'waiting'
          ? 'Ember can’t reach your server, so your workout history has not finished downloading.'
          : 'Ember can’t reach your server.') +
        waiting +
        ' Ember reconnects on its own.',
    });
  else if (sync.status === 'Connecting…')
    conditions.push({
      key: 'connecting',
      tier: 'quiet',
      short: 'Connecting…',
      title: 'Connecting',
      body: 'Ember is reaching your server. Everything you do now is saved on this phone first.',
    });
  return conditions;
}

const ConditionsContext = createContext<{
  conditions: Condition[];
  /** An open editor shows the conditions; the page and logger under it step aside. */
  covered: boolean;
  cover: (delta: 1 | -1) => void;
}>({conditions: [], covered: false, cover: () => {}});

export function ConditionsProvider({
  conditions,
  children,
}: {
  conditions: Condition[];
  children: ReactNode;
}) {
  const [covers, setCovers] = useState(0);
  const cover = useCallback((delta: 1 | -1) => setCovers((n) => n + delta), []);
  return (
    <ConditionsContext.Provider value={{conditions, covered: covers > 0, cover}}>
      {children}
    </ConditionsContext.Provider>
  );
}

/**
 * The conditions this surface shows. `covering` marks an editor, which takes them over from the
 * page or logger beneath it, so each condition still shows in one place.
 */
function useShownConditions(covering: boolean) {
  const {conditions, covered, cover} = useContext(ConditionsContext);
  useLayoutEffect(() => {
    if (!covering) return;
    cover(1);
    return () => cover(-1);
  }, [covering, cover]);
  return covering || !covered ? conditions : [];
}

function ConditionIcon({condition, size}: {condition: Condition; size: number}) {
  const Icon =
    condition.tier === 'problem'
      ? CircleAlert
      : condition.tier === 'notice'
        ? Lock
        : condition.key === 'offline'
          ? CloudOff
          : Loader;
  return (
    <Icon
      size={size}
      aria-hidden='true'
      className={cn('shrink-0', Icon === Loader && 'motion-safe:animate-slow-spin')}
    />
  );
}

/** One condition's explanation, its affected items and its action. A drawer on phones. */
function ConditionDetails({
  condition,
  open,
  onOpenChange,
  trigger,
}: {
  condition: Condition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pill or strip that opened it, which closing returns to. */
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  useBackLayer(open, () => onOpenChange(false));
  const {action, items} = condition;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className='condition-details'
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault();
          trigger.current?.focus({preventScroll: true});
        }}
      >
        <ResponsiveDialogHeader className='text-left'>
          <ResponsiveDialogTitle
            className={cn(
              'flex items-center gap-2',
              condition.tier === 'problem' && 'text-destructive',
            )}
          >
            <ConditionIcon condition={condition} size={20} />
            {condition.title}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className='[overflow-wrap:anywhere]'>
            {condition.body}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {items && (
          <ul className='mx-4 mt-2 border-t border-border desk:mx-0'>
            {items.map((item) => (
              <li
                key={item.key}
                className='flex min-h-14 flex-col justify-center border-b border-border py-2 [overflow-wrap:anywhere]'
              >
                <span className='text-[14px] font-medium text-foreground'>{item.name}</span>
                <span className='text-[12px] text-muted-foreground'>{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <ResponsiveDialogFooter className='max-desk:flex-col max-desk:*:min-h-12'>
          {action && (
            <Button
              variant={action.danger ? 'secondary' : 'primary'}
              className={cn(action.danger && 'text-destructive')}
              onClick={(event) => action.run(event.currentTarget)}
            >
              {action.label}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** The quiet condition, if any: a small outlined pill. Absent when all is well. */
export function StatusPill({
  className,
  covering = false,
}: {
  className?: string;
  covering?: boolean;
}) {
  const condition = useShownConditions(covering).find((c) => c.tier === 'quiet');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!condition) return null;
  return (
    <>
      <button
        ref={trigger}
        type='button'
        onClick={() => setOpen(true)}
        className={cn(
          'status-pill press-feedback relative inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[12px] font-medium whitespace-nowrap text-muted-foreground tabular-nums hover:text-foreground',
          // A 44px target without growing the line it sits on.
          "after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']",
          className,
        )}
      >
        <ConditionIcon condition={condition} size={13} />
        <span className='truncate'>{condition.short}</span>
        <span className='sr-only'>, details</span>
      </button>
      <Announcement
        surface={trigger}
        title={condition.title}
        text={condition.body}
        urgent={false}
      />
      <ConditionDetails
        condition={condition}
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
      />
    </>
  );
}

function StatusStrip({condition, className}: {condition: Condition; className?: string}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const problem = condition.tier === 'problem';
  return (
    <>
      <button
        ref={trigger}
        type='button'
        onClick={() => setOpen(true)}
        className={cn(
          'status-strip press-feedback flex min-h-12 w-full shrink-0 items-center gap-2.5 border-b px-4 text-left text-[14px]',
          problem
            ? 'border-destructive/40 bg-destructive-foreground font-semibold text-destructive'
            : 'border-border bg-accent font-medium text-foreground',
          className,
        )}
      >
        <ConditionIcon condition={condition} size={16} />
        <span className='min-w-0 flex-1 py-2 [overflow-wrap:anywhere]'>{condition.short}</span>
        <span className='text-[12px] font-semibold underline decoration-current/40 underline-offset-2'>
          {condition.link ?? 'Details'}
        </span>
        <ChevronRight size={16} aria-hidden='true' className='-mr-1 shrink-0' />
      </button>
      <Announcement surface={trigger} title={condition.title} text={condition.body} urgent />
      <ConditionDetails
        condition={condition}
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
      />
    </>
  );
}

/** Conditions that need the owner: full-width strips in the layout, never over content. */
export function StatusStrips({
  className,
  omit,
  covering = false,
}: {
  className?: string;
  /** Shown by the surface itself, e.g. an editor's own failed save. */
  omit?: Condition['key'];
  covering?: boolean;
}) {
  const conditions = useShownConditions(covering).filter(
    (c) => c.tier !== 'quiet' && c.key !== omit,
  );
  if (!conditions.length) return null;
  return (
    <div className='status-strips flex shrink-0 flex-col'>
      {conditions.map((condition) => (
        <StatusStrip key={condition.key} condition={condition} className={className} />
      ))}
    </div>
  );
}
