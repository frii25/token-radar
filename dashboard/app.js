// Token Launch Radar — dashboard logic. Reads window.RADAR_DATA (written by main.ts).
(function () {
  var data = window.RADAR_DATA || { rows: [], as_of: '', floor_usd: 0 };
  var rows = data.rows.slice();
  var state = { q: '', status: 'all', category: 'all', sort: 'rank', selected: null };
  var $ = function (id) { return document.getElementById(id); };

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- header stats -------------------------------------------------------
  var pre = rows.filter(function (r) { return !r.has_token; });
  var totalValue = pre.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
  var topGrowth = pre.filter(function (r) { return r.change_7d !== null; })
    .sort(function (a, b) { return b.change_7d - a.change_7d; })[0];
  $('stats').innerHTML =
    '<div class="stat"><b>' + rows.length + '</b><span>Protocols ranked</span></div>' +
    '<div class="stat"><b>' + pre.length + '</b><span>Pre-token</span></div>' +
    '<div class="stat"><b>' + fmtUsd(totalValue) + '</b><span>Combined implied value</span></div>' +
    '<div class="stat"><b>' + esc(topGrowth ? topGrowth.name : '—') + '</b><span>Fastest 7-day growth</span></div>';
  $('asof').textContent = data.as_of;

  // ---- category filter ----------------------------------------------------
  var cats = Array.from(new Set(rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
  var catSel = $('category');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; catSel.appendChild(o);
  });

  // ---- filtering + sorting --------------------------------------------------
  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.status === 'pre' && r.has_token) return false;
      if (state.status === 'tok' && !r.has_token) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'value') return b.implied_value_usd - a.implied_value_usd;
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d);
      if (key === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  function render() {
    var list = visible();
    var tb = $('rows');
    tb.innerHTML = list.map(function (r) {
      var g = r.change_7d;
      var cls = g === null ? '' : (g >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><small>' + esc(r.slug) + '</small></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains[0] || '—') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(g) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.has_token
          ? '<span class="badge tok">Token trades</span>'
          : '<span class="badge pre">Pre-token</span>') + '</td></tr>';
    }).join('');
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown';
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  // ---- detail view ----------------------------------------------------------
  function select(slug) {
    state.selected = slug;
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var age = r.listed_at ? Math.max(0, Math.round((Date.parse(data.as_of) - Date.parse(r.listed_at)) / 86400000)) : null;
    var model = r.has_token
      ? '<p class="model">This protocol records a token, so its implied value is its recorded market cap' +
        (r.mcap_usd ? ' of <code>' + fmtUsd(r.mcap_usd) + '</code>' : '') +
        ' — a market fact, not a launch forecast. It ranks below every pre-token protocol.</p>'
      : '<p class="model">Implied value = TVL × category multiple <code>' + r.multiple.toFixed(3) +
        '</code> × growth <code>' + r.growth_factor.toFixed(2) +
        '</code> × maturity <code>' + r.maturity_factor.toFixed(2) +
        '</code> × breadth <code>' + r.breadth_factor.toFixed(2) +
        '</code>. The multiple is the median market-cap/TVL of tokenized protocols in this category, measured from the same snapshot.</p>';
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.join(', ')) + (age !== null ? ' · tracked ' + age + ' days' : '') + '</p>' +
      '<div class="kv">' +
      '<div><b>' + fmtUsd(r.implied_value_usd) + '</b><span>' + (r.has_token ? 'Market cap' : 'Implied value') + '</span></div>' +
      '<div><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b class="' + (r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')) + '">' + fmtPct(r.change_7d) + '</b><span>7-day TVL change</span></div>' +
      '<div><b>' + (r.has_token ? esc(r.symbol || '—') : 'No token recorded') + '</b><span>Token</span></div>' +
      '</div>' + model +
      '<h3>How to farm it</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    render();
  }

  // ---- controls ---------------------------------------------------------------
  $('search').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  $('status').addEventListener('change', function (e) { state.status = e.target.value; render(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var map = { rank: 'rank', name: 'name', tvl: 'tvl', growth: 'growth', value: 'value' };
      state.sort = map[th.getAttribute('data-sort')] || 'rank';
      $('sort').value = state.sort;
      render();
    });
  });

  render();
  if (rows[0]) select(rows[0].slug);
})();
