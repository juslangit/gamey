// A small, safe Markdown renderer for chat replies: everything is escaped first,
// then a few common patterns become HTML.
(function () {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  }

  function render(src) {
    const parts = String(src).split(/```[^\n]*\n?/);
    let html = '';
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        html += `<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`;
        return;
      }
      const lines = esc(part).split('\n');
      let list = null;
      let para = [];
      const flushPara = () => {
        if (para.length) html += `<p>${inline(para.join('<br>'))}</p>`;
        para = [];
      };
      const flushList = () => {
        if (list) html += `<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`;
        list = null;
      };
      for (const line of lines) {
        const ul = line.match(/^\s*[-*]\s+(.*)/);
        const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
        const h = line.match(/^(#{1,4})\s+(.*)/);
        if (ul || ol) {
          flushPara();
          const tag = ul ? 'ul' : 'ol';
          if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
          list.items.push((ul || ol)[1]);
        } else if (h) {
          flushPara(); flushList();
          html += `<h4>${inline(h[2])}</h4>`;
        } else if (!line.trim()) {
          flushPara(); flushList();
        } else {
          flushList();
          para.push(line);
        }
      }
      flushPara(); flushList();
    });
    return html;
  }

  window.renderMarkdown = render;
})();
