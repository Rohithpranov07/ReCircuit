import type { TreeRow } from '../api/types';

interface Props {
  rows: TreeRow[];
  rootLabel: string;
  /** parts that belong to another date's tree: shown, but greyed out */
  absent?: TreeRow[];
  onOpen?: (unitId: number) => void;
}

/** The parts inside a unit on the chosen date, as a nested list. */
export function PartTree({ rows, rootLabel, absent = [], onOpen }: Props) {
  const here = new Set(rows.map((r) => r.unit_id));
  const all = [...rows, ...absent.filter((r) => !here.has(r.unit_id))];
  const children = (parent: number | null) => all.filter((r) => (parent === null ? r.depth === 1 : r.parent_unit_id === parent));

  function render(parent: number | null): React.ReactNode {
    const list = children(parent);
    if (list.length === 0) return null;
    return (
      <ul className={parent === null ? 'space-y-1' : 'mt-1 ml-5 space-y-1 border-l border-solder pl-4'}>
        {list.map((r) => {
          const inside = here.has(r.unit_id);
          return (
            <li key={r.unit_id}>
              <button type="button" onClick={() => onOpen?.(r.unit_id)} disabled={!onOpen}
                      className={`rounded-md px-2 py-1 text-left hover:bg-tray ${inside ? '' : 'text-ink-soft opacity-60'}`}>
                <span className="font-medium">{r.model_number}</span>{' '}
                <span className="text-sm text-ink-soft">{r.category.toLowerCase()} · {r.serial_no}</span>
                {!inside && <span className="ml-2 text-xs italic">not inside on this date</span>}
              </button>
              {render(r.unit_id)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div>
      <p className="font-medium">{rootLabel}</p>
      {all.length === 0 ? <p className="mt-2 text-ink-soft">Nothing was installed in this unit on that date.</p> : <div className="mt-2">{render(null)}</div>}
    </div>
  );
}
