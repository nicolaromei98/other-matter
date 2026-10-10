/**
 * Osmo Supply — Button 038 (used for INSPECT SPECIMEN).
 * Same logic as the resource: measure the hover scale from the
 * data-button-038-width/height-hover attributes, then split the label into
 * one span per character (with --index for the stagger). The animation itself
 * is CSS (base.css, "Button 038").
 */
export function initButton038(root: ParentNode = document): void {
  const buttons = root.querySelectorAll<HTMLElement>('[data-button-038]');
  if (buttons.length === 0) return;

  buttons.forEach((element) => {
    const textElement = element.querySelector<HTMLElement>('[data-button-038-text]');
    const widthHover = Number(element.getAttribute('data-button-038-width-hover')) || 0;
    const heightHover = Number(element.getAttribute('data-button-038-height-hover')) || 0;
    if (!textElement) return;

    const setScale = (x: number, y: number) => {
      element.style.setProperty('--button-038-scale-x', String(x));
      element.style.setProperty('--button-038-scale-y', String(y));
    };

    const updateScale = () => {
      const currentWidth = element.offsetWidth;
      const currentHeight = element.offsetHeight;
      const scaleX = (currentWidth + widthHover) / currentWidth;
      const scaleY = (currentHeight + heightHover) / currentHeight;
      setScale(scaleX, scaleY);
    };

    updateScale();
    const text = textElement.textContent ?? '';
    textElement.innerHTML = '';

    [...text].forEach((char, index) => {
      const span = document.createElement('span');
      span.textContent = char;
      span.style.setProperty('--index', String(index));

      if (char === ' ') {
        span.style.whiteSpace = 'pre';
      }

      textElement.appendChild(span);
    });
  });
}
