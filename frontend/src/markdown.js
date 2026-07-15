/* Tiny markdown → HTML renderer for changelog and help content. */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function mdToHtml(md) {
  // merge indented continuation lines into the preceding list item
  const raw = esc(md).split('\n');
  const lines = [];
  for (const line of raw) {
    const prev = lines[lines.length - 1];
    const isContinuation = /^\s{2,}\S/.test(line) && !/^\s*([-*]|\d+\.)\s/.test(line);
    const prevIsItem = prev !== undefined && /^\s*([-*]|\d+\.)\s/.test(prev);
    if (isContinuation && prevIsItem) {
      lines[lines.length - 1] = `${prev} ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }
  let html = '';
  let list = null; // 'ul' | 'ol' | null
  let inTable = false;

  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      html += '</tbody></table></div>';
      inTable = false;
    }
  };

  for (const line of lines) {
    // tables: | a | b |
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^[-: ]+$/.test(c) && c)) continue; // separator row
      if (!inTable) {
        inTable = true;
        html += '<div class="table-scroll"><table><tbody>';
        html += `<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`;
      } else {
        html += `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
      }
      continue;
    }
    closeTable();

    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${inline((ul || ol)[1])}</li>`;
      continue;
    }
    closeList();

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
    } else if (line.trim()) {
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  closeTable();
  return html;
}
