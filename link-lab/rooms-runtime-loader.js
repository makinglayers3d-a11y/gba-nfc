(() => {
  "use strict";

  async function boot() {
    const response = await fetch("./rooms.js?v=19", { cache: "no-store" });
    if (!response.ok) throw new Error(`rooms.js: HTTP ${response.status}`);
    let source = await response.text();

    const localOld = `player.x = clamp(player.x + dx * 1.55 * diagonal, 7, 93, player.x);\n    player.y = clamp(player.y + dy * 1.55 * diagonal, 28, 88, player.y);`;
    const localNew = `const proposedX = clamp(player.x + dx * 1.55 * diagonal, 0, 100, player.x);\n    const proposedY = clamp(player.y + dy * 1.55 * diagonal, 0, 100, player.y);\n    const resolvedMove = window.ML3DLinkWalkable?.resolveMove(player.x, player.y, proposedX, proposedY) || { x: proposedX, y: proposedY };\n    player.x = resolvedMove.x;\n    player.y = resolvedMove.y;`;

    const hostOld = `player.x = clamp(packet.x, 7, 93, player.x);\n      player.y = clamp(packet.y, 28, 88, player.y);`;
    const hostNew = `const resolvedMove = window.ML3DLinkWalkable?.resolveMove(player.x, player.y, packet.x, packet.y) || { x: clamp(packet.x, 0, 100, player.x), y: clamp(packet.y, 0, 100, player.y) };\n      player.x = resolvedMove.x;\n      player.y = resolvedMove.y;`;

    if (!source.includes(localOld)) console.warn("ML3D walkable: no se encontró el bloque de movimiento local esperado.");
    else source = source.replace(localOld, localNew);

    if (!source.includes(hostOld)) console.warn("ML3D walkable: no se encontró el bloque de movimiento remoto esperado.");
    else source = source.replace(hostOld, hostNew);

    source += "\n//# sourceURL=ml3d-link/rooms-runtime-final.js\n";
    (0, eval)(source);
  }

  boot().catch((error) => {
    console.error("ML3D Link runtime final:", error);
    const box = document.getElementById("errorBox");
    if (box) { box.hidden = false; box.textContent = `No se pudo iniciar el lobby: ${error.message}`; }
  });
})();
