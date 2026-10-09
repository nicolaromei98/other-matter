/**
 * Entry curtain: waits for fonts and shader compilation (capped, so a slow
 * driver never blocks the page), then fades away.
 */
export async function runLoader(el: HTMLElement, tasks: Promise<unknown>[], cap = 4000): Promise<void> {
  const label = el.querySelector('.om-label') as HTMLElement;
  const face = label ? getComputedStyle(label).font : '';
  const fontIn = face && document.fonts ? document.fonts.load(face, label.textContent ?? '') : Promise.resolve();
  Promise.race([fontIn, new Promise((r) => setTimeout(r, 800))]).finally(() => el.classList.add('is-ready'));
  const bar = el.querySelector('.loader-bar i') as HTMLElement;
  const count = el.querySelector('.loader-count') as HTMLElement;
  let done = 0;
  const total = tasks.length;
  const tick = () => {
    done++;
    bar.style.transform = `scaleX(${done / total})`;
    count.textContent = `${Math.round((done / total) * 6)}/6`;
  };
  const all = Promise.all(tasks.map((t) => t.then(tick, tick)));
  await Promise.race([all, new Promise((r) => setTimeout(r, cap))]);
  bar.style.transform = 'scaleX(1)';
  count.textContent = '6/6';
  await new Promise((r) => setTimeout(r, 200));
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 1000);
}
