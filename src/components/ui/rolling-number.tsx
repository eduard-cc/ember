import NumberFlow, {type NumberFlowProps} from '@number-flow/react';

/**
 * A count that rolls to its new value (NumberFlow), for set counters that change while logging.
 * NumberFlow draws every digit column in its shadow root and names itself through
 * ElementInternals; `data-value` keeps the plain value readable from the DOM as well.
 */
export function RollingNumber({value, ...props}: NumberFlowProps & {value: number}) {
  return <NumberFlow value={value} data-value={value} {...props} />;
}
