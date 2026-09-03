/**
 * The admin panel, as one file.
 *
 * No build step, no framework, no CDN — it is served by the same process it
 * reports on, and it has to work from a phone on a train. The page ships as a
 * shell with no data in it; the token is typed once, kept in localStorage, and
 * every number arrives from GET /admin/data.
 *
 * Set like the app: bone on near-black, square corners, structure from
 * hairlines, amber spent once. The numbers are the design.
 */

export function adminPage(): string {
  return PAGE;
}

const PAGE = String.raw`<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>lockin · admin</title>
<style>
  :root {
    --bg: #0B0B0C;
    --surface: #131315;
    --border: #232326;
    --text: #EDEAE3;
    --dim: #918D85;
    --faint: #57544E;
    --accent: #E8A33D;
    --danger: #C9455A;
    --good: #4ADE80;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 24px 20px 96px;
    max-width: 1180px;
    margin-inline: auto;
    -webkit-text-size-adjust: 100%;
  }
  h1 { font-size: 28px; font-weight: 300; letter-spacing: -0.5px; margin: 0; }
  h2 {
    font-size: 11px; font-weight: 600; letter-spacing: 1.6px; text-transform: uppercase;
    color: var(--faint); margin: 40px 0 12px;
  }
  a { color: var(--accent); }
  .masthead { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .masthead .when { color: var(--faint); font-size: 13px; }
  button {
    font: inherit; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    background: transparent; color: var(--text);
    border: 1px solid var(--faint); border-radius: 0;
    padding: 8px 14px; cursor: pointer;
  }
  button:hover { border-color: var(--text); }
  button.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
  button.danger { color: var(--danger); border-color: var(--danger); }
  button:disabled { opacity: 0.35; cursor: default; }
  input {
    font: inherit; background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 0; padding: 10px 12px;
  }

  /* --- the numbers across the top ------------------------------------- */
  /* Eight figures, so the column count has to divide eight or the last row
     is a half-empty box. auto-fit picks whatever fits and lands on seven. */
  .figures {
    display: grid; border: 1px solid var(--border); overflow: hidden;
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 620px) { .figures { grid-template-columns: repeat(4, 1fr); } }
  /* Borders on the cells, not gaps showing a background through: a last row
     with three empty slots was drawing them as a grey slab. */
  .figure {
    padding: 16px 18px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    margin: 0 -1px -1px 0;
  }
  .figure .n { font-size: 30px; font-weight: 300; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
  .figure .k {
    font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
    color: var(--faint); margin-top: 4px;
  }
  .figure .n.amber { color: var(--accent); }
  .figure .n.small { font-size: 22px; }

  /* --- tables ---------------------------------------------------------- */
  .scroll { overflow-x: auto; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th {
    font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--faint);
    text-align: right; font-weight: 600; padding: 12px 8px; white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }
  th:first-child, td:first-child { text-align: left; padding-left: 16px; }
  th:last-child, td:last-child { padding-right: 16px; }
  td {
    padding: 11px 8px; text-align: right; white-space: nowrap;
    border-bottom: 1px solid var(--border); font-size: 14px;
  }
  tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--surface); }
  .who { display: flex; flex-direction: column; gap: 2px; }
  .who .sub { font-size: 11px; color: var(--faint); }
  .zero { color: var(--faint); }
  .money { color: var(--accent); }

  .pill {
    display: inline-block; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    padding: 3px 8px; border: 1px solid currentColor;
  }
  .pill.ok { color: var(--faint); }
  .pill.pending { color: var(--accent); }
  .pill.revoked { color: var(--danger); }
  .pill.admin { color: var(--good); }

  /* --- spend chart ----------------------------------------------------- */
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 130px; padding: 0 2px; }
  .chart .bar { flex: 1; background: var(--faint); min-height: 1px; transition: background 0.15s; }
  .chart .bar.today { background: var(--accent); }
  .chart .bar:hover { background: var(--text); }
  .axis {
    display: flex; justify-content: space-between;
    font-size: 11px; color: var(--faint); margin-top: 8px;
  }

  .note { color: var(--dim); font-size: 13px; line-height: 1.6; }
  .warn { color: var(--accent); }
  .gate { max-width: 420px; margin: 12vh auto 0; display: flex; flex-direction: column; gap: 16px; }
  /* Read off this screen and typed into a phone, so: big, spaced, and in a
     face where the characters cannot be mistaken for each other. */
  .code {
    font-family: var(--mono); font-size: 40px; letter-spacing: 10px;
    color: var(--accent); border: 1px solid var(--border);
    padding: 20px; text-align: center; margin-bottom: 12px;
  }
  .rates { font-family: var(--mono); font-size: 12px; color: var(--faint); line-height: 1.8; }
  .log { font-size: 13px; color: var(--dim); line-height: 1.9; }
  .log b { color: var(--text); font-weight: 500; }
  [hidden] { display: none !important; }
</style>
</head>
<body>

<div id="gate" class="gate" hidden>
  <h1>lockin · admin</h1>
  <p class="note">
    Approve this browser from the app, where you are already signed in with Apple.
  </p>

  <div id="code-block" hidden>
    <div class="code" id="code"></div>
    <p class="note">
      Open lockin → <b>Regeln</b> → <b>Admin</b>, and enter this. It expires in
      <span id="countdown">5:00</span>.
    </p>
  </div>

  <button class="primary" id="start">Approve this browser</button>
  <p class="note" id="gate-error" style="color:var(--danger)" hidden></p>

  <p class="note">
    <a href="#" id="use-token">Use a bearer token instead</a>
  </p>
  <div id="token-block" hidden style="display:flex;flex-direction:column;gap:12px">
    <input id="token" type="password" autocomplete="off" placeholder="token" autocapitalize="none" spellcheck="false">
    <button id="unlock">Unlock</button>
  </div>
</div>

<main id="panel" hidden>
  <div class="masthead">
    <h1>lockin · admin</h1>
    <span class="when" id="when"></span>
    <span style="flex:1"></span>
    <button id="refresh">Refresh</button>
    <button id="forget">Sign out</button>
  </div>

  <h2>Right now</h2>
  <div class="figures" id="figures"></div>
  <p class="note warn" id="unpriced" hidden></p>

  <section id="pending-block" hidden>
    <h2>Waiting to be let in</h2>
    <div class="scroll"><table><tbody id="pending"></tbody></table></div>
  </section>

  <h2>Spend, last 30 days</h2>
  <div class="chart" id="chart"></div>
  <div class="axis"><span id="axis-from"></span><span id="axis-to">today</span></div>

  <h2>Athletes</h2>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Who</th><th>Status</th><th></th><th>Seen</th>
          <th>Lifts</th><th>Meals</th><th>Weigh</th><th>Msgs</th>
          <th>Calls</th><th>Tokens</th><th>Spend 30d</th><th>All time</th><th>Cap</th>
        </tr>
      </thead>
      <tbody id="athletes"></tbody>
    </table>
  </div>
  <p class="note">
    Lifts, meals, weigh-ins and messages are the last 7 days; calls, tokens and spend
    the last 30. A cap of 0 is no ceiling — click one to change it.
  </p>

  <h2>Where the money goes</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>Purpose</th><th>Model</th><th>Calls</th><th>Tokens</th><th>Spend 30d</th></tr></thead>
      <tbody id="purposes"></tbody>
    </table>
  </div>

  <h2>Rates used</h2>
  <div class="rates" id="rates"></div>
  <p class="note">
    Per million tokens, in USD. Override with <code>GEMINI_PRICE_&lt;MODEL&gt;=&lt;in&gt;/&lt;out&gt;</code>
    in the server environment — for example <code>GEMINI_PRICE_GEMINI_3_6_FLASH=0.3/2.5</code>.
    Check them against the provider console before trusting a total to the cent.
  </p>

  <h2>Admin log</h2>
  <div class="log" id="log"></div>
</main>

<script>
(function () {
  var KEY = 'lockin.adminToken';
  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }

  var $ = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function money(usd) {
    if (!usd) return '<span class="zero">$0</span>';
    if (usd < 0.01) return '<span class="money">$' + usd.toFixed(4) + '</span>';
    if (usd < 1) return '<span class="money">$' + usd.toFixed(3) + '</span>';
    return '<span class="money">$' + usd.toFixed(2) + '</span>';
  }

  function num(value) {
    if (!value) return '<span class="zero">0</span>';
    return value.toLocaleString('en-US');
  }

  function ago(iso) {
    if (!iso) return '<span class="zero">never</span>';
    var mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    return new Date(iso).toISOString().slice(0, 10);
  }

  function call(path, options) {
    options = options || {};
    var headers = { Authorization: 'Bearer ' + token };
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      if (response.status === 401 || response.status === 404) {
        var wrong = new Error('That token cannot see this panel.');
        wrong.rejected = true;
        throw wrong;
      }
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload.error || 'Request failed');
        return payload;
      });
    });
  }

  function showGate(message) {
    stopPolling();
    $('panel').hidden = true;
    $('gate').hidden = false;
    $('start').disabled = false;
    if (message) {
      $('gate-error').textContent = message;
      $('gate-error').hidden = false;
    }
  }

  function figure(value, label, className) {
    return '<div class="figure"><div class="n ' + (className || '') + '">' + value +
      '</div><div class="k">' + esc(label) + '</div></div>';
  }

  function statusPill(row) {
    if (row.isAdmin) return '<span class="pill admin">admin</span>';
    if (!row.approvedAt) return '<span class="pill pending">pending</span>';
    return '<span class="pill ok">' + esc(row.signInWith) + '</span>';
  }

  function draw(data) {
    var head = data.overview;

    $('figures').innerHTML =
      figure(head.athletes, 'athletes') +
      figure(head.pending, 'pending', head.pending ? 'amber' : '') +
      figure(head.activeThisWeek, 'active this week') +
      figure('$' + head.usdToday.toFixed(2), 'spend today', 'small') +
      figure('$' + head.usd30.toFixed(2), 'last 30 days', 'small') +
      figure('$' + head.projectedMonthlyUsd.toFixed(2), 'monthly, at this rate', 'small') +
      figure('$' + head.usdAll.toFixed(2), 'all time', 'small') +
      figure(num(head.calls30), 'calls 30d');

    if (head.unpricedTokens) {
      $('unpriced').hidden = false;
      $('unpriced').textContent =
        num(head.unpricedTokens).replace(/<[^>]+>/g, '') +
        ' tokens were spent on a model with no rate set, so they are not in any total above. ' +
        'Set GEMINI_PRICE_… for it, or these totals read low.';
    } else {
      $('unpriced').hidden = true;
    }

    // --- waiting to be let in ---
    var pending = data.athletes.filter(function (row) { return !row.approvedAt; });
    $('pending-block').hidden = pending.length === 0;
    $('pending').innerHTML = pending.map(function (row) {
      return '<tr><td><div class="who"><span>' + esc(row.name || 'no name') +
        '</span><span class="sub">' + esc(row.email || 'email hidden') + ' · signed up ' +
        ago(row.createdAt) + '</span></div></td>' +
        '<td><button class="primary" data-approve="' + row.id + '">Let in</button></td></tr>';
    }).join('');

    // --- spend chart ---
    var days = data.spendByDay;
    var peak = Math.max.apply(null, days.map(function (d) { return d.usd; }).concat([0.0001]));
    $('chart').innerHTML = days.map(function (day, index) {
      var height = Math.max(1, Math.round((day.usd / peak) * 130));
      return '<div class="bar' + (index === days.length - 1 ? ' today' : '') +
        '" style="height:' + height + 'px" title="' + day.day + ' — $' + day.usd.toFixed(4) +
        ', ' + day.calls + ' calls, ' + day.tokens.toLocaleString('en-US') + ' tokens"></div>';
    }).join('');
    $('axis-from').textContent = days.length ? days[0].day : '';

    // --- athletes ---
    $('athletes').innerHTML = data.athletes.map(function (row) {
      var action = row.approvedAt
        ? (row.isAdmin ? '' : '<button class="danger" data-revoke="' + row.id + '">Revoke</button>')
        : '<button class="primary" data-approve="' + row.id + '">Let in</button>';

      return '<tr>' +
        '<td><div class="who"><span>' + esc(row.name || 'user ' + row.id) +
          '</span><span class="sub">' + esc(row.email || 'no email') +
          (row.timezone ? ' · ' + esc(row.timezone) : '') +
          (row.devices ? ' · ' + row.devices + ' device' + (row.devices === 1 ? '' : 's') : '') +
          (row.onboarded ? '' : ' · not onboarded') +
        '</span></div></td>' +
        '<td>' + statusPill(row) + '</td>' +
        // Beside the status rather than at the far end: on a table this wide
        // the last column is off-screen, and this is the one control here.
        '<td>' + action + '</td>' +
        '<td>' + ago(row.lastSeenAt) + '</td>' +
        '<td>' + num(row.sessions7) + '</td>' +
        '<td>' + num(row.meals7) + '</td>' +
        '<td>' + num(row.weighIns7) + '</td>' +
        '<td>' + num(row.messages7) + '</td>' +
        '<td>' + num(row.calls30) + '</td>' +
        '<td>' + num(row.tokens30) + '</td>' +
        '<td>' + money(row.usd30) + '</td>' +
        // Amber is the signal colour; two full columns of it is not a signal.
        // Only the number being watched gets it.
        '<td class="zero">' + (row.usdAll ? '$' + row.usdAll.toFixed(2) : '$0') + '</td>' +
        '<td><span data-cap="' + row.id + '" style="cursor:pointer;border-bottom:1px dotted var(--faint)">' +
          (row.dailyTokenBudget ? num(row.dailyTokenBudget) : '<span class="zero">none</span>') +
        '</span></td>' +
      '</tr>';
    }).join('');

    // --- where the money goes ---
    $('purposes').innerHTML = data.spendByPurpose.length
      ? data.spendByPurpose.map(function (row) {
          return '<tr><td>' + esc(row.purpose) + '</td><td>' + esc(row.model) + '</td><td>' +
            num(row.calls) + '</td><td>' + num(row.tokens) + '</td><td>' + money(row.usd) +
            '</td></tr>';
        }).join('')
      : '<tr><td colspan="5" class="zero">No model calls in the last 30 days.</td></tr>';

    // --- rates ---
    $('rates').innerHTML = Object.keys(head.rates).map(function (model) {
      var rate = head.rates[model];
      return esc(model) + '  ·  in $' + rate.input + '  ·  out $' + rate.output;
    }).join('<br>');

    // --- log ---
    $('log').innerHTML = data.actions.length
      ? data.actions.map(function (entry) {
          var who = entry.subject ? '<b>' + esc(entry.subject) + '</b>' : 'somebody';
          var said = { approve: 'let ' + who + ' in',
                       revoke: 'revoked ' + who,
                       budget: "set " + who + "'s daily cap to " +
                               Number(entry.detail || 0).toLocaleString('en-US') }[entry.action];
          return '<div><b>' + esc(entry.actor) + '</b> ' +
            (said || esc(entry.action) + ' ' + who) + ' · ' + ago(entry.createdAt) + '</div>';
        }).join('')
      : '<span class="zero">Nothing yet.</span>';

    $('when').textContent = 'as of ' + new Date(data.generatedAt).toLocaleTimeString();
  }

  function load() {
    $('refresh').disabled = true;
    return call('/admin/data')
      .then(function (data) {
        $('gate').hidden = true;
        $('panel').hidden = false;
        draw(data);
      })
      .catch(function (error) {
        if (error.rejected) {
          try { localStorage.removeItem(KEY); } catch (e) {}
          token = null;
          showGate(error.message);
        } else {
          $('when').textContent = 'could not refresh — ' + error.message;
        }
      })
      .then(function () { $('refresh').disabled = false; });
  }

  // --- approving this browser from the phone --------------------------
  var polling = null;

  function stopPolling() {
    if (polling) { clearInterval(polling.timer); clearInterval(polling.clock); }
    polling = null;
  }

  function startPairing() {
    stopPolling();
    $('start').disabled = true;
    $('gate-error').hidden = true;

    fetch('/admin/pair', { method: 'POST' })
      .then(function (response) { return response.json(); })
      .then(function (pairing) {
        $('code').textContent = pairing.code;
        $('code-block').hidden = false;
        $('start').textContent = 'New code';
        $('start').disabled = false;

        var left = pairing.expiresInSeconds;
        var tick = function () {
          left -= 1;
          $('countdown').textContent =
            Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
          if (left <= 0) {
            stopPolling();
            $('code-block').hidden = true;
            showGate('That code expired. Ask for a new one.');
          }
        };

        polling = {
          // Two seconds: this is somebody standing there with a phone.
          timer: setInterval(function () {
            fetch('/admin/pair/' + encodeURIComponent(pairing.id))
              .then(function (response) { return response.json(); })
              .then(function (result) {
                if (!result.token) return;
                stopPolling();
                token = result.token;
                try { localStorage.setItem(KEY, token); } catch (e) {}
                $('code-block').hidden = true;
                load();
              })
              .catch(function () { /* a dropped poll is not an error */ });
          }, 2000),
          clock: setInterval(tick, 1000)
        };
      })
      .catch(function () {
        $('start').disabled = false;
        showGate('Could not reach the server.');
      });
  }

  $('start').addEventListener('click', startPairing);

  $('use-token').addEventListener('click', function (event) {
    event.preventDefault();
    $('token-block').hidden = !$('token-block').hidden;
  });

  $('unlock').addEventListener('click', function () {
    token = $('token').value.trim();
    if (!token) return;
    try { localStorage.setItem(KEY, token); } catch (e) {}
    $('gate-error').hidden = true;
    load();
  });

  $('token').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') $('unlock').click();
  });

  $('refresh').addEventListener('click', load);

  $('forget').addEventListener('click', function () {
    // Ends this browser's session on the server too, so a laptop signed out
    // here cannot be signed back in by whatever is left in localStorage.
    if (token) call('/auth/signout', { method: 'POST', body: {} }).catch(function () {});
    try { localStorage.removeItem(KEY); } catch (e) {}
    token = null;
    location.reload();
  });

  document.addEventListener('click', function (event) {
    var approve = event.target.getAttribute && event.target.getAttribute('data-approve');
    var revoke = event.target.getAttribute && event.target.getAttribute('data-revoke');
    var cap = event.target.getAttribute && event.target.getAttribute('data-cap');

    if (approve) {
      event.target.disabled = true;
      call('/admin/users/' + approve + '/approval', { method: 'POST', body: { approved: true } })
        .then(load, function (error) { alert(error.message); load(); });
    }

    if (revoke) {
      if (!confirm('Revoke this account? Their data stays; their devices are signed out.')) return;
      event.target.disabled = true;
      call('/admin/users/' + revoke + '/approval', { method: 'POST', body: { approved: false } })
        .then(load, function (error) { alert(error.message); load(); });
    }

    if (cap) {
      var entered = prompt('Daily token cap for this athlete. 0 means no ceiling.');
      if (entered === null) return;
      var budget = parseInt(entered, 10);
      if (isNaN(budget) || budget < 0) return alert('A whole number, or 0.');
      call('/admin/users/' + cap + '/budget', { method: 'POST', body: { budget: budget } })
        .then(load, function (error) { alert(error.message); load(); });
    }
  });

  if (token) load(); else showGate();
})();
</script>
</body>
</html>`;
