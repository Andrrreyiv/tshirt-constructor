import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampStageWidth, validateStageWidth, widthFromDrag,
  DEFAULT_STAGE_WIDTH, MIN_STAGE_WIDTH, MAX_STAGE_WIDTH,
} from '../src/js/tshirt/StageWidth.js';

test('ширина зажимается в рабочий диапазон', () => {
  assert.equal(clampStageWidth(1400), 1400);
  assert.equal(clampStageWidth(300), MIN_STAGE_WIDTH, 'слишком узко — поднимаем до минимума');
  assert.equal(clampStageWidth(9000), MAX_STAGE_WIDTH, 'слишком широко — опускаем до максимума');
  assert.equal(clampStageWidth(1333.7), 1334, 'дробные пиксели округляются');
});

// Мусор в настройках не должен ронять конструктор: он молча остаётся на ширине из CSS.
test('на мусоре clampStageWidth даёт значение по умолчанию', () => {
  assert.equal(clampStageWidth('широко'), DEFAULT_STAGE_WIDTH);
  assert.equal(clampStageWidth(null), DEFAULT_STAGE_WIDTH);
  assert.equal(clampStageWidth(undefined), DEFAULT_STAGE_WIDTH);
  assert.equal(clampStageWidth(NaN), DEFAULT_STAGE_WIDTH);
});

test('validateStageWidth принимает число и объект из stage.json', () => {
  assert.equal(validateStageWidth(1500), 1500);
  assert.equal(validateStageWidth({ width: 1500 }), 1500, 'формат файла настроек');
  assert.equal(validateStageWidth('1500'), 1500, 'число строкой из POST');
});

// В отличие от clamp, ЗДЕСЬ выход за диапазон — это null, а не подгонка: значение пришло
// снаружи (файл или POST), и подменять его молча своим нельзя, иначе непонятно, что применилось.
test('validateStageWidth отвергает мусор и выход за диапазон', () => {
  assert.equal(validateStageWidth(MIN_STAGE_WIDTH - 1), null);
  assert.equal(validateStageWidth(MAX_STAGE_WIDTH + 1), null);
  assert.equal(validateStageWidth('широко'), null);
  assert.equal(validateStageWidth(null), null);
  assert.equal(validateStageWidth({}), null, 'объект без width');
  assert.equal(validateStageWidth([1400]), null, 'массив не настройка');
});

// Поле центрировано в окне: правый край уходит от курсора вдвое медленнее ширины.
// Без множителя 2 футболка «отставала» бы от руки.
test('перетаскивание правого края меняет ширину на удвоенный сдвиг', () => {
  assert.equal(widthFromDrag(1200, 100), 1400);
  assert.equal(widthFromDrag(1200, -100), 1000, 'тянем влево — поле сужается');
  assert.equal(widthFromDrag(1200, 0), 1200);
});

test('перетаскивание не выходит за границы диапазона', () => {
  assert.equal(widthFromDrag(1900, 500), MAX_STAGE_WIDTH);
  assert.equal(widthFromDrag(1100, -500), MIN_STAGE_WIDTH);
});
