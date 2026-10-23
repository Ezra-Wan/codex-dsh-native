// Vanilla DOM renderer over the same mdast grammar the native chat uses
// (mdast-util-from-markdown + micromark-extension-gfm, copied engine per
// NOTICE.md). Output is semantic HTML under .markdown, styled entirely by
// the copied upstream sheet ui/prototype/markdown.css.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

function inline(parent, node) {
  if (node.type === 'text') { parent.append(document.createTextNode(node.value)); return; }
  if (node.type === 'inlineCode') { const el = document.createElement('code'); el.textContent = node.value; parent.append(el); return; }
  if (node.type === 'strong') { const el = document.createElement('strong'); inline(el, { type: 'chain', children: node.children }); parent.append(el); return; }
  if (node.type === 'emphasis') { const el = document.createElement('em'); inline(el, { type: 'chain', children: node.children }); parent.append(el); return; }
  if (node.type === 'delete') { const el = document.createElement('del'); inline(el, { type: 'chain', children: node.children }); parent.append(el); return; }
  if (node.type === 'link') { const el = document.createElement('a'); el.href = node.url; inline(el, { type: 'chain', children: node.children }); parent.append(el); return; }
  if (node.type === 'image') { const el = document.createElement('img'); el.src = node.url; el.alt = node.alt ?? ''; el.className = 'image'; parent.append(el); return; }
  if (node.type === 'break') { parent.append(document.createElement('br')); return; }
  if (node.children) inline(parent, { type: 'chain', children: node.children });
  else if (node.value !== undefined) parent.append(document.createTextNode(node.value));
}

function chain(parent, node) {
  for (const child of node.children ?? []) inline(parent, child);
}

function block(node) {
  switch (node.type) {
    case 'heading': { const el = document.createElement(`h${Math.min(node.depth, 6)}`); chain(el, node); return el; }
    case 'paragraph': { const el = document.createElement('p'); chain(el, node); return el; }
    case 'list': {
      const el = document.createElement(node.ordered ? 'ol' : 'ul');
      for (const item of node.children) {
        const li = document.createElement('li');
        for (const child of item.children ?? []) {
          if (child.type === 'paragraph') { const p = document.createElement('p'); chain(p, child); li.append(p); }
          else if (child.type === 'list') li.append(block(child));
          else li.append(block(child));
        }
        if (item.checked !== null && item.checked !== undefined) li.dataset.checked = String(item.checked);
        el.append(li);
      }
      return el;
    }
    case 'code': {
      const pre = document.createElement('pre');
      const el = document.createElement('code');
      el.textContent = node.value ?? '';
      pre.append(el);
      return pre;
    }
    case 'blockquote': {
      const el = document.createElement('blockquote');
      for (const child of node.children ?? []) el.append(block(child));
      return el;
    }
    case 'thematicBreak': return document.createElement('hr');
    case 'table': {
      const wrap = document.createElement('div');
      const el = document.createElement('table');
      const [head, ...rows] = node.children ?? [];
      if (head) {
        const tr = document.createElement('tr');
        for (const cell of head.children ?? []) { const th = document.createElement('th'); chain(th, cell); tr.append(th); }
        el.append(tr);
      }
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (const cell of row.children ?? []) { const td = document.createElement('td'); chain(td, cell); tr.append(td); }
        el.append(tr);
      }
      wrap.className = 'tableScroll';
      wrap.append(el);
      return wrap;
    }
    case 'html': { const el = document.createElement('div'); el.textContent = node.value; return el; }
    default: {
      const el = document.createElement('p');
      inline(el, { type: 'chain', children: node.children ?? [] });
      if (!el.childNodes.length) return null;
      return el;
    }
  }
}

export function renderMarkdown(text) {
  const root = document.createElement('div');
  root.className = 'markdown';
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  for (const node of tree.children ?? []) {
    const el = block(node);
    if (el) root.append(el);
  }
  return root;
}
