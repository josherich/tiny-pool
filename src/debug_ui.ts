import { physicsConfig, PHYSICS_DEFAULTS } from './pool_physics';

export type DebugUI = {
  container: HTMLDivElement;
  visible: boolean;
  toggle: () => void;
  destroy: () => void;
};

type ParamConfig = {
  key: keyof typeof PHYSICS_DEFAULTS;
  label: string;
  step: number;
  decimals: number;
};

const PARAMS: ParamConfig[] = [
  { key: 'BALL_MASS', label: 'Ball Mass', step: 0.001, decimals: 3 },
  { key: 'BALL_RESTITUTION', label: 'Ball Restitution', step: 0.01, decimals: 2 },
  { key: 'BALL_FRICTION', label: 'Ball Friction', step: 0.01, decimals: 2 },
  { key: 'CUSHION_RESTITUTION', label: 'Cushion Restitution', step: 0.01, decimals: 2 },
  { key: 'CUSHION_FRICTION', label: 'Cushion Friction', step: 0.01, decimals: 2 },
  { key: 'ROLLING_FRICTION', label: 'Rolling Friction', step: 0.001, decimals: 3 },
  { key: 'TABLE_FRICTION', label: 'Table Friction', step: 0.05, decimals: 2 },
  { key: 'SPIN_SCALE', label: 'Spin Scale', step: 0.05, decimals: 2 },
  { key: 'SIDESPIN_DECAY', label: 'Sidespin Decay', step: 0.05, decimals: 2 },
  { key: 'CUSHION_GRIP', label: 'Cushion Grip', step: 0.05, decimals: 2 },
  { key: 'LINEAR_DAMPING', label: 'Linear Damping', step: 0.01, decimals: 2 },
  { key: 'ANGULAR_DAMPING', label: 'Angular Damping', step: 0.01, decimals: 2 },
  { key: 'MAX_SHOT_POWER', label: 'Max Shot Power', step: 0.1, decimals: 1 },
];

export function createDebugUI(): DebugUI {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    width: 280px;
    background: rgba(15, 15, 20, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 12px;
    font-family: monospace;
    font-size: 11px;
    color: #e0e0e0;
    z-index: 10000;
    display: none;
    backdrop-filter: blur(8px);
    user-select: none;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  `;

  const title = document.createElement('span');
  title.textContent = 'Physics Debug';
  title.style.cssText = 'font-weight: bold; font-size: 12px; color: hsl(45, 80%, 65%);';

  const resetAllBtn = document.createElement('button');
  resetAllBtn.textContent = 'Reset All';
  resetAllBtn.style.cssText = `
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: #ccc;
    font-size: 10px;
    font-family: monospace;
    padding: 2px 8px;
    cursor: pointer;
  `;
  resetAllBtn.addEventListener('click', () => {
    Object.assign(physicsConfig, PHYSICS_DEFAULTS);
    updateAllSliders();
  });

  header.appendChild(title);
  header.appendChild(resetAllBtn);
  container.appendChild(header);

  const sliderElements: { slider: HTMLInputElement; valueLabel: HTMLSpanElement; key: keyof typeof PHYSICS_DEFAULTS }[] = [];

  // Create sliders for each parameter
  for (const param of PARAMS) {
    const defaultVal = PHYSICS_DEFAULTS[param.key];
    const min = defaultVal * 0.2;
    const max = defaultVal * 5.5;

    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 8px;';

    // Label row
    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;';

    const label = document.createElement('span');
    label.textContent = param.label;
    label.style.cssText = 'color: #aaa; font-size: 10px;';

    const valueLabel = document.createElement('span');
    valueLabel.textContent = physicsConfig[param.key].toFixed(param.decimals);
    valueLabel.style.cssText = 'color: #fff; font-size: 10px; min-width: 40px; text-align: right;';

    labelRow.appendChild(label);
    labelRow.appendChild(valueLabel);

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(param.step);
    slider.value = String(physicsConfig[param.key]);
    slider.style.cssText = `
      width: 100%;
      height: 4px;
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    `;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      (physicsConfig as Record<string, number>)[param.key] = val;
      valueLabel.textContent = val.toFixed(param.decimals);
    });

    sliderElements.push({ slider, valueLabel, key: param.key });

    row.appendChild(labelRow);
    row.appendChild(slider);
    container.appendChild(row);
  }

  // Hint text
  const hint = document.createElement('div');
  hint.textContent = 'Press / three times to toggle';
  hint.style.cssText = `
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    color: #666;
    font-size: 9px;
    text-align: center;
  `;
  container.appendChild(hint);

  // Add slider thumb styles via a <style> element
  const style = document.createElement('style');
  style.textContent = `
    .debug-physics-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: hsl(45, 80%, 65%);
      cursor: pointer;
    }
    .debug-physics-slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: hsl(45, 80%, 65%);
      border: none;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  // Add class to all sliders
  for (const { slider } of sliderElements) {
    slider.classList.add('debug-physics-slider');
  }

  document.body.appendChild(container);

  function updateAllSliders() {
    for (const { slider, valueLabel, key } of sliderElements) {
      const param = PARAMS.find(p => p.key === key)!;
      slider.value = String(physicsConfig[key]);
      valueLabel.textContent = physicsConfig[key].toFixed(param.decimals);
    }
  }

  let visible = false;

  function toggle() {
    visible = !visible;
    container.style.display = visible ? 'block' : 'none';
  }

  function destroy() {
    container.remove();
    style.remove();
  }

  return { container, visible, toggle, destroy };
}

// Triple-slash detection: tracks '/' keypresses and triggers callback
// when 3 are pressed within the time window
export function setupTripleSlashToggle(onToggle: () => void): () => void {
  const TIME_WINDOW = 600; // ms
  const slashTimes: number[] = [];

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== '/') return;

    // Don't trigger when typing in input fields
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const now = Date.now();
    slashTimes.push(now);

    // Keep only recent presses within the window
    while (slashTimes.length > 0 && now - slashTimes[0] > TIME_WINDOW) {
      slashTimes.shift();
    }

    if (slashTimes.length >= 3) {
      slashTimes.length = 0;
      onToggle();
    }
  }

  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
