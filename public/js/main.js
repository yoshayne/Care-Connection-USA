var cur = 1, svcs = [], data = {};

function go(n) {
  if (cur === 2 && n === 3) {
    var z = document.getElementById('zip').value.trim();
    var t = document.getElementById('timeline').value;
    if (!z) { document.getElementById('zip').style.borderColor = '#e53e3e'; return; }
    if (!t) { document.getElementById('timeline').style.borderColor = '#e53e3e'; return; }
    data.zip = z;
    data.timeline = t;
    data.notes = document.getElementById('notes').value;
  }
  document.getElementById('p' + cur).classList.remove('active');
  document.getElementById('p' + n).classList.add('active');
  for (var i = 1; i <= 3; i++) {
    var d = document.getElementById('d' + i);
    d.className = 'sd' + (i < n ? ' done' : i === n ? ' active' : '');
  }
  if (document.getElementById('l1')) document.getElementById('l1').className = 'sl' + (n > 1 ? ' done' : '');
  if (document.getElementById('l2')) document.getElementById('l2').className = 'sl' + (n > 2 ? ' done' : '');
  cur = n;
}

function toggleSvc(el, name) {
  var i = svcs.indexOf(name);
  if (i > -1) { svcs.splice(i, 1); el.classList.remove('sel'); }
  else { svcs.push(name); el.classList.add('sel'); }
}

function showSubmitError(msg) {
  var err = document.getElementById('submit-error');
  err.textContent = msg;
  err.style.display = 'block';
}

function hideSubmitError() {
  var err = document.getElementById('submit-error');
  err.style.display = 'none';
  err.textContent = '';
}

function submit() {
  var fields = [['fn', 'First Name'], ['ln', 'Last Name'], ['em', 'Email'], ['ph', 'Phone']];
  var ok = true;
  fields.forEach(function (f) {
    var el = document.getElementById(f[0]);
    if (!el.value.trim()) { el.style.borderColor = '#e53e3e'; ok = false; }
    else el.style.borderColor = '';
  });
  if (!ok) return;

  hideSubmitError();

  data.firstName = document.getElementById('fn').value.trim();
  data.lastName = document.getElementById('ln').value.trim();
  data.email = document.getElementById('em').value.trim();
  data.phone = document.getElementById('ph').value.trim();
  data.services = svcs;

  var btn = document.querySelector('.btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
    .then(function (res) { return res.json(); })
    .then(function (json) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Get My Free Matches';
      if (json.success) {
        document.getElementById('p3').classList.remove('active');
        document.getElementById('suc').style.display = 'flex';
        for (var i = 1; i <= 3; i++) document.getElementById('d' + i).className = 'sd done';
        document.getElementById('l1').className = 'sl done';
        document.getElementById('l2').className = 'sl done';
      } else {
        showSubmitError(json.error || 'Something went wrong. Please try again.');
      }
    })
    .catch(function () {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Get My Free Matches';
      showSubmitError('Network error. Please check your connection and try again.');
    });
}

document.querySelectorAll('input,select,textarea').forEach(function (el) {
  el.addEventListener('input', function () { this.style.borderColor = ''; });
});
