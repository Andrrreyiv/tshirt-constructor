// LayerManager — слои (принты + текст) по сторонам + z-order + потолок на сторону.
// Грудь и спина — раздельные наборы; порядок массива = z-order (последний сверху).
// Потолок maxPerSide — только для ПРИНТОВ (C15). Текст слот принта не занимает.
// kind у дескриптора: 'print' | 'text' (по умолчанию 'print').

export class LayerManager {
  /** @param {number} maxPerSide — потолок принтов на одну сторону */
  constructor(maxPerSide = 2) {
    this.maxPerSide = maxPerSide;
    this.layers = { front: [], back: [] };
  }

  /** Есть ли место для нового слоя данного вида. Текст не лимитирован. */
  canAdd(side, kind = 'print') {
    if (kind !== 'print') return true;
    return this.countKind(side, 'print') < this.maxPerSide;
  }

  /** Добавить слой на сторону. Возвращает false, если достигнут потолок принтов. */
  add(side, obj) {
    const kind = obj?.kind ?? 'print';
    if (!this.canAdd(side, kind)) return false;
    this._side(side).push(obj);
    return true;
  }

  /** Число слоёв данного вида на стороне. */
  countKind(side, kind) {
    return this._side(side).filter(o => (o?.kind ?? 'print') === kind).length;
  }

  /** Есть ли хоть один слой данного вида на любой стороне. */
  hasKind(kind) {
    return Object.keys(this.layers).some(s => this.countKind(s, kind) > 0);
  }

  /** Удалить принт со стороны. */
  remove(side, obj) {
    const arr = this._side(side);
    const i = arr.indexOf(obj);
    if (i >= 0) arr.splice(i, 1);
  }

  /** Поднять принт выше в z-order (ближе к концу массива). */
  moveUp(side, obj) {
    const arr = this._side(side);
    const i = arr.indexOf(obj);
    if (i >= 0 && i < arr.length - 1) {
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  }

  /** Опустить принт ниже в z-order. */
  moveDown(side, obj) {
    const arr = this._side(side);
    const i = arr.indexOf(obj);
    if (i > 0) {
      [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  }

  /** Принты стороны в порядке слоёв (снизу вверх). */
  list(side) {
    return this._side(side);
  }

  _side(side) {
    if (!this.layers[side]) this.layers[side] = [];
    return this.layers[side];
  }
}
