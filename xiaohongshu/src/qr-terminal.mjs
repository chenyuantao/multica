const QUIET_ZONE = 2;

/**
 * Renders a QR module matrix (rows of "0"/"1") with half-block characters.
 * Colors are forced to black-on-white because scanners reject inverted codes
 * on dark terminal themes.
 */
export function renderQr(matrix) {
  const n = matrix.length + QUIET_ZONE * 2;
  const dark = (r, c) => {
    const row = matrix[r - QUIET_ZONE];
    return row ? row[c - QUIET_ZONE] === "1" : false;
  };
  const lines = [];
  for (let r = 0; r < n; r += 2) {
    let line = "";
    for (let c = 0; c < n; c++) {
      const fg = dark(r, c) ? 30 : 97;
      const bg = dark(r + 1, c) ? 40 : 107;
      line += `\x1b[${fg};${bg}m▀`;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return `${lines.join("\n")}\n`;
}
