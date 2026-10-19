// Converts article-drafts/*.md -> public/data/articles/<slug>.json + index.json
// Mirrors the opportunity JSON style: HTML "description", intro, tags, seo fields.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'article-drafts');
const OUT = path.join(__dirname, 'public', 'data', 'articles');
fs.mkdirSync(OUT, { recursive: true });

const CLUSTERS = [
  ['funding', 'Funding & Scholarships'],
  ['uk-visa', 'UK Study, Visa & After-Study'],
  ['documents', 'Application Documents'],
  ['applications', 'Applications & Supervisors'],
  ['eligibility', 'Profile & Eligibility'],
  ['comparisons', 'Country Comparisons & Salaries'],
];
function clusterFor(num) {
  if (num <= 7) return CLUSTERS[0];
  if (num <= 14) return CLUSTERS[1];
  if (num <= 22) return CLUSTERS[2];
  if (num <= 29) return CLUSTERS[3];
  if (num <= 34) return CLUSTERS[4];
  return CLUSTERS[5];
}
function metaFromBlock(line) {
  // lines like "> Title: `...`" or "> Meta description: `...`" or "> Primary keyword: x" or "> Slug: keep x"
  const m = line.match(/^>\s*(Title|Meta description|Primary keyword|Slug):\s*(.*)$/i);
  if (!m) return null;
  let v = m[2].trim();
  v = v.replace(/^keep\s+/i, '');
  v = v.replace(/^`+|`+$/g, ''); // strip backticks
  return { key: m[1].toLowerCase(), value: v };
}

function inline(s) {
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const flushP = (buf) => { if (buf.length) out.push('<p>' + inline(buf.join(' ')) + '</p>'); buf.length = 0; };
  const p = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,4}\s/.test(line)) {
      flushP(p);
      const lvl = line.match(/^#+/)[0].length;
      out.push(`<h${lvl}>` + inline(line.replace(/^#+\s*/, '')) + `</h${lvl}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(line)) { flushP(p); i++; continue; }
    if (/^\|/.test(line)) {
      flushP(p);
      const tbl = [];
      while (i < lines.length && /^\|/.test(lines[i])) { tbl.push(lines[i]); i++; }
      if (tbl.length >= 2 && /^\|[\s:\-|]+\|\s*$/.test(tbl[1])) {
        const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
        const head = cells(tbl[0]);
        let h = '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        for (let r = 2; r < tbl.length; r++) h += '<tr>' + cells(tbl[r]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        out.push(h + '</tbody></table>');
      } else i = i; // malformed; skip
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushP(p);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul>' + items.map(it => `<li>${inline(it)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushP(p);
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + items.map(it => `<li>${inline(it)}</li>`).join('') + '</ol>');
      continue;
    }
    if (/^>\s?/.test(line)) { flushP(p); i++; continue; } // blockquote/meta — stripped
    if (line.trim() === '') { flushP(p); i++; continue; }
    p.push(line.trim()); i++;
  }
  flushP(p);
  return out.join('\n');
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.md')).sort();
const index = [];
const now = new Date().toISOString();
for (const f of files) {
  const num = parseInt(f.match(/^(\d+)/)[1], 10);
  const md = fs.readFileSync(path.join(SRC, f), 'utf8');
  const lines = md.split(/\r?\n/);
  const title = (lines.find(l => l.startsWith('# ')) || '').replace(/^#\s*/, '').trim();
  const meta = {};
  for (const l of lines) { const m = metaFromBlock(l); if (m) meta[m.key] = m.value; }
  const slug = (meta.slug || f.replace(/^\d+-/, '').replace(/\.md$/, '')).toLowerCase();
  // excerpt: the bolded answer-box line after metadata
  const ansLine = lines.find(l => l.startsWith('**Direct answer') || /^\*\*[^*]+:\*\*$/.test(l) === false && false);
  let excerpt = '';
  const ansIdx = lines.findIndex(l => /Direct answer box/.test(l));
  if (ansIdx >= 0) {
    for (let j = ansIdx + 1; j < Math.min(ansIdx + 6, lines.length); j++) {
      const t = lines[j].trim();
      if (t && !t.startsWith('---') && !t.startsWith('>')) { excerpt = t.replace(/^\*\*|\*\*$/g, ''); break; }
    }
  }
  const [clusterId, clusterName] = clusterFor(num);
  const bodyHtml = mdToHtml(md);
  const words = bodyHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const related = [...bodyHtml.matchAll(/href="(https:\/\/nextapply\.co\.uk\/[^"]+)"/g)].map(m => m[1].replace('https://nextapply.co.uk', ''));
  const relatedArticles = [...new Set(related.filter(u => u.startsWith('/articles/')))];
  const relatedOpportunities = [...new Set(related.filter(u => !u.startsWith('/articles/') && u !== '/fully-funded-scholarships'))];
  const doc = {
    id: 'art_' + slug.replace(/-/g, '_').slice(0, 40),
    slug,
    title,
    seoTitle: meta.title || title,
    seoDescription: (meta['meta description'] || excerpt || '').slice(0, 160),
    primaryKeyword: meta['primary keyword'] || '',
    intro: excerpt,
    description: bodyHtml,
    category: clusterName,
    categoryId: clusterId,
    tags: [clusterName, 'NextApply Team', 'Guide', new Date().getFullYear() + ''],
    wordCount: words,
    readingTimeMinutes: Math.max(3, Math.round(words / 220)),
    relatedArticles,
    relatedOpportunities,
    author: 'NextApply Team',
    status: 'published',
    isFeatured: num <= 3,
    publishedAt: now,
    updatedAt: now,
    ogImage: null,
  };
  fs.writeFileSync(path.join(OUT, slug + '.json'), JSON.stringify(doc, null, 2));
  index.push({ slug, title: doc.seoTitle, category: doc.category, wordCount: words, isFeatured: doc.isFeatured, updatedAt: now });
  console.log(`OK  ${slug}  (${words}w, ${relatedArticles.length} art links, ${relatedOpportunities.length} opp links)`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ total: index.length, generatedAt: now, articles: index }, null, 2));
console.log(`\nDONE: ${index.length} article JSON files + index.json -> ${OUT}`);
