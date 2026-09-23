import { IconCheck as Check } from '@tabler/icons-react';
import { useEffect, useState, type JSX } from 'react';
import { Icon } from './icons';

interface Props {
  /** The control's own action is running. */
  working: boolean;
  /**
   * How many times that action has *succeeded*, which is a counter rather than a flag on purpose:
   * what replays the tick is the element being inserted again, and what inserts it again is the
   * `key` changing. A boolean would mark the first success and stay silent for every one after it.
   */
  done: number;
}

/**
 * What a control says about its own work (GC-214).
 *
 * The status bar says *what* is happening, in words, at the bottom of the window; this says
 * *which control* it is happening to, where the user is actually looking — they just clicked it.
 * Two states and no third: a spinner while the work runs, a tick when it lands. There is no
 * failure mark, deliberately — a failure has a sentence to say and the status bar is where
 * sentences go, and a red cross on the toolbar would be the app repeating itself in the least
 * informative place available.
 *
 * Neither is drawn for a fast action. The spinner carries `--dur-work` of `animation-delay` with
 * `backwards` fill, so a commit that takes 40ms removes this element long before its own first
 * frame and nothing is ever painted; see the Work block in tokens.css. The tick does not defer —
 * it is the only signal a fast action gives at all.
 *
 * **The tick is unmounted by its own `animationend`,** and that is load-bearing rather than tidy.
 * The first version let it stay at `opacity: 0` with `forwards` fill, on the grounds that an
 * animation which ends invisible needs nobody to put it away — true, and it left the mark in the
 * tree for good, which meant the button underneath could never know the flourish was over. The
 * toolbar's icon is hidden while a mark is showing, so a permanent mark is a permanently hidden
 * icon; drawn the other way round, with the icon back at full strength, the tick and the icon
 * were two glyphs in one 18px cell — measured on a Refresh whose arrows came out tinted green.
 * The animation's own end event is exact, needs no timer and no cleanup, and costs one render.
 */
export function ActionMark({ working, done }: Props): JSX.Element | null {
  const [showing, setShowing] = useState(0);
  useEffect(() => {
    if (done > 0) setShowing(done);
  }, [done]);
  const tick = showing > 0 && showing === done;
  if (!working && !tick) return null;
  return (
    <span className="action-mark" aria-hidden="true">
      {working && <span className="spinner work" />}
      {tick && (
        <span key={done} className="done" onAnimationEnd={() => setShowing(0)}>
          <Icon of={Check} size={16} />
        </span>
      )}
    </span>
  );
}
