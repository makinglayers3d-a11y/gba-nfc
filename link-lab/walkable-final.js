(() => {
  "use strict";

  // Polígono del suelo útil de la arena final, en porcentajes del stage 3:2.
  // Está deliberadamente por dentro de la línea luminosa para que los pies
  // nunca entren en pared, marco ni portal inferior.
  const polygon = [
    [11.5, 22.0], [88.5, 22.0],
    [95.0, 29.0], [95.0, 71.0],
    [87.0, 82.5], [13.0, 82.5],
    [5.0, 71.0], [5.0, 29.0]
  ];

  function inside(x, y) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      const cross = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (cross) hit = !hit;
    }
    return hit;
  }

  function nearest(x, y) {
    let best = { x, y, d2: Infinity };
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
      const px = ax + vx * t, py = ay + vy * t;
      const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
      if (d2 < best.d2) best = { x: px, y: py, d2 };
    }
    // Empuja unas décimas hacia el centro para evitar vibración de borde.
    const cx = 50, cy = 53;
    return { x: best.x + (cx - best.x) * 0.003, y: best.y + (cy - best.y) * 0.003 };
  }

  function resolveMove(currentX, currentY, nextX, nextY) {
    currentX = Number(currentX); currentY = Number(currentY);
    nextX = Number(nextX); nextY = Number(nextY);
    if (![currentX,currentY,nextX,nextY].every(Number.isFinite)) return { x: currentX || 50, y: currentY || 60 };
    if (inside(nextX, nextY)) return { x: nextX, y: nextY };
    // Deslizamiento natural junto a pared: intenta cada eje por separado.
    if (inside(nextX, currentY)) return { x: nextX, y: currentY };
    if (inside(currentX, nextY)) return { x: currentX, y: nextY };
    return nearest(nextX, nextY);
  }

  window.ML3DLinkWalkable = { polygon: polygon.map(p => [...p]), isWalkable: inside, resolveMove };
})();
