// PrintFrame — геометрия рамки: доли зоны (0..1) → CSS-проценты над мокапом.
// Рамка = overflow:hidden (clip «за рамку нельзя»). DOM-взаимодействие проверяется в браузере.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrintFrame } from '../src/js/tshirt/PrintFrame.js';

const zone = { box: { x: 0.3, y: 0.26, w: 0.4, h: 0.34 }, cm: { w: 40, h: 50 } };
const canvas = { width: 1200, height: 1200 };

test('cssBox переводит доли зоны в проценты', () => {
  const f = new PrintFrame(zone, canvas);
  assert.deepEqual(f.cssBox(), { left: '30%', top: '26%', width: '40%', height: '34%' });
});

test('contains: точка внутри долей рамки', () => {
  const f = new PrintFrame(zone, canvas);
  assert.equal(f.contains(0.5, 0.4), true);   // 0.3..0.7 × 0.26..0.6
  assert.equal(f.contains(0.1, 0.1), false);
});
