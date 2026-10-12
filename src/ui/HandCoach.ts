import gsap from 'gsap';

export interface CoachInput {
  /** A hand is in the frame. */
  present: boolean;
  /** 0 a fist … 1 open. */
  open: number;
  /** How far the stage specimen is broken apart (0…1). */
  fragment: number;
  /** A strike landed this frame. */
  struck: boolean;
}

interface Step {
  text: string;
  done: (s: CoachInput) => boolean;
}

/** Each step, and what has to happen (held for a moment) to move on. */
const STEPS: Step[] = [
  { text: 'RAISE YOUR HAND TO THE CAMERA', done: (s) => s.present },
  { text: 'CLOSE IT INTO A FIST', done: (s) => s.present && s.open < 0.2 },
  { text: 'OPEN IT WIDE OVER THE SPECIMEN — IT BREAKS APART', done: (s) => s.fragment > 0.7 },
  { text: 'TAKE YOUR HAND OUT OF FRAME — IT REFORMS', done: (s) => !s.present && s.fragment < 0.25 },
  { text: 'BRING IT BACK AND SWIPE FAST THROUGH IT', done: (s) => s.struck },
];
const HOLD = 0.45;
const KEY = 'om-hand-coach';

/**
 * A short guided tour of the hand gestures, the first time hand tracking is
 * switched on: one instruction at a time in a pill under the header, moving
 * on only once the gesture has actually been made (and held for a moment),
 * with dots for the steps. Remembered once finished.
 */
export class HandCoach {
  private readonly el: HTMLElement;
  private readonly text: HTMLElement;
  private readonly dots: HTMLElement[];
  private step = -1;
  private held = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'om-coach';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.innerHTML = `<span class="om-coach-dots">${STEPS.map(() => '<i></i>').join('')}</span><span class="om-label om-coach-text"></span>`;
    document.body.appendChild(this.el);
    this.text = this.el.querySelector('.om-coach-text') as HTMLElement;
    this.dots = [...this.el.querySelectorAll<HTMLElement>('.om-coach-dots i')];
  }

  get running(): boolean {
    return this.step >= 0;
  }

  /** Start the tour, unless it was finished before (or `again`). */
  start(again = false): void {
    let seen = false;
    try {
      seen = localStorage.getItem(KEY) === 'done';
    } catch {
      /* storage may be unavailable: show it */
    }
    if (seen && !again) return;
    this.el.hidden = false;
    gsap.fromTo(this.el, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out', overwrite: true });
    this.go(0);
  }

  stop(): void {
    if (this.step < 0) return;
    this.step = -1;
    gsap.to(this.el, { autoAlpha: 0, duration: 0.3, overwrite: true, onComplete: () => void (this.el.hidden = true) });
  }

  private go(i: number): void {
    this.step = i;
    this.held = 0;
    this.dots.forEach((d, k) => d.classList.toggle('is-on', k <= i));
    this.say(STEPS[i].text);
  }

  private say(t: string): void {
    gsap.to(this.text, {
      autoAlpha: 0,
      duration: 0.15,
      overwrite: true,
      onComplete: () => {
        this.text.textContent = t;
        gsap.to(this.text, { autoAlpha: 1, duration: 0.25 });
      },
    });
  }

  update(s: CoachInput, dt: number): void {
    if (this.step < 0 || this.step >= STEPS.length) return;
    // a strike is an instant: no hold needed
    this.held = STEPS[this.step].done(s) ? this.held + (s.struck ? HOLD : dt) : 0;
    if (this.held < HOLD) return;
    if (this.step + 1 < STEPS.length) {
      this.go(this.step + 1);
      return;
    }
    // finished
    this.step = STEPS.length;
    this.dots.forEach((d) => d.classList.add('is-on'));
    this.say('THAT IS ALL — YOUR PALM IS THE POINTER');
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* not remembered: it shows again next time */
    }
    gsap.delayedCall(3.2, () => {
      if (this.step === STEPS.length) this.stop();
    });
  }
}
