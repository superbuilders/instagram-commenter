import * as fs from "fs";
import * as path from "path";

const dataDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data"
);

const evalData = JSON.parse(
  fs.readFileSync(path.join(dataDir, "eval-dataset.json"), "utf-8")
);
const replyPairs = JSON.parse(
  fs.readFileSync(path.join(dataDir, "voice-samples/reply-pairs.json"), "utf-8")
);

// Match eval comments to MacKenzie's replies
for (const entry of evalData) {
  const match = replyPairs.find(
    (p: any) => p.parentComment?.text === entry.text
  );
  if (match) {
    entry.mackenzieReply = match.mackenzieReply?.text ?? null;
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Eval Dataset Review — Instagram Comment Bot</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: #888; margin-bottom: 20px; }
  .progress-bar { background: #222; border-radius: 8px; height: 8px; margin-bottom: 20px; overflow: hidden; }
  .progress-fill { background: #4ade80; height: 100%; transition: width 0.3s; }
  .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: #1a1a1a; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
  .stat strong { color: #fff; }
  .filters { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .filter-btn { background: #222; border: 1px solid #333; color: #ccc; padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 13px; }
  .filter-btn.active { background: #333; border-color: #555; color: #fff; }
  .card { background: #1a1a1a; border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #333; }
  .card.narrative_shaping { border-left-color: #f97316; }
  .card.community_building { border-left-color: #4ade80; }
  .card.informational { border-left-color: #60a5fa; }
  .card.delete { border-left-color: #ef4444; }
  .card.skip { border-left-color: #6b7280; }
  .card.reviewed { opacity: 0.7; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .card-number { color: #666; font-size: 13px; }
  .card-meta { color: #888; font-size: 13px; }
  .comment-text { font-size: 16px; line-height: 1.5; margin-bottom: 12px; }
  .post-caption { color: #888; font-size: 13px; margin-bottom: 12px; padding: 8px; background: #111; border-radius: 6px; }
  .post-caption strong { color: #aaa; }
  .mackenzie-reply { background: #1a2e1a; border: 1px solid #2d5a2d; padding: 12px; border-radius: 8px; margin-bottom: 12px; }
  .mackenzie-reply strong { color: #4ade80; font-size: 13px; }
  .mackenzie-reply p { margin-top: 4px; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  select { background: #222; color: #e0e0e0; border: 1px solid #444; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  .approve-btn { background: #166534; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .approve-btn:hover { background: #15803d; }
  .approve-btn.approved { background: #444; color: #888; }
  .export-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1a1a1a; border-top: 1px solid #333; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; z-index: 10; }
  .export-btn { background: #2563eb; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 600; }
  .export-btn:hover { background: #1d4ed8; }
  .spacer { height: 70px; }
</style>
</head>
<body>

<h1>Eval Dataset Review</h1>
<p class="subtitle">Review AI classifications. Change any you disagree with. Export when done.</p>

<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
<div id="statsBar" class="stats"></div>

<div class="filters" id="filters"></div>

<div id="cards"></div>
<div class="spacer"></div>

<div class="export-bar">
  <span id="reviewCount"></span>
  <button class="export-btn" onclick="exportData()">Export Corrected JSON</button>
</div>

<script>
const data = ${JSON.stringify(evalData, null, 2)};

const state = data.map((d, i) => ({
  ...d,
  index: i,
  reviewed: false,
  humanClassification: d.classification
}));

const categories = ['narrative_shaping', 'community_building', 'informational', 'delete', 'skip'];
const categoryColors = {
  narrative_shaping: '#f97316',
  community_building: '#4ade80',
  informational: '#60a5fa',
  delete: '#ef4444',
  skip: '#6b7280'
};
const categoryLabels = {
  narrative_shaping: 'Narrative Shaping',
  community_building: 'Community Building',
  informational: 'Informational',
  delete: 'Delete',
  skip: 'Skip'
};

let activeFilter = 'all';

function render() {
  const reviewed = state.filter(s => s.reviewed).length;
  document.getElementById('progressFill').style.width = (reviewed / state.length * 100) + '%';
  document.getElementById('reviewCount').textContent = reviewed + ' of ' + state.length + ' reviewed';

  // Stats
  const counts = {};
  categories.forEach(c => counts[c] = 0);
  state.forEach(s => counts[s.humanClassification]++);
  document.getElementById('statsBar').innerHTML = categories.map(c =>
    '<div class="stat"><strong style="color:' + categoryColors[c] + '">' + counts[c] + '</strong> ' + categoryLabels[c] + '</div>'
  ).join('');

  // Filters
  document.getElementById('filters').innerHTML =
    '<button class="filter-btn ' + (activeFilter === 'all' ? 'active' : '') + '" onclick="setFilter(\\'all\\')">All (' + state.length + ')</button>' +
    categories.map(c =>
      '<button class="filter-btn ' + (activeFilter === c ? 'active' : '') + '" onclick="setFilter(\\'' + c + '\\')">' + categoryLabels[c] + ' (' + counts[c] + ')</button>'
    ).join('') +
    '<button class="filter-btn ' + (activeFilter === 'has_reply' ? 'active' : '') + '" onclick="setFilter(\\'has_reply\\')">Has MacKenzie Reply (' + state.filter(s => s.mackenzieReply).length + ')</button>';

  // Cards
  const filtered = activeFilter === 'all' ? state :
    activeFilter === 'has_reply' ? state.filter(s => s.mackenzieReply) :
    state.filter(s => s.humanClassification === activeFilter);

  document.getElementById('cards').innerHTML = filtered.map(s => {
    const c = s.humanClassification;
    return '<div class="card ' + c + (s.reviewed ? ' reviewed' : '') + '" id="card-' + s.index + '">' +
      '<div class="card-header">' +
        '<span class="card-number">#' + (s.index + 1) + '</span>' +
        '<span class="card-meta">@' + s.username + ' · ' + s.likesCount + ' likes</span>' +
      '</div>' +
      '<div class="comment-text">' + escapeHtml(s.text) + '</div>' +
      '<div class="post-caption"><strong>Post:</strong> ' + escapeHtml(s.postCaption || '') + '</div>' +
      (s.mackenzieReply ? '<div class="mackenzie-reply"><strong>MacKenzie replied:</strong><p>' + escapeHtml(s.mackenzieReply) + '</p></div>' : '') +
      '<div class="controls">' +
        '<select onchange="classify(' + s.index + ', this.value)">' +
          categories.map(cat =>
            '<option value="' + cat + '"' + (c === cat ? ' selected' : '') + '>' + categoryLabels[cat] + '</option>'
          ).join('') +
        '</select>' +
        '<button class="approve-btn' + (s.reviewed ? ' approved' : '') + '" onclick="approve(' + s.index + ')">' +
          (s.reviewed ? '✓ Reviewed' : 'Approve') +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setFilter(f) {
  activeFilter = f;
  render();
}

function classify(index, value) {
  state[index].humanClassification = value;
  state[index].reviewed = true;
  render();
}

function approve(index) {
  state[index].reviewed = true;
  render();
}

function exportData() {
  const output = state.map(s => ({
    id: s.id,
    text: s.text,
    username: s.username,
    likesCount: s.likesCount,
    postCaption: s.postCaption,
    classification: s.humanClassification,
    narrative_topic: s.narrative_topic,
    info_type: s.info_type,
    ideal_response: s.ideal_response,
    mackenzieReply: s.mackenzieReply || null,
    notes: s.notes,
    reviewed: s.reviewed
  }));
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'eval-dataset-reviewed.json';
  a.click();
}

render();
</script>
</body>
</html>`;

const outputPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../docs/eval-review.html"
);
fs.writeFileSync(outputPath, html);
console.log(`Written to ${outputPath}`);
console.log(`Open in browser to review.`);
console.log(`Comments with MacKenzie replies: ${evalData.filter((e: any) => e.mackenzieReply).length}`);
