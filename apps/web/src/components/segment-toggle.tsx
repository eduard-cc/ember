import {cn} from '../utils/cn';
import {ToggleGroup, ToggleGroupItem} from './ui/toggle-group';

/** An outline ToggleGroup with the selected item on the secondary wash. */
export function SegmentToggle<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
  itemClassName,
}: {
  value: T;
  onChange: (value: T) => void;
  items: {value: T; label: string}[];
  label: string;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ToggleGroup
      type='single'
      variant='outline'
      size='sm'
      value={value}
      onValueChange={(next) => {
        const item = items.find((i) => i.value === next);
        if (item) {
          onChange(item.value);
        }
      }}
      aria-label={label}
      className={className}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          className={cn(
            'min-h-9 shrink-0 touch-manipulation px-3 text-xs active:bg-accent data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-secondary-foreground max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
            itemClassName,
          )}
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
